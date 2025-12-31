/**
 * Minute Data Backfill Script (REST API)
 *
 * Fetches minute-level OHLCV data for watchlist symbols via Massive REST API.
 * Only downloads data for specified tickers (not full market).
 *
 * Usage:
 *   # Backfill watchlist (from .env DEFAULT_WATCHLIST)
 *   npx tsx scripts/backfill-minute.ts
 *
 *   # Backfill specific tickers
 *   npx tsx scripts/backfill-minute.ts --tickers AAPL,TSLA,NVDA
 *
 *   # Backfill specific period
 *   npx tsx scripts/backfill-minute.ts --months 3
 *
 *   # Dry run
 *   npx tsx scripts/backfill-minute.ts --dry-run
 *
 * Environment Variables:
 *   API_KEYS_SECRET_ARN   - AWS Secrets Manager ARN for API keys
 *   INFLUXDB_ENDPOINT     - InfluxDB endpoint
 *   INFLUXDB_SECRET_ARN   - Secrets Manager ARN for InfluxDB credentials
 *   INFLUXDB_DATABASE     - InfluxDB database name
 *   DEFAULT_WATCHLIST     - Default watchlist (comma-separated)
 */

import 'dotenv/config';

// Disable TLS verification for SSH tunnel scenarios
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Force IPv4: Monkey patch dns.lookup to avoid IPv6 issues
import dns from 'node:dns';
const originalLookup = dns.lookup;
(dns as any).lookup = (
    hostname: string,
    options: dns.LookupOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
    callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const newOptions = (options && typeof options === 'object') ? { ...options, family: 4 } : { family: 4 };
    return (originalLookup as any)(hostname, newOptions, callback);
};

import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
    restClient,
    GetStocksAggregatesTimespanEnum,
} from '@massive.com/client-js';
import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { format, subMonths, addDays } from 'date-fns';

// ============================================================================
// Configuration
// ============================================================================

interface BackfillConfig {
    tickers: string[];
    months: number;
    dryRun: boolean;
    batchSize: number;
    requestDelay: number; // ms between API calls
}

const DEFAULT_CONFIG: BackfillConfig = {
    tickers: (process.env.DEFAULT_WATCHLIST || 'AAPL,TSLA,NVDA').split(','),
    months: 6,
    dryRun: false,
    batchSize: 5000,
    requestDelay: 200, // Avoid rate limiting
};

// ============================================================================
// Types
// ============================================================================

interface MassiveBar {
    t: number;  // timestamp (ms)
    o: number;  // open
    h: number;  // high
    l: number;  // low
    c: number;  // close
    v: number;  // volume
    vw?: number; // vwap
    n?: number;  // trades
}

interface Stats {
    tickersProcessed: number;
    daysProcessed: number;
    recordsProcessed: number;
    recordsWritten: number;
    errors: number;
    startTime: Date;
}

// ============================================================================
// API Client
// ============================================================================

let cachedApiKey: string | null = null;

async function getApiKey(): Promise<string> {
    if (cachedApiKey) return cachedApiKey;

    const secretArn = process.env.API_KEYS_SECRET_ARN || 'wavepilot/api-keys';
    const region = process.env.AWS_REGION || 'us-west-2';

    console.log(`🔑 Fetching API key from Secrets Manager...`);

    const client = new SecretsManagerClient({ region });
    const response = await client.send(
        new GetSecretValueCommand({ SecretId: secretArn })
    );

    if (!response.SecretString) {
        throw new Error('Failed to retrieve API keys from Secrets Manager');
    }

    const secrets = JSON.parse(response.SecretString);
    cachedApiKey = secrets.MASSIVE_API_KEY;

    if (!cachedApiKey) {
        throw new Error('MASSIVE_API_KEY not found in secrets');
    }

    return cachedApiKey;
}

// ============================================================================
// InfluxDB Client
// ============================================================================

async function createInfluxClient(): Promise<InfluxDBClient | null> {
    const endpoint = process.env.INFLUXDB_ENDPOINT;
    const secretArn = process.env.INFLUXDB_SECRET_ARN;

    if (!endpoint) {
        console.warn('⚠️  INFLUXDB_ENDPOINT not set');
        return null;
    }

    // Try to get token from env first, then from Secrets Manager
    let token = process.env.INFLUXDB_TOKEN;

    if (!token && secretArn) {
        console.log('🔑 Fetching InfluxDB credentials from Secrets Manager...');
        try {
            const region = process.env.AWS_REGION || 'us-west-2';
            const secretsClient = new SecretsManagerClient({ region });
            const response = await secretsClient.send(
                new GetSecretValueCommand({ SecretId: secretArn })
            );

            if (response.SecretString) {
                const credentials = JSON.parse(response.SecretString);
                token = credentials.token || credentials.password;
            }
        } catch (error: any) {
            console.error('❌ Failed to get InfluxDB credentials:', error.message);
            return null;
        }
    }

    if (!token) {
        console.warn('⚠️  InfluxDB token not available');
        return null;
    }

    const host = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
    const port = process.env.INFLUXDB_PORT || '8181';

    return new InfluxDBClient({
        host: `${host}:${port}`,
        token,
    });
}

// ============================================================================
// Data Processing
// ============================================================================

function barToPoint(bar: MassiveBar, ticker: string): Point {
    const time = new Date(bar.t);
    const change = Number((bar.c - bar.o).toFixed(4));
    const changePercent = bar.o !== 0 ? Number(((change / bar.o) * 100).toFixed(4)) : 0;

    return Point.measurement('stock_quotes_raw')
        .setTag('ticker', ticker)
        .setTag('market', 'US')
        .setFloatField('open', bar.o)
        .setFloatField('high', bar.h)
        .setFloatField('low', bar.l)
        .setFloatField('close', bar.c)
        .setIntegerField('volume', bar.v)
        .setFloatField('vwap', bar.vw || 0)
        .setIntegerField('trades', bar.n || 0)
        .setFloatField('change', change)
        .setFloatField('changePercent', changePercent)
        .setStringField('name', ticker)
        .setTimestamp(time);
}

async function writeBatch(
    influxClient: InfluxDBClient,
    database: string,
    points: Point[]
): Promise<number> {
    try {
        await influxClient.write(points, database);
        return points.length;
    } catch (error: any) {
        console.error(`  ❌ Write error:`, error.message);
        return 0;
    }
}

// ============================================================================
// Main Processing
// ============================================================================

async function fetchTickerData(
    massive: ReturnType<typeof restClient>,
    ticker: string,
    fromDate: string,
    toDate: string
): Promise<MassiveBar[]> {
    try {
        const response = await massive.getStocksAggregates({
            stocksTicker: ticker,
            multiplier: 1,
            timespan: GetStocksAggregatesTimespanEnum.Minute,
            from: fromDate,
            to: toDate,
            limit: 50000, // Max results per request
        });

        return (response.results || []) as MassiveBar[];
    } catch (error: any) {
        if (error.status === 429) {
            console.log(`  ⏳ Rate limited, waiting 60s...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            return fetchTickerData(massive, ticker, fromDate, toDate);
        }
        throw error;
    }
}

async function processTickerByWeek(
    massive: ReturnType<typeof restClient>,
    influxClient: InfluxDBClient | null,
    ticker: string,
    startDate: Date,
    endDate: Date,
    config: BackfillConfig,
    stats: Stats
): Promise<void> {
    console.log(`\n📈 Processing ${ticker}...`);

    const database = process.env.INFLUXDB_DATABASE || 'market_data';
    let totalBars = 0;

    // Process week by week to avoid API limits
    let currentStart = startDate;
    
    while (currentStart < endDate) {
        const currentEnd = new Date(Math.min(
            addDays(currentStart, 7).getTime(),
            endDate.getTime()
        ));

        const fromStr = format(currentStart, 'yyyy-MM-dd');
        const toStr = format(currentEnd, 'yyyy-MM-dd');

        try {
            const bars = await fetchTickerData(massive, ticker, fromStr, toStr);
            
            if (bars.length > 0) {
                totalBars += bars.length;
                stats.recordsProcessed += bars.length;

                if (!config.dryRun && influxClient) {
                    // Write in batches
                    for (let i = 0; i < bars.length; i += config.batchSize) {
                        const batch = bars.slice(i, i + config.batchSize);
                        const points = batch.map(bar => barToPoint(bar, ticker));
                        const written = await writeBatch(influxClient, database, points);
                        stats.recordsWritten += written;
                    }
                }

                process.stdout.write(`  ${fromStr} → ${toStr}: ${bars.length} bars\r`);
            }

            stats.daysProcessed++;
        } catch (error: any) {
            console.error(`  ❌ ${fromStr}: ${error.message}`);
            stats.errors++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, config.requestDelay));
        
        currentStart = addDays(currentEnd, 1);
    }

    console.log(`  ✅ ${ticker}: ${totalBars.toLocaleString()} total bars`);
    stats.tickersProcessed++;
}

async function runBackfill(config: BackfillConfig): Promise<void> {
    console.log('═'.repeat(70));
    console.log('📊 Minute Data Backfill (Massive REST API)');
    console.log('═'.repeat(70));
    console.log(`Tickers: ${config.tickers.join(', ')}`);
    console.log(`Period: ${config.months} months`);
    console.log(`Dry Run: ${config.dryRun}`);
    console.log('═'.repeat(70));

    const apiKey = await getApiKey();
    const massive = restClient(apiKey, process.env.MASSIVE_BASE_URL || 'https://api.massive.com');
    const influxClient = config.dryRun ? null : await createInfluxClient();

    const endDate = new Date();
    const startDate = subMonths(endDate, config.months);

    console.log(`\n📆 ${format(startDate, 'yyyy-MM-dd')} → ${format(endDate, 'yyyy-MM-dd')}`);

    const stats: Stats = {
        tickersProcessed: 0,
        daysProcessed: 0,
        recordsProcessed: 0,
        recordsWritten: 0,
        errors: 0,
        startTime: new Date(),
    };

    for (const ticker of config.tickers) {
        try {
            await processTickerByWeek(
                massive,
                influxClient,
                ticker.toUpperCase().trim(),
                startDate,
                endDate,
                config,
                stats
            );
        } catch (error: any) {
            console.error(`❌ Failed ${ticker}:`, error.message);
            stats.errors++;
        }
    }

    // Summary
    const duration = (Date.now() - stats.startTime.getTime()) / 1000;
    console.log('\n' + '═'.repeat(70));
    console.log('📊 Summary');
    console.log('═'.repeat(70));
    console.log(`Tickers processed: ${stats.tickersProcessed}/${config.tickers.length}`);
    console.log(`Records processed: ${stats.recordsProcessed.toLocaleString()}`);
    console.log(`Records written: ${stats.recordsWritten.toLocaleString()}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Throughput: ${(stats.recordsProcessed / duration).toFixed(0)} records/sec`);
    console.log('═'.repeat(70));

    if (influxClient) {
        await influxClient.close();
    }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): BackfillConfig {
    const args = process.argv.slice(2);
    const config: BackfillConfig = { ...DEFAULT_CONFIG };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--tickers':
                config.tickers = args[++i].split(',').map(t => t.trim().toUpperCase());
                break;
            case '--months':
                config.months = parseInt(args[++i], 10);
                break;
            case '--dry-run':
                config.dryRun = true;
                break;
            case '--batch-size':
                config.batchSize = parseInt(args[++i], 10);
                break;
            case '--delay':
                config.requestDelay = parseInt(args[++i], 10);
                break;
            case '--help':
                console.log(`
Minute Data Backfill (Massive REST API)

Usage:
  npx tsx scripts/backfill-minute.ts [options]

Options:
  --tickers <list>  Comma-separated ticker list (default: from .env)
  --months <n>      Months to backfill (default: 6)
  --dry-run         Fetch only, no DB writes
  --batch-size <n>  InfluxDB batch size (default: 5000)
  --delay <ms>      Delay between API calls (default: 200)
  --help            Show this help

Examples:
  npx tsx scripts/backfill-minute.ts
  npx tsx scripts/backfill-minute.ts --tickers AAPL,TSLA,NVDA --months 3
  npx tsx scripts/backfill-minute.ts --dry-run
`);
                process.exit(0);
        }
    }

    return config;
}

// Run
runBackfill(parseArgs()).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
