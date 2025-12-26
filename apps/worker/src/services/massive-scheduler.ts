/**
 * Massive API Scheduler
 *
 * Schedules periodic API calls to Massive for:
 * - Full market snapshots (every 5 minutes during trading hours)
 * - Grouped daily data (EOD correction after market close)
 * - News fetching (every 15 minutes)
 * - Financials update (daily)
 *
 * Uses node-cron for scheduling with market hours awareness.
 */

import cron from 'node-cron';
import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
    restClient,
    GetStocksAggregatesTimespanEnum,
    ListNewsSortEnum,
} from '@massive.com/client-js';
import type { InfluxDBWriter } from './timestream-writer';
import { NewsService } from './news-service';
import {
    transformMassiveBarToQuote,
    transformMassiveBarToDaily,
    transformMassiveSnapshotToDaily,
    transformMassiveFinancialsToRecord,
} from '../utils/transformers';
import {
    isMarketOpen,
} from '../utils/market-status';
import { createLogger } from '../utils/logger';
import {
    DB_WRITE_BATCH_SIZE,
    API_REQUEST_DELAY_MS,
    BACKFILL_REQUEST_DELAY_MS,
} from '../utils/constants';
import type { DailyRecord, FundamentalsRecord, QuoteRecord } from '@wavepilot/shared';

import { CONFIG } from '../config';

const logger = createLogger('MassiveScheduler');

interface ApiKeys {
    MASSIVE_API_KEY: string;
}

interface ScheduledTask {
    name: string;
    task: cron.ScheduledTask;
}

// Type definitions for Massive API responses
interface MassiveSnapshotTicker {
    ticker: string;
    day?: {
        o?: number;
        h?: number;
        l?: number;
        c?: number;
        v?: number;
        vw?: number;
    };
    todaysChange?: number;
    todaysChangePerc?: number;
}

interface MassiveSnapshotResponse {
    tickers?: MassiveSnapshotTicker[];
    results?: MassiveSnapshotTicker[];
}

interface MassiveBar {
    T?: string;
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    vw?: number;
    n?: number;
}

export class MassiveScheduler {
    private writer: InfluxDBWriter;
    private newsService: NewsService;
    private secretsClient: SecretsManagerClient;
    private apiKeys: ApiKeys | null = null;
    private tasks: ScheduledTask[] = [];
    private running: boolean = false;

    // Watchlist symbols to track (can be updated dynamically)
    private watchlistSymbols: Set<string> = new Set(CONFIG.DEFAULT_WATCHLIST);

    constructor(writer: InfluxDBWriter) {
        this.writer = writer;
        this.newsService = new NewsService(writer);
        this.secretsClient = new SecretsManagerClient({ region: CONFIG.AWS_REGION });
        logger.info('Service created.');
    }

    /**
     * Check if scheduler is running
     */
    isRunning(): boolean {
        return this.running;
    }

    /**
     * Get current watchlist
     */
    getWatchlist(): string[] {
        return Array.from(this.watchlistSymbols);
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
     * Update watchlist symbols
     */
    updateWatchlist(symbols: string[]): void {
        this.watchlistSymbols = new Set(symbols.map(s => s.toUpperCase()));
        logger.info(`Watchlist updated: ${Array.from(this.watchlistSymbols).join(', ')}`);
    }

    /**
     * Add symbols to watchlist
     */
    addToWatchlist(symbols: string[]): void {
        symbols.forEach(s => this.watchlistSymbols.add(s.toUpperCase()));
        logger.info(`Added to watchlist: ${symbols.join(', ')}`);
    }

    /**
     * Remove symbols from watchlist
     */
    removeFromWatchlist(symbols: string[]): void {
        symbols.forEach(s => this.watchlistSymbols.delete(s.toUpperCase()));
        logger.info(`Removed from watchlist: ${symbols.join(', ')}`);
    }

    /**
     * Start all scheduled tasks
     */
    start(): void {
        if (this.running) {
            logger.info('Already running.');
            return;
        }

        this.running = true;
        logger.info('Starting scheduled tasks...');

        // Schedule 1: Market snapshot every 5 minutes during trading hours
        // Cron: At minute 0, 5, 10, ... of every hour, Mon-Fri
        const snapshotTask = cron.schedule('*/5 * * * 1-5', async () => {
            if (await isMarketOpen()) {
                await this.fetchSnapshot();
            }
        }, { timezone: 'America/New_York' });
        this.tasks.push({ name: 'snapshot', task: snapshotTask });

        // Schedule 2: EOD correction at 4:30 PM ET (after market close)
        // Corrects both daily aggregated data and watchlist minute data
        const eodTask = cron.schedule('30 16 * * 1-5', async () => {
            const today = new Date().toISOString().split('T')[0];
            // Correct daily aggregated data (all tickers)
            await this.fetchGroupedDaily(today);
            // Correct minute data for watchlist symbols
            await this.correctWatchlistMinuteData(today);
        }, { timezone: 'America/New_York' });
        this.tasks.push({ name: 'eod', task: eodTask });

        // Schedule 3: News fetching every 15 minutes
        const newsTask = cron.schedule('*/15 * * * *', async () => {
            await this.fetchNews();
        });
        this.tasks.push({ name: 'news', task: newsTask });

        // Schedule 4: Financials update daily at 6 AM ET
        const financialsTask = cron.schedule('0 6 * * 1-5', async () => {
            await this.fetchFinancials();
        }, { timezone: 'America/New_York' });
        this.tasks.push({ name: 'financials', task: financialsTask });

        logger.info('Scheduled tasks:');
        logger.info('  - Market snapshot: every 5 min during trading hours');
        logger.info('  - EOD correction: 4:30 PM ET Mon-Fri');
        logger.info('  - News fetching: every 15 min');
        logger.info('  - Financials update: 6 AM ET Mon-Fri');
    }

    /**
     * Stop all scheduled tasks
     */
    stop(): void {
        this.running = false;
        this.tasks.forEach(({ name, task }) => {
            task.stop();
            logger.info(`Stopped task: ${name}`);
        });
        this.tasks = [];
        logger.info('All scheduled tasks stopped.');
    }

    /**
     * Fetch full market snapshot using Snapshot - All Tickers API
     * Returns current price data for all tickers (15-minute delayed)
     * Used for heatmap, gainers/losers during trading hours
     */
    async fetchSnapshot(): Promise<void> {
        logger.info('Fetching market snapshot...');

        try {
            const keys = await this.getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.MASSIVE_BASE_URL);

            // Use getSnapshots to fetch all stock tickers
            const response = await massive.getSnapshots({
                type: 'stocks' as any,
                limit: 50000, // Get all tickers
            }) as MassiveSnapshotResponse;

            const tickers = response.tickers || response.results || [];
            logger.info(`Received ${tickers.length} tickers in snapshot.`);

            if (tickers.length > 0) {
                const today = new Date().toISOString().split('T')[0];

                // Transform snapshot data to DailyRecord format
                const records: DailyRecord[] = tickers
                    .filter((t) => t.day)
                    .map((t) => transformMassiveSnapshotToDaily(t, CONFIG.DEFAULT_MARKET, new Date(today)));

                // Write in batches
                for (let i = 0; i < records.length; i += DB_WRITE_BATCH_SIZE) {
                    const batch = records.slice(i, i + DB_WRITE_BATCH_SIZE);
                    await this.writer.writeDailyData(batch);
                }

                logger.info(`Wrote ${records.length} market snapshot records.`);
            }
        } catch (error) {
            logger.error('Failed to fetch snapshot:', error as Error);
        }
    }

    /**
     * Fetch grouped daily data for EOD correction
     */
    async fetchGroupedDaily(date: string): Promise<void> {
        logger.info(`Fetching grouped daily for ${date}...`);

        try {
            const keys = await this.getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.MASSIVE_BASE_URL);

            const response = await massive.getGroupedStocksAggregates({
                date: date,
            });

            const bars = (response.results || []) as MassiveBar[];
            logger.info(`Received ${bars.length} tickers for EOD correction.`);

            if (bars.length > 0) {
                // Store all tickers for EOD (this is the authoritative daily data)
                const records: DailyRecord[] = bars.map((b) =>
                    transformMassiveBarToDaily(b, b.T!, CONFIG.DEFAULT_MARKET, new Date(date))
                );

                // Write in batches to avoid overwhelming the database
                for (let i = 0; i < records.length; i += DB_WRITE_BATCH_SIZE) {
                    const batch = records.slice(i, i + DB_WRITE_BATCH_SIZE);
                    await this.writer.writeDailyData(batch);
                    logger.info(`Wrote batch ${Math.floor(i / DB_WRITE_BATCH_SIZE) + 1}/${Math.ceil(records.length / DB_WRITE_BATCH_SIZE)}`);
                }

                logger.info(`EOD correction complete: ${records.length} records.`);
            }
        } catch (error) {
            logger.error('Failed to fetch grouped daily:', error as Error);
        }
    }

    /**
     * Fetch latest news for watchlist symbols
     */
    async fetchNews(): Promise<void> {
        logger.info('Fetching news...');

        try {
            const keys = await this.getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.MASSIVE_BASE_URL);

            // Fetch news for each watchlist symbol
            for (const ticker of this.watchlistSymbols) {
                try {
                    // @ts-ignore - SDK type mismatch
                    const response = await massive.listNews({
                        ticker: ticker,
                        limit: 5,
                        sort: ListNewsSortEnum.PublishedUtc,
                    });

                    const newsItems = response.results || [];

                    if (newsItems.length > 0) {
                        await this.newsService.saveNewsFromMassive(
                            newsItems as any,
                            ticker,
                            CONFIG.DEFAULT_MARKET,
                            true // fetch content
                        );
                        logger.info(`Saved ${newsItems.length} news items for ${ticker}.`);
                    }
                } catch (error) {
                    logger.error(`Failed to fetch news for ${ticker}:`, error as Error);
                }

                // Small delay between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
            }
        } catch (error) {
            logger.error('Failed to fetch news:', error as Error);
        }
    }

    /**
     * Fetch financials for watchlist symbols
     */
    async fetchFinancials(): Promise<void> {
        logger.info('Fetching financials...');

        try {
            const keys = await this.getApiKeys();

            for (const ticker of this.watchlistSymbols) {
                try {
                    const url = `${CONFIG.MASSIVE_BASE_URL}/vX/reference/financials?ticker=${ticker}&limit=4`;

                    const response = await fetch(url, {
                        headers: {
                            'Authorization': `Bearer ${keys.MASSIVE_API_KEY}`,
                        },
                    });

                    if (!response.ok) {
                        if (response.status === 403 || response.status === 404) {
                            logger.info(`Financials not available for ${ticker} (${response.status})`);
                            continue;
                        }
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    const results = data.results || [];

                    if (results.length > 0) {
                        const records: FundamentalsRecord[] = results.map((item: any) =>
                            transformMassiveFinancialsToRecord(item, ticker, CONFIG.DEFAULT_MARKET)
                        );
                        await this.writer.writeFundamentals(records);
                        logger.info(`Saved ${records.length} financial records for ${ticker}.`);
                    }
                } catch (error) {
                    logger.error(`Failed to fetch financials for ${ticker}:`, error as Error);
                }

                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
            }
        } catch (error) {
            logger.error('Failed to fetch financials:', error as Error);
        }
    }

    /**
     * Correct watchlist minute data using Massive SIP data (full day)
     * Called after market close to replace IEX data with official SIP data
     * Note: During trading hours, MassiveWebSocketService handles real-time SIP correction
     */
    async correctWatchlistMinuteData(date: string): Promise<void> {
        logger.info(`Correcting watchlist minute data for ${date}...`);

        try {
            const keys = await this.getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.MASSIVE_BASE_URL);

            for (const ticker of this.watchlistSymbols) {
                try {
                    logger.info(`Fetching SIP minute data for ${ticker}...`);

                    const response = await massive.getStocksAggregates({
                        stocksTicker: ticker,
                        multiplier: 1,
                        timespan: GetStocksAggregatesTimespanEnum.Minute,
                        from: date,
                        to: date,
                    });

                    const bars = (response.results || []) as MassiveBar[];

                    if (bars.length > 0) {
                        const records: (QuoteRecord | null)[] = bars.map((b) =>
                            transformMassiveBarToQuote(b, ticker, CONFIG.DEFAULT_MARKET)
                        );
                        const validRecords = records.filter((r): r is QuoteRecord => r !== null);
                        if (validRecords.length > 0) {
                            await this.writer.writeQuotes(validRecords);
                            logger.info(`Corrected ${validRecords.length} minute bars for ${ticker}.`);
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to correct minute data for ${ticker}:`, error as Error);
                }

                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY_MS));
            }

            logger.info('Watchlist minute data correction complete.');
        } catch (error) {
            logger.error('Failed to correct watchlist minute data:', error as Error);
        }
    }

    /**
     * Manually trigger a task (for testing or on-demand execution)
     */
    async runTask(taskName: 'snapshot' | 'eod' | 'news' | 'financials'): Promise<void> {
        logger.info(`Manually running task: ${taskName}`);

        switch (taskName) {
            case 'snapshot':
                await this.fetchSnapshot();
                break;
            case 'eod':
                const today = new Date().toISOString().split('T')[0];
                await this.fetchGroupedDaily(today);
                break;
            case 'news':
                await this.fetchNews();
                break;
            case 'financials':
                await this.fetchFinancials();
                break;
            default:
                logger.error(`Unknown task: ${taskName}`);
        }
    }

    /**
     * Backfill historical daily data for a symbol
     */
    async backfillDailyHistory(
        ticker: string,
        startDate: string,
        endDate: string = new Date().toISOString().split('T')[0]
    ): Promise<void> {
        logger.info(`Backfilling daily history for ${ticker} (${startDate} -> ${endDate})...`);

        try {
            const keys = await this.getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.MASSIVE_BASE_URL);

            const response = await massive.getStocksAggregates({
                stocksTicker: ticker,
                multiplier: 1,
                timespan: GetStocksAggregatesTimespanEnum.Day,
                from: startDate,
                to: endDate,
            });

            const bars = (response.results || []) as MassiveBar[];
            logger.info(`Received ${bars.length} daily bars for ${ticker}.`);

            if (bars.length > 0) {
                const records: DailyRecord[] = bars.map((b) =>
                    transformMassiveBarToDaily(b, ticker, CONFIG.DEFAULT_MARKET)
                );
                await this.writer.writeDailyData(records);
                logger.info(`Backfill complete: ${records.length} daily records for ${ticker}.`);
            }
        } catch (error) {
            logger.error(`Failed to backfill ${ticker}:`, error as Error);
        }
    }

    /**
     * Stage 1 Data Stitching: Backfill history for symbol(s)
     * Fetches SIP data from Massive for the last 30 days (Daily + Minute)
     */
    async backfillHistory(symbols: string[]): Promise<void> {
        if (!symbols || symbols.length === 0) return;

        logger.info(`Starting Stage 1 backfill for: ${symbols.join(', ')}`);

        // Calculate time range
        const now = new Date();
        const endTime = new Date(now.getTime() - CONFIG.STITCHING_DELAY_MINUTES * 60 * 1000); // 15 mins ago
        const startTime = new Date(now.getTime() - CONFIG.BACKFILL_DAYS * 24 * 60 * 60 * 1000); // 30 days ago

        const fromDate = startTime.toISOString().split('T')[0];
        const toDate = endTime.toISOString().split('T')[0];

        try {
            const keys = await this.getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.MASSIVE_BASE_URL);

            for (const ticker of symbols) {
                const safeTicker = ticker.toUpperCase();

                // 1. Backfill Daily Aggegated Data (for long-term charts)
                await this.backfillDailyHistory(safeTicker, fromDate, toDate);

                // 2. Backfill Minute Raw Data (for intraday/recent charts, last 30 days)
                logger.info(`Backfilling minute data for ${safeTicker} (${fromDate} -> ${toDate})...`);
                try {
                    // Note: Massive limits result count (defaults to 5000?)
                    // For 30 days of minute data, we might need pagination or high limit.
                    // Assuming limit=50000 covers ~30 days (30 * 6.5 * 60 = 11700 bars)
                    const response = await massive.getStocksAggregates({
                        stocksTicker: safeTicker,
                        multiplier: 1,
                        timespan: GetStocksAggregatesTimespanEnum.Minute,
                        from: fromDate,
                        to: toDate,
                        limit: 50000,
                    });

                    const bars = (response.results || []) as MassiveBar[];

                    if (bars.length > 0) {
                        const records: (QuoteRecord | null)[] = bars.map((b) =>
                            transformMassiveBarToQuote(b, safeTicker, CONFIG.DEFAULT_MARKET)
                        );
                        // Filter out invalid records and bars that are too new (encroach on Stage 2 IEX territory)
                        const validRecords = records
                            .filter((r): r is QuoteRecord => r !== null)
                            .filter(r => r.time <= endTime);

                        if (validRecords.length > 0) {
                            await this.writer.writeQuotes(validRecords);
                            logger.info(`Backfilled ${validRecords.length} minute bars for ${safeTicker}.`);
                        }
                    }
                } catch (err) {
                    logger.error(`Failed to backfill minutes for ${safeTicker}:`, err as Error);
                }

                // Rate limit spacing
                await new Promise(resolve => setTimeout(resolve, BACKFILL_REQUEST_DELAY_MS));
            }
        } catch (error) {
            logger.error('Failed to execute Stage 1 backfill:', error as Error);
        }
    }
}
