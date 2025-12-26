/**
 * Massive WebSocket Service
 *
 * Manages real-time SIP data stream from Massive (Polygon) WebSocket.
 * Provides 15-minute delayed but more accurate SIP data to correct IEX data.
 *
 * Data flow:
 * 1. Alpaca WS writes real-time IEX data to InfluxDB
 * 2. Massive WS writes SIP data 15 minutes later (same timestamp)
 * 3. InfluxDB automatically overwrites with more accurate SIP data
 *
 * Market-aware behavior:
 * - Connects during market hours + 15 minutes after close
 * - Disconnects 15 minutes after market close (all SIP data received)
 */

import WebSocket from 'ws';
import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { InfluxDBWriter } from './timestream-writer';
import { transformMassiveBarToQuote } from '../utils/transformers';
import { shouldConnectSipWebSocket } from '../utils/market-status';
import { createLogger } from '../utils/logger';
import { WS_PING_INTERVAL_MS, WS_PONG_TIMEOUT_MS } from '../utils/constants';
import type { QuoteRecord } from '@wavepilot/shared';

// Configuration
import { CONFIG } from '../config';

const logger = createLogger('MassiveWS');

interface ApiKeys {
    MASSIVE_API_KEY: string;
}

export class MassiveWebSocketService {
    private writer: InfluxDBWriter;
    private ws: WebSocket | null = null;
    private subscriptions: Set<string> = new Set();
    private connected: boolean = false;
    private connecting: boolean = false; // Prevent duplicate connect attempts
    private authenticated: boolean = false;
    private reconnectAttempts: number = 0;
    private secretsClient: SecretsManagerClient;
    private apiKeys: ApiKeys | null = null;
    private marketCheckTimer: NodeJS.Timeout | null = null;
    private shouldBeConnected: boolean = false;
    private pingTimer: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;

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
     * Start market status monitoring
     */
    private startMarketMonitor(): void {
        if (this.marketCheckTimer) return;

        // Check immediately on start, then periodically
        const checkAndConnect = async () => {
            const shouldConnect = await shouldConnectSipWebSocket();

            if (shouldConnect && !this.connected && !this.connecting && this.shouldBeConnected) {
                logger.info('Market active, connecting...');
                await this.connectInternal();
            } else if (!shouldConnect && this.connected) {
                logger.info('Market closed + 15min buffer passed, disconnecting...');
                this.disconnectInternal();
            } else if (!shouldConnect && !this.connected && this.shouldBeConnected) {
                logger.info('Market closed. Will connect when market opens.');
            }
        };

        // Run immediately
        checkAndConnect();

        // Then check periodically
        this.marketCheckTimer = setInterval(checkAndConnect, CONFIG.MARKET_CHECK_INTERVAL_MS);

        logger.info('Market monitor started.');
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
     * Start WebSocket ping/pong heartbeat
     */
    private startPing(): void {
        this.stopPing();

        this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                logger.debug('Sending ping...');
                this.ws.ping();

                // Set pong timeout
                this.pongTimeout = setTimeout(() => {
                    logger.warn('Pong timeout, reconnecting...');
                    this.ws?.terminate();
                }, WS_PONG_TIMEOUT_MS);
            }
        }, WS_PING_INTERVAL_MS);
    }

    /**
     * Stop WebSocket ping/pong heartbeat
     */
    private stopPing(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    /**
     * Connect to Massive WebSocket (public API)
     */
    async connect(): Promise<void> {
        this.shouldBeConnected = true;
        this.startMarketMonitor();
        // Let the market monitor handle connection timing
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
            logger.info('Connecting to Massive WebSocket...');
            this.ws = new WebSocket(CONFIG.MASSIVE_DELAYED_WS_URL);
            this.setupEventHandlers();
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
        if (!this.ws) return;

        this.ws.on('open', async () => {
            logger.info('WebSocket connected, authenticating...');
            this.connected = true;
            this.connecting = false;
            this.reconnectAttempts = 0;
            await this.authenticate();
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
            await this.handleMessage(data);
        });

        this.ws.on('pong', () => {
            // Clear pong timeout on successful pong
            if (this.pongTimeout) {
                clearTimeout(this.pongTimeout);
                this.pongTimeout = null;
            }
            logger.debug('Pong received.');
        });

        this.ws.on('close', () => {
            logger.info('WebSocket disconnected.');
            this.connected = false;
            this.authenticated = false;
            this.stopPing();
            if (this.shouldBeConnected) {
                this.scheduleReconnect();
            }
        });

        this.ws.on('error', (error: Error) => {
            logger.error('WebSocket error:', error);
        });
    }

    /**
     * Authenticate with Massive
     */
    private async authenticate(): Promise<void> {
        const keys = await this.getApiKeys();
        this.send({ action: 'auth', params: keys.MASSIVE_API_KEY });
    }

    /**
     * Send message to WebSocket
     */
    private send(message: object): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Handle incoming WebSocket message
     */
    private async handleMessage(data: WebSocket.Data): Promise<void> {
        try {
            const messages = JSON.parse(data.toString());

            for (const msg of Array.isArray(messages) ? messages : [messages]) {
                switch (msg.ev) {
                    case 'status':
                        await this.handleStatus(msg);
                        break;
                    case 'AM':
                        await this.handleAggregateMinute(msg);
                        break;
                }
            }
        } catch (error) {
            logger.error('Failed to parse message:', error as Error);
        }
    }

    /**
     * Handle status message
     */
    private async handleStatus(msg: any): Promise<void> {
        if (msg.status === 'auth_success') {
            logger.info('Authentication successful.');
            this.authenticated = true;

            // Start heartbeat after authentication
            this.startPing();

            // Subscribe to previously subscribed symbols
            if (this.subscriptions.size > 0) {
                const symbols = Array.from(this.subscriptions);
                logger.info(`Re-subscribing to: ${symbols.join(', ')}`);
                this.subscribeInternal(symbols);
            }
        } else if (msg.status === 'auth_failed') {
            logger.error(`Authentication failed: ${msg.message}`);
        } else if (msg.status === 'success') {
            logger.info(msg.message);
        }
    }


    /**
     * Handle aggregate minute bar (AM event)
     * This is SIP data with 15-minute delay - more accurate than IEX
     */
    private async handleAggregateMinute(bar: any): Promise<void> {
        try {
            // Massive AM bar format:
            // { ev: 'AM', sym: 'AAPL', v: 1000, av: 50000, op: 150.0,
            //   vw: 150.5, o: 150.1, c: 150.8, h: 151.0, l: 150.0,
            //   a: 150.5, z: 100, s: 1702656000000, e: 1702656060000 }

            // Transform to standard format (reuse transformer pattern)
            const massiveBar = {
                t: bar.s,  // start timestamp
                o: bar.o,
                h: bar.h,
                l: bar.l,
                c: bar.c,
                v: bar.v,
                vw: bar.vw,
                n: bar.z,  // trade count
            };

            const record: QuoteRecord | null = transformMassiveBarToQuote(massiveBar, bar.sym, 'US');

            if (!record) {
                logger.warn(`Invalid bar data for ${bar.sym}, skipping.`);
                return;
            }

            logger.debug(
                `SIP Bar: ${record.ticker} ` +
                `O:${record.open} H:${record.high} L:${record.low} C:${record.close} ` +
                `V:${record.volume} @ ${record.time.toISOString()}`
            );

            // Write to InfluxDB (overwrites IEX data with same timestamp)
            await this.writer.writeQuotes([record]);
        } catch (error) {
            logger.error('Failed to process bar:', error as Error);
        }
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (!this.shouldBeConnected) return;

        if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
            logger.error('Max reconnect attempts reached.');
            return;
        }

        this.reconnectAttempts++;
        const delay = CONFIG.RECONNECT_DELAY_MS * this.reconnectAttempts;

        logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

        setTimeout(async () => {
            if (this.shouldBeConnected) {
                await this.connectInternal();
            }
        }, delay);
    }

    /**
     * Subscribe to symbols (public API)
     */
    subscribe(symbols: string[]): void {
        if (!symbols || symbols.length === 0) return;

        const newSymbols = symbols
            .map(s => s.toUpperCase())
            .filter(s => !this.subscriptions.has(s));

        if (newSymbols.length === 0) {
            logger.info('All symbols already subscribed.');
            return;
        }

        newSymbols.forEach(s => this.subscriptions.add(s));

        if (this.authenticated) {
            this.subscribeInternal(newSymbols);
        } else {
            logger.info(`Queued subscription for: ${newSymbols.join(', ')}`);
        }
    }

    /**
     * Internal subscribe logic
     */
    private subscribeInternal(symbols: string[]): void {
        // Subscribe to Aggregate Minute (AM) channel
        const params = symbols.map(s => `AM.${s}`).join(',');
        this.send({ action: 'subscribe', params });
        logger.info(`Subscribed to: ${symbols.join(', ')}`);
    }

    /**
     * Unsubscribe from symbols
     */
    unsubscribe(symbols: string[]): void {
        if (!symbols || symbols.length === 0) return;

        const removeSymbols = symbols.map(s => s.toUpperCase());
        removeSymbols.forEach(s => this.subscriptions.delete(s));

        if (this.authenticated) {
            const params = removeSymbols.map(s => `AM.${s}`).join(',');
            this.send({ action: 'unsubscribe', params });
            logger.info(`Unsubscribed from: ${removeSymbols.join(', ')}`);
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
        return this.connected && this.authenticated;
    }

    /**
     * Disconnect from WebSocket (public API)
     */
    disconnect(): void {
        this.shouldBeConnected = false;
        this.stopMarketMonitor();
        this.disconnectInternal();
    }

    /**
     * Internal disconnect logic
     */
    private disconnectInternal(): void {
        this.stopPing();
        if (this.ws) {
            logger.info('Disconnecting...');
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.connecting = false;
        this.authenticated = false;
        logger.info('Disconnected.');
    }
}
