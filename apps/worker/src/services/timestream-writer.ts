/**
 * InfluxDB Writer Service
 *
 * Handles writing time-series data to Amazon Timestream for InfluxDB.
 * Uses the InfluxDB 3.x client for high-performance writes.
 */

import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const INFLUXDB_ENDPOINT = process.env.INFLUXDB_ENDPOINT || '';
const INFLUXDB_SECRET_ARN = process.env.INFLUXDB_SECRET_ARN || '';
const DATABASE = 'market-data';

// Measurement names
const QUOTES_RAW_MEASUREMENT = 'stock_quotes_raw';
const QUOTES_AGGREGATED_MEASUREMENT = 'stock_quotes_aggregated';
const NEWS_MEASUREMENT = 'news';
const FUNDAMENTALS_MEASUREMENT = 'fundamentals';

export interface QuoteRecord {
    time: Date;
    ticker: string;
    name: string;
    market: 'US' | 'CN' | 'HK';
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    high: number;
    low: number;
    open: number;
    previousClose: number;
}

export interface DailyRecord {
    time: Date;
    ticker: string;
    name: string;
    market: 'US' | 'CN' | 'HK';
    open: number;
    high: number;
    low: number;
    close: number;
    change: number;
    changePercent: number;
    volume: number;
    trades: number;
}

export interface NewsRecord {
    time: Date;
    ticker: string;
    market: 'US' | 'CN' | 'HK';
    title: string;
    source: string;
    url: string;
    s3Path?: string;
    sentiment?: number;
}

export interface FundamentalsRecord {
    time: Date;
    ticker: string;
    market: 'US' | 'CN' | 'HK';
    periodType: 'quarterly' | 'annual';
    revenue?: number;
    netIncome?: number;
    eps?: number;
    pe?: number;
    pb?: number;
    marketCap?: number;
}

export class InfluxDBWriter {
    private client: InfluxDBClient | null = null;
    private secretsClient: SecretsManagerClient;
    private initialized: boolean = false;

    constructor() {
        this.secretsClient = new SecretsManagerClient({});
        console.log('[InfluxDBWriter] Created.');
    }

    /**
     * Initialize the InfluxDB client with credentials from Secrets Manager
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Get credentials from Secrets Manager
            const secretResponse = await this.secretsClient.send(
                new GetSecretValueCommand({ SecretId: INFLUXDB_SECRET_ARN })
            );

            if (!secretResponse.SecretString) {
                throw new Error('Failed to retrieve InfluxDB credentials');
            }

            const credentials = JSON.parse(secretResponse.SecretString);
            const token = credentials.token || credentials.password; // InfluxDB API token

            // Initialize InfluxDB client
            this.client = new InfluxDBClient({
                host: `https://${INFLUXDB_ENDPOINT}:8181`,
                token: token,
                database: DATABASE,
            });

            this.initialized = true;
            console.log('[InfluxDBWriter] Initialized successfully.');
        } catch (error) {
            console.error('[InfluxDBWriter] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Ensure client is initialized before operations
     */
    private async ensureInitialized(): Promise<InfluxDBClient> {
        if (!this.initialized || !this.client) {
            await this.initialize();
        }
        if (!this.client) {
            throw new Error('InfluxDB client not initialized');
        }
        return this.client;
    }

    /**
     * Write real-time quote records to stock_quotes_raw
     */
    async writeQuotes(records: QuoteRecord[]): Promise<void> {
        const client = await this.ensureInitialized();
        console.log(`[InfluxDBWriter] Writing ${records.length} quote records...`);

        try {
            const points = records.map((record) =>
                Point.measurement(QUOTES_RAW_MEASUREMENT)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    .setStringField('name', record.name)
                    .setFloatField('price', record.price)
                    .setFloatField('change', record.change)
                    .setFloatField('changePercent', record.changePercent)
                    .setIntegerField('volume', record.volume)
                    .setFloatField('high', record.high)
                    .setFloatField('low', record.low)
                    .setFloatField('open', record.open)
                    .setFloatField('previousClose', record.previousClose)
                    .setTimestamp(record.time)
            );

            await client.write(points);
            console.log(`[InfluxDBWriter] Successfully wrote ${records.length} quote records.`);
        } catch (error) {
            console.error('[InfluxDBWriter] Failed to write quotes:', error);
            throw error;
        }
    }

    /**
     * Write daily aggregated records to stock_quotes_aggregated
     */
    async writeDailyData(records: DailyRecord[]): Promise<void> {
        const client = await this.ensureInitialized();
        console.log(`[InfluxDBWriter] Writing ${records.length} daily records...`);

        try {
            const points = records.map((record) =>
                Point.measurement(QUOTES_AGGREGATED_MEASUREMENT)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    .setStringField('name', record.name)
                    .setFloatField('open', record.open)
                    .setFloatField('high', record.high)
                    .setFloatField('low', record.low)
                    .setFloatField('close', record.close)
                    .setFloatField('change', record.change)
                    .setFloatField('changePercent', record.changePercent)
                    .setIntegerField('volume', record.volume)
                    .setIntegerField('trades', record.trades)
                    .setTimestamp(record.time)
            );

            await client.write(points);
            console.log(`[InfluxDBWriter] Successfully wrote ${records.length} daily records.`);
        } catch (error) {
            console.error('[InfluxDBWriter] Failed to write daily data:', error);
            throw error;
        }
    }

    /**
     * Write news metadata records
     */
    async writeNews(records: NewsRecord[]): Promise<void> {
        const client = await this.ensureInitialized();
        console.log(`[InfluxDBWriter] Writing ${records.length} news records...`);

        try {
            const points = records.map((record) => {
                const point = Point.measurement(NEWS_MEASUREMENT)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    .setTag('source', record.source)
                    .setStringField('title', record.title)
                    .setStringField('url', record.url)
                    .setTimestamp(record.time);

                if (record.s3Path) {
                    point.setStringField('s3_path', record.s3Path);
                }

                if (record.sentiment !== undefined) {
                    point.setFloatField('sentiment', record.sentiment);
                }

                return point;
            });

            await client.write(points);
            console.log(`[InfluxDBWriter] Successfully wrote ${records.length} news records.`);
        } catch (error) {
            console.error('[InfluxDBWriter] Failed to write news:', error);
            throw error;
        }
    }

    /**
     * Write fundamentals (financial) data records
     */
    async writeFundamentals(records: FundamentalsRecord[]): Promise<void> {
        const client = await this.ensureInitialized();
        console.log(`[InfluxDBWriter] Writing ${records.length} fundamentals records...`);

        try {
            const points = records.map((record) => {
                const point = Point.measurement(FUNDAMENTALS_MEASUREMENT)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    .setTag('periodType', record.periodType)
                    .setTimestamp(record.time);

                if (record.revenue !== undefined) point.setFloatField('revenue', record.revenue);
                if (record.netIncome !== undefined) point.setFloatField('netIncome', record.netIncome);
                if (record.eps !== undefined) point.setFloatField('eps', record.eps);
                if (record.pe !== undefined) point.setFloatField('pe', record.pe);
                if (record.pb !== undefined) point.setFloatField('pb', record.pb);
                if (record.marketCap !== undefined) point.setFloatField('marketCap', record.marketCap);

                return point;
            });

            await client.write(points);
            console.log(`[InfluxDBWriter] Successfully wrote ${records.length} fundamentals records.`);
        } catch (error) {
            console.error('[InfluxDBWriter] Failed to write fundamentals:', error);
            throw error;
        }
    }

    /**
     * Close the InfluxDB client connection
     */
    async close(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.initialized = false;
            console.log('[InfluxDBWriter] Connection closed.');
        }
    }
}

// Export legacy name for backwards compatibility
export { InfluxDBWriter as TimestreamWriter };
