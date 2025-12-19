/**
 * InfluxDB Writer Service
 *
 * Handles writing time-series data to Amazon Timestream for InfluxDB.
 * Uses the InfluxDB 3.x client for high-performance writes.
 *
 * Note: InfluxDB uses schema-on-write, no explicit table creation needed.
 * Data is organized by measurements (tables) with tags (indexed) and fields.
 */

import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

import type {
    QuoteRecord,
    DailyRecord,
    NewsRecord,
    FundamentalsRecord,
} from '@wavepilot/shared';

// Configuration
const INFLUXDB_ENDPOINT = process.env.INFLUXDB_ENDPOINT || '';
const INFLUXDB_SECRET_ARN = process.env.INFLUXDB_SECRET_ARN || '';
const DATABASE = process.env.INFLUXDB_DATABASE || 'market_data';

// Measurement names (InfluxDB "tables")
const QUOTES_RAW_MEASUREMENT = 'stock_quotes_raw';
const QUOTES_AGGREGATED_MEASUREMENT = 'stock_quotes_aggregated';
const NEWS_MEASUREMENT = 'news';
const FUNDAMENTALS_MEASUREMENT = 'fundamentals';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize string for InfluxDB Line Protocol
 * The InfluxDB client should handle escaping, but we need to handle edge cases
 */
function sanitizeString(value: string | undefined): string {
    if (!value) return '';
    // Remove control characters and limit size
    // The InfluxDB client handles quote escaping internally
    return value
        .replace(/[\x00-\x1F\x7F]/g, ' ')  // Replace control chars with space
        .substring(0, 10000); // Limit field size
}

/**
 * Sanitize tag value for InfluxDB (tags have stricter requirements)
 * Tags cannot contain spaces, commas, equals signs, or backslashes
 * Dots are allowed but we escape them for safety
 */
function sanitizeTag(value: string): string {
    return value
        .replace(/\\/g, '')        // Remove backslashes
        .replace(/[,= \n\r]/g, '_') // Replace special chars with underscore
        .substring(0, 256);
}

// ============================================================================
// InfluxDB Writer Class
// ============================================================================

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
            const secretResponse = await this.secretsClient.send(
                new GetSecretValueCommand({ SecretId: INFLUXDB_SECRET_ARN })
            );

            if (!secretResponse.SecretString) {
                throw new Error('Failed to retrieve InfluxDB credentials');
            }

            const credentials = JSON.parse(secretResponse.SecretString);
            const token = credentials.token || credentials.password;

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
            const points = records.map((record) => {
                const point = Point.measurement(QUOTES_RAW_MEASUREMENT)
                    // Tags (indexed)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    // Fields
                    .setStringField('name', record.name)
                    .setFloatField('open', record.open)
                    .setFloatField('high', record.high)
                    .setFloatField('low', record.low)
                    .setFloatField('close', record.close)
                    .setIntegerField('volume', record.volume)
                    .setTimestamp(record.time);

                // Optional fields
                if (record.vwap !== undefined) point.setFloatField('vwap', record.vwap);
                if (record.trades !== undefined) point.setIntegerField('trades', record.trades);
                if (record.change !== undefined) point.setFloatField('change', record.change);
                if (record.changePercent !== undefined) point.setFloatField('changePercent', record.changePercent);
                if (record.previousClose !== undefined) point.setFloatField('previousClose', record.previousClose);

                return point;
            });

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
            const points = records.map((record) => {
                const point = Point.measurement(QUOTES_AGGREGATED_MEASUREMENT)
                    // Tags (indexed)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    // Fields
                    .setStringField('name', record.name)
                    .setFloatField('open', record.open)
                    .setFloatField('high', record.high)
                    .setFloatField('low', record.low)
                    .setFloatField('close', record.close)
                    .setIntegerField('volume', record.volume)
                    .setTimestamp(record.time);

                // Optional fields
                if (record.vwap !== undefined) point.setFloatField('vwap', record.vwap);
                if (record.trades !== undefined) point.setIntegerField('trades', record.trades);
                if (record.change !== undefined) point.setFloatField('change', record.change);
                if (record.changePercent !== undefined) point.setFloatField('changePercent', record.changePercent);

                return point;
            });

            await client.write(points);
            console.log(`[InfluxDBWriter] Successfully wrote ${records.length} daily records.`);
        } catch (error) {
            console.error('[InfluxDBWriter] Failed to write daily data:', error);
            throw error;
        }
    }

    /**
     * Write news metadata records to news measurement
     * Note: Full content should be stored in S3, this only stores metadata
     */
    async writeNews(records: NewsRecord[]): Promise<void> {
        const client = await this.ensureInitialized();
        console.log(`[InfluxDBWriter] Writing ${records.length} news records...`);

        let successCount = 0;
        for (const record of records) {
            try {
                await this.writeNewsRecord(client, record);
                successCount++;
            } catch (error) {
                console.error(`[InfluxDBWriter] Failed to write news ${record.id}:`, error);
            }
        }
        console.log(`[InfluxDBWriter] Successfully wrote ${successCount}/${records.length} news records.`);
    }

    /**
     * Write a single news record
     */
    private async writeNewsRecord(client: InfluxDBClient, record: NewsRecord): Promise<void> {
        try {
            const point = Point.measurement(NEWS_MEASUREMENT)
                // Tags (indexed)
                .setTag('ticker', sanitizeTag(record.ticker))
                .setTag('market', sanitizeTag(record.market))
                .setTag('source', sanitizeTag(record.source))
                // Required fields
                .setStringField('id', record.id)
                .setStringField('title', sanitizeString(record.title))
                .setStringField('url', record.url)
                .setTimestamp(record.time);

            // Optional string fields
            if (record.author) point.setStringField('author', sanitizeString(record.author));
            if (record.description) point.setStringField('description', sanitizeString(record.description));
            if (record.imageUrl) point.setStringField('imageUrl', record.imageUrl);
            if (record.s3Path) point.setStringField('s3Path', record.s3Path);

            // Array fields stored as JSON strings
            if (record.keywords?.length) {
                point.setStringField('keywords', JSON.stringify(record.keywords));
            }
            if (record.tickers?.length) {
                point.setStringField('relatedTickers', JSON.stringify(record.tickers));
            }

            // Sentiment fields - 'sentiment' is a reserved word in InfluxDB
            if (record.sentiment) point.setStringField('sentimentValue', record.sentiment);
            if (record.sentimentReasoning) {
                point.setStringField('sentimentReason', sanitizeString(record.sentimentReasoning));
            }
            if (record.sentimentScore !== undefined) {
                point.setFloatField('sentimentNum', record.sentimentScore);
            }

            await client.write([point]);
        } catch (error) {
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
                    // Tags (indexed)
                    .setTag('ticker', record.ticker)
                    .setTag('market', record.market)
                    .setTag('periodType', record.periodType)
                    .setTimestamp(record.time);

                // Period identification
                if (record.fiscalYear !== undefined) point.setIntegerField('fiscalYear', record.fiscalYear);
                if (record.fiscalPeriod) point.setStringField('fiscalPeriod', record.fiscalPeriod);
                if (record.filingDate) point.setStringField('filingDate', record.filingDate.toISOString().split('T')[0]);

                // Company info
                if (record.companyName) point.setStringField('companyName', record.companyName);
                if (record.cik) point.setStringField('cik', record.cik);
                if (record.sic) point.setStringField('sic', record.sic);

                // Income Statement
                if (record.revenue !== undefined) point.setFloatField('revenue', record.revenue);
                if (record.costOfRevenue !== undefined) point.setFloatField('costOfRevenue', record.costOfRevenue);
                if (record.grossProfit !== undefined) point.setFloatField('grossProfit', record.grossProfit);
                if (record.operatingExpenses !== undefined) point.setFloatField('operatingExpenses', record.operatingExpenses);
                if (record.operatingIncome !== undefined) point.setFloatField('operatingIncome', record.operatingIncome);
                if (record.netIncome !== undefined) point.setFloatField('netIncome', record.netIncome);
                if (record.eps !== undefined) point.setFloatField('eps', record.eps);
                if (record.epsDiluted !== undefined) point.setFloatField('epsDiluted', record.epsDiluted);
                if (record.sharesBasic !== undefined) point.setFloatField('sharesBasic', record.sharesBasic);
                if (record.sharesDiluted !== undefined) point.setFloatField('sharesDiluted', record.sharesDiluted);

                // Balance Sheet
                if (record.totalAssets !== undefined) point.setFloatField('totalAssets', record.totalAssets);
                if (record.currentAssets !== undefined) point.setFloatField('currentAssets', record.currentAssets);
                if (record.totalLiabilities !== undefined) point.setFloatField('totalLiabilities', record.totalLiabilities);
                if (record.currentLiabilities !== undefined) point.setFloatField('currentLiabilities', record.currentLiabilities);
                if (record.totalEquity !== undefined) point.setFloatField('totalEquity', record.totalEquity);
                if (record.fixedAssets !== undefined) point.setFloatField('fixedAssets', record.fixedAssets);
                if (record.accountsPayable !== undefined) point.setFloatField('accountsPayable', record.accountsPayable);

                // Cash Flow
                if (record.operatingCashFlow !== undefined) point.setFloatField('operatingCashFlow', record.operatingCashFlow);
                if (record.investingCashFlow !== undefined) point.setFloatField('investingCashFlow', record.investingCashFlow);
                if (record.financingCashFlow !== undefined) point.setFloatField('financingCashFlow', record.financingCashFlow);
                if (record.netCashFlow !== undefined) point.setFloatField('netCashFlow', record.netCashFlow);

                // Ratios
                if (record.pe !== undefined) point.setFloatField('pe', record.pe);
                if (record.pb !== undefined) point.setFloatField('pb', record.pb);
                if (record.marketCap !== undefined) point.setFloatField('marketCap', record.marketCap);
                if (record.roe !== undefined) point.setFloatField('roe', record.roe);

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
