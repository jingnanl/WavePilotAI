/**
 * Alpaca WebSocket Service
 *
 * Manages real-time data stream from Alpaca IEX feed.
 * Implements three-stage data stitching strategy:
 * 1. Historical data from Massive (< Now-15m)
 * 2. Recent data from Alpaca REST (Now-15m ~ Now)
 * 3. Real-time data from Alpaca WebSocket (> Now)
 *
 * Market-aware behavior:
 * - Connects during regular market hours only (9:30 AM - 4:00 PM ET)
 * - Disconnects during market close to save resources
 * - Auto-reconnects when market opens
 */

import Alpaca from '@alpacahq/alpaca-trade-api';
import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { InfluxDBWriter } from './timestream-writer';
import { transformAlpacaRealtimeBarToQuote } from '../utils/transformers';
import { getMarketStatus } from '../utils/market-status';
import { createLogger } from '../utils/logger';
import type { QuoteRecord } from '@wavepilot/shared';

// Configuration
import { CONFIG } from '../config';

const logger = createLogger('AlpacaWS');

interface ApiKeys {
    ALPACA_API_KEY: string;
    ALPACA_API_SECRET: string;
}

export class AlpacaWebSocketService {
    private writer: InfluxDBWriter;
    private alpaca: Alpaca | null = null;
    private stream: any = null;
    private subscriptions: Set<string> = new Set();
    private connected: boolean = false;
    private connecting: boolean = false; // Prevent duplicate connect attempts
    private reconnectAttempts: number = 0;
    private secretsClient: SecretsManagerClient;
    private apiKeys: ApiKeys | null = null;
    private marketCheckTimer: NodeJS.Timeout | null = null;
    private shouldBeConnected: boolean = false; // User intent to connect

    constructor(writer: InfluxDBWriter) {
        this.writer = writer;
        this.secretsClient = new SecretsManagerClient({ region: CONFIG.AWS_REGION });
        logger.info('Service created.');
    }

    /**
     * Get API keys from Secrets Manager
     */
    private async getApiKeys(): Promise<ApiKeys> {
        if (this.apiKeys) return this.apiKeys;

        logger.info('Fetching API keys from Secrets Manager...');
        const response = await this.secretsClient.send(
            new GetSecretValueCommand({ SecretId: CONFIG.API_KEYS_SECRET_ARN })
        );

        if (!response.SecretString) {
            throw new Error('Failed to retrieve API keys');
        }

        this.apiKeys = JSON.parse(response.SecretString);
        return this.apiKeys!;
    }

    /**
     * Check if we should maintain WebSocket connection
     * Only connect during regular market hours (9:30 AM - 4:00 PM ET)
     */
    private async shouldConnect(): Promise<boolean> {
        const status = await getMarketStatus();
        return status.isOpen;
    }

    /**
     * Start market status monitoring
     * Automatically connects/disconnects based on market hours
     */
    private startMarketMonitor(): void {
        // Clear any existing timer to prevent memory leaks
        this.stopMarketMonitor();

        // Check immediately on start, then periodically
        const checkAndConnect = async () => {
            const shouldConnect = await this.shouldConnect();

            if (shouldConnect && !this.connected && !this.connecting && this.shouldBeConnected) {
                logger.info('Market open, connecting...');
                await this.connectInternal();
            } else if (!shouldConnect && this.connected) {
                logger.info('Market closed, disconnecting...');
                this.disconnectInternal();
            } else if (!shouldConnect && !this.connected) {
                const status = await getMarketStatus();
                logger.info(`Market closed (preMarket: ${status.earlyHours}, afterHours: ${status.afterHours}). Will connect when market opens.`);
            }
        };

        // Run immediately
        checkAndConnect();

        // Then check periodically
        this.marketCheckTimer = setInterval(checkAndConnect, CONFIG.MARKET_CHECK_INTERVAL_MS);

        logger.info('Market monitor started (checking every 1 minute).');
    }

    /**
     * Stop market status monitoring
     */
    private stopMarketMonitor(): void {
        if (this.marketCheckTimer) {
            clearInterval(this.marketCheckTimer);
            this.marketCheckTimer = null;
            logger.info('Market monitor stopped.');
        }
    }

    /**
     * Connect to Alpaca WebSocket (public API)
     * Will check market status and connect if appropriate
     */
    async connect(): Promise<void> {
        this.shouldBeConnected = true;
        this.startMarketMonitor();
        // Let the market monitor handle connection timing
        // This avoids duplicate connect attempts
    }

    /**
     * Internal connect logic
     */
    private async connectInternal(): Promise<void> {
        if (this.connected || this.connecting) {
            logger.info('Already connected or connecting.');
            return;
        }

        this.connecting = true;

        try {
            const keys = await this.getApiKeys();

            this.alpaca = new Alpaca({
                keyId: keys.ALPACA_API_KEY,
                secretKey: keys.ALPACA_API_SECRET,
                paper: true,
            });

            this.stream = this.alpaca.data_stream_v2;
            this.setupEventHandlers();
            this.stream.connect();

            logger.info('Connecting to Alpaca Data Stream (IEX)...');
        } catch (error) {
            logger.error('Failed to connect:', error as Error);
            this.connecting = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    private setupEventHandlers(): void {
        if (!this.stream) return;

        this.stream.onConnect(() => {
            logger.info('Connected to Alpaca Data Stream.');
            this.connected = true;
            this.connecting = false;
            this.reconnectAttempts = 0;

            // Re-subscribe to previously subscribed symbols
            if (this.subscriptions.size > 0) {
                const symbols = Array.from(this.subscriptions);
                logger.info(`Re-subscribing to: ${symbols.join(', ')}`);
                this.stream.subscribeForBars(symbols);
            }
        });

        this.stream.onDisconnect(() => {
            logger.info('Disconnected from Alpaca Data Stream.');
            this.connected = false;
            this.connecting = false;
            // Only reconnect if we should still be connected (not intentional disconnect)
            if (this.shouldBeConnected) {
                this.scheduleReconnect();
            }
        });

        this.stream.onError((err: Error) => {
            logger.error('Stream error:', err);
            this.connected = false;
            this.connecting = false;
            this.scheduleReconnect();
        });

        this.stream.onStockBar(async (bar: any) => {
            await this.handleBar(bar);
        });

        this.stream.onStockTrade(() => {
            // Trades are not stored, only bars
        });
    }

    /**
     * Schedule reconnection attempt
     * Only reconnects if shouldBeConnected is true and market is open
     */
    private scheduleReconnect(): void {
        // Don't reconnect if user disconnected or market closed
        if (!this.shouldBeConnected) {
            logger.info('Skipping reconnect (shouldBeConnected=false).');
            return;
        }

        if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            logger.error('Max reconnect attempts reached. Giving up.');
            return;
        }

        this.reconnectAttempts++;
        const delay = CONFIG.RECONNECT_DELAY_MS * this.reconnectAttempts;

        logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms...`);

        setTimeout(async () => {
            // Double-check before reconnecting
            if (!this.shouldBeConnected) {
                logger.info('Reconnect cancelled (shouldBeConnected=false).');
                return;
            }

            const shouldConnect = await this.shouldConnect();
            if (!shouldConnect) {
                logger.info('Reconnect cancelled (market closed).');
                this.reconnectAttempts = 0;
                return;
            }

            try {
                await this.connectInternal();
            } catch (error) {
                logger.error('Reconnect failed:', error as Error);
            }
        }, delay);
    }

    /**
     * Subscribe to real-time bars for symbols
     * Stage 2: Backfills recent 15 minutes of data (to fill Massive delay gap)
     * Time range validation ensures no overlap with Stage 1 (Massive) data
     */
    async subscribe(symbols: string[], backfill: boolean = true): Promise<void> {
        if (!symbols || symbols.length === 0) return;

        const newSymbols = symbols
            .map(s => s.toUpperCase())
            .filter(s => !this.subscriptions.has(s));

        if (newSymbols.length === 0) {
            logger.info('All symbols already subscribed.');
            return;
        }

        // Add to subscriptions set
        newSymbols.forEach(s => this.subscriptions.add(s));

        // Stage 2 Backfill: Fill the gap between Massive data (< Now-15m) and real-time stream
        // Only fetch data from (Now - 15m) to Now to avoid overlap with Stage 1
        if (backfill) {
            const now = new Date();
            const stitchingDelayMs = CONFIG.STITCHING_DELAY_MINUTES * 60 * 1000;
            const startTime = new Date(now.getTime() - stitchingDelayMs);

            logger.info(`Stage 2 backfill: ${newSymbols.join(', ')} (${startTime.toISOString()} -> ${now.toISOString()})`);

            for (const symbol of newSymbols) {
                try {
                    const bars = await this.fetchRecentBars(symbol, startTime, now);
                    if (bars.length > 0) {
                        // Filter to ensure we only write data within Stage 2 window
                        const validBars = bars.filter(bar =>
                            bar.time >= startTime && bar.time <= now
                        );
                        if (validBars.length > 0) {
                            await this.writer.writeQuotes(validBars);
                            logger.info(`Stage 2 backfilled ${validBars.length} bars for ${symbol}.`);
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to backfill ${symbol}:`, error as Error);
                }
            }
        }

        // Subscribe to WebSocket stream
        if (this.connected && this.stream) {
            logger.info(`Subscribing to: ${newSymbols.join(', ')}`);
            this.stream.subscribeForBars(newSymbols);
        } else {
            logger.info(`Queued subscription for: ${newSymbols.join(', ')} (not connected)`);
        }
    }

    /**
     * Unsubscribe from symbols
     */
    unsubscribe(symbols: string[]): void {
        if (!symbols || symbols.length === 0) return;

        symbols.forEach(s => this.subscriptions.delete(s.toUpperCase()));

        if (this.connected && this.stream) {
            const removeSymbols = symbols.map(s => s.toUpperCase());
            logger.info(`Unsubscribing from: ${removeSymbols.join(', ')}`);
            this.stream.unsubscribeFromBars(removeSymbols);
        }
    }

    /**
     * Get current subscriptions
     */
    getSubscriptions(): string[] {
        return Array.from(this.subscriptions);
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Disconnect from WebSocket (public API)
     * Stops market monitoring and disconnects
     */
    disconnect(): void {
        this.shouldBeConnected = false;
        this.stopMarketMonitor();
        this.disconnectInternal();
    }

    /**
     * Internal disconnect logic (called for market close - no backfill needed)
     */
    private disconnectInternal(): void {
        if (this.stream) {
            logger.info('Disconnecting...');
            this.stream.disconnect();
            this.stream = null;
        }
        this.connected = false;
        this.connecting = false;
        this.alpaca = null;
        // Don't set lastDisconnectTime - this is intentional disconnect (market close)
        logger.info('Disconnected.');
    }

    /**
     * Handle incoming bar data
     */
    private async handleBar(bar: any): Promise<void> {
        try {
            const record: QuoteRecord = transformAlpacaRealtimeBarToQuote(bar, 'US');

            logger.debug(
                `Bar: ${record.ticker} ` +
                `O:${record.open} H:${record.high} L:${record.low} C:${record.close} ` +
                `V:${record.volume} @ ${record.time.toISOString()}`
            );

            // Write to InfluxDB
            await this.writer.writeQuotes([record]);
        } catch (error) {
            logger.error('Failed to process bar:', error as Error);
        }
    }

    /**
     * Fetch recent bars using REST API (for backfill)
     * Used to fill the gap between Massive data and real-time stream
     */
    async fetchRecentBars(
        symbol: string,
        startTime: Date,
        endTime: Date = new Date()
    ): Promise<QuoteRecord[]> {
        if (!this.alpaca) {
            const keys = await this.getApiKeys();
            this.alpaca = new Alpaca({
                keyId: keys.ALPACA_API_KEY,
                secretKey: keys.ALPACA_API_SECRET,
                paper: true,
            });
        }

        logger.info(`Fetching recent bars for ${symbol} (${startTime.toISOString()} -> ${endTime.toISOString()})...`);

        const bars: QuoteRecord[] = [];

        try {
            const iterator = this.alpaca.getBarsV2(symbol, {
                start: startTime.toISOString(),
                end: endTime.toISOString(),
                timeframe: '1Min',
                feed: 'iex',
            });

            for await (const bar of iterator) {
                bars.push(transformAlpacaRealtimeBarToQuote({
                    Symbol: symbol,
                    Timestamp: bar.Timestamp,
                    OpenPrice: bar.OpenPrice,
                    HighPrice: bar.HighPrice,
                    LowPrice: bar.LowPrice,
                    ClosePrice: bar.ClosePrice,
                    Volume: bar.Volume,
                    VWAP: bar.VWAP,
                    TradeCount: bar.TradeCount,
                }, 'US'));
            }

            logger.info(`Fetched ${bars.length} recent bars for ${symbol}.`);
        } catch (error) {
            logger.error(`Failed to fetch recent bars for ${symbol}:`, error as Error);
        }

        return bars;
    }
}
