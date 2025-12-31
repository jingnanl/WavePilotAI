/**
 * Daily Data Backfill Script (Flat Files)
 *
 * Downloads full market daily OHLCV data from Massive S3 flat files.
 * Saves CSV files locally and writes to InfluxDB.
 *
 * Usage:
 *   # Backfill past 5 years with common stocks (default)
 *   npx tsx scripts/backfill-daily.ts
 *
 *   # Backfill specific period
 *   npx tsx scripts/backfill-daily.ts --years 3
 *
 *   # Include all securities (OTC, warrants, etc.)
 *   npx tsx scripts/backfill-daily.ts --filter all
 *
 *   # Dry run (download only, no DB writes)
 *   npx tsx scripts/backfill-daily.ts --dry-run
 *
 *   # Resume from specific date
 *   npx tsx scripts/backfill-daily.ts --from 2023-01-01
 *
 * Filter Options:
 *   --filter common    (default) Mainboard stocks, exclude SPAC derivatives
 *   --filter mainboard NYSE/NASDAQ style tickers (1-5 uppercase letters)
 *   --filter all       All securities including OTC
 *
 * Environment Variables:
 *   MASSIVE_S3_ACCESS_KEY - Massive S3 access key
 *   MASSIVE_S3_SECRET_KEY - Massive S3 secret key
 *   INFLUXDB_ENDPOINT     - InfluxDB endpoint
 *   INFLUXDB_SECRET_ARN   - Secrets Manager ARN for InfluxDB credentials
 *   INFLUXDB_DATABASE     - InfluxDB database name
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

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createInterface } from 'readline';
import { format, subYears, eachDayOfInterval, isWeekend, parse } from 'date-fns';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

type TickerFilter = 'all' | 'mainboard' | 'common';

interface BackfillConfig {
    years: number;
    fromDate?: string;
    dryRun: boolean;
    batchSize: number;
    dataDir: string;
    tickerFilter: TickerFilter;
}

const DEFAULT_CONFIG: BackfillConfig = {
    years: 5,
    dryRun: false,
    batchSize: 5000,
    dataDir: '../../data/market-daily', // Root level: /data/market-daily
    tickerFilter: 'common', // Default: only common stocks
};

// Massive S3 configuration
const MASSIVE_S3 = {
    endpoint: 'https://files.massive.com',
    bucket: 'flatfiles',
    region: 'us-east-1',
    path: 'us_stocks_sip/day_aggs_v1',
};

// ============================================================================
// Types
// ============================================================================

interface FlatFileRow {
    ticker: string;
    volume: number;
    open: number;
    close: number;
    high: number;
    low: number;
    window_start: number; // nanoseconds
    transactions: number;
}

interface Stats {
    filesDownloaded: number;
    filesSkipped: number;
    recordsProcessed: number;
    recordsWritten: number;
    recordsFiltered: number;
    errors: number;
    startTime: Date;
}

// ============================================================================
// Ticker Filtering
// ============================================================================

/**
 * Check if ticker should be included based on filter type
 *
 * Filter types:
 * - all: Include everything (OTC, preferred, warrants, etc.)
 * - mainboard: Only NYSE/NASDAQ style tickers (1-5 uppercase letters)
 * - common: Mainboard + exclude preferred stocks, warrants, units
 */
function shouldIncludeTicker(ticker: string, filter: TickerFilter): boolean {
    if (filter === 'all') return true;

    // Basic validation: must be uppercase letters only, 1-5 chars
    const isMainboard = /^[A-Z]{1,5}$/.test(ticker);
    if (!isMainboard) return false;

    if (filter === 'mainboard') return true;

    // For 'common' filter, exclude known non-common patterns
    // These are heuristics - not 100% accurate but catches most cases
    const excludePatterns = [
        /^[A-Z]{4}W$/, // Warrants (e.g., SPACW)
        /^[A-Z]{4}U$/, // Units (e.g., SPACU)
        /^[A-Z]{4}R$/, // Rights (e.g., SPACR)
    ];

    for (const pattern of excludePatterns) {
        if (pattern.test(ticker)) return false;
    }

    return true;
}

// ============================================================================
// S3 Client
// ============================================================================

function createS3Client(): S3Client {
    const accessKey = process.env.MASSIVE_S3_ACCESS_KEY;
    const secretKey = process.env.MASSIVE_S3_SECRET_KEY;

    if (!accessKey || !secretKey) {
        throw new Error(
            'Missing Massive S3 credentials.\n' +
            'Set MASSIVE_S3_ACCESS_KEY and MASSIVE_S3_SECRET_KEY in .env\n' +
            'Get credentials from: https://massive.com/dashboard'
        );
    }

    return new S3Client({
        endpoint: MASSIVE_S3.endpoint,
        region: MASSIVE_S3.region,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
        },
        forcePathStyle: true,
    });
}

// ============================================================================
// InfluxDB Client
// ============================================================================

async function createInfluxClient(): Promise<InfluxDBClient | null> {
    const endpoint = process.env.INFLUXDB_ENDPOINT;
    const secretArn = process.env.INFLUXDB_SECRET_ARN;

    if (!endpoint) {
        console.warn('⚠️  INFLUXDB_ENDPOINT not set, will only download files');
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
        console.warn('⚠️  InfluxDB token not available, will only download files');
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
// Date Utilities
// ============================================================================

function getTradingDays(startDate: Date, endDate: Date): Date[] {
    const allDays = eachDayOfInterval({ start: startDate, end: endDate });
    return allDays.filter((day) => !isWeekend(day));
}

function getS3Key(date: Date): string {
    const year = format(date, 'yyyy');
    const month = format(date, 'MM');
    const dateStr = format(date, 'yyyy-MM-dd');
    return `${MASSIVE_S3.path}/${year}/${month}/${dateStr}.csv.gz`;
}

function getLocalPath(dataDir: string, date: Date): string {
    const year = format(date, 'yyyy');
    const month = format(date, 'MM');
    return join(dataDir, year, month, `${format(date, 'yyyy-MM-dd')}.csv`);
}

// ============================================================================
// File Processing
// ============================================================================

async function downloadFile(
    s3Client: S3Client,
    s3Key: string,
    localPath: string
): Promise<boolean> {
    // Check if already downloaded
    if (existsSync(localPath)) {
        return false; // Already exists
    }

    try {
        const command = new GetObjectCommand({
            Bucket: MASSIVE_S3.bucket,
            Key: s3Key,
        });

        const response = await s3Client.send(command);
        if (!response.Body) {
            return false;
        }

        // Ensure directory exists
        const dir = join(localPath, '..');
        mkdirSync(dir, { recursive: true });

        // Download and decompress
        const gzPath = localPath + '.gz';
        const bodyStream = response.Body as Readable;

        await pipeline(bodyStream, createWriteStream(gzPath));
        await pipeline(createReadStream(gzPath), createGunzip(), createWriteStream(localPath));

        // Remove .gz file after extraction
        const fs = await import('fs/promises');
        await fs.unlink(gzPath);

        return true;
    } catch (error: any) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return false; // File not found (holiday)
        }
        throw error;
    }
}

async function* parseCSV(filePath: string): AsyncGenerator<FlatFileRow> {
    const fileStream = createReadStream(filePath);
    const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let isHeader = true;
    let headers: string[] = [];

    for await (const line of rl) {
        if (isHeader) {
            headers = line.split(',');
            isHeader = false;
            continue;
        }

        const values = line.split(',');
        const row: any = {};
        headers.forEach((h, i) => {
            row[h] = values[i];
        });

        yield {
            ticker: row.ticker,
            volume: parseInt(row.volume, 10),
            open: parseFloat(row.open),
            close: parseFloat(row.close),
            high: parseFloat(row.high),
            low: parseFloat(row.low),
            window_start: parseInt(row.window_start, 10),
            transactions: parseInt(row.transactions, 10),
        };
    }
}

// ============================================================================
// InfluxDB Writing
// ============================================================================

function rowToPoint(row: FlatFileRow): Point {
    const timestampMs = Math.floor(row.window_start / 1_000_000);
    const time = new Date(timestampMs);

    const change = Number((row.close - row.open).toFixed(4));
    const changePercent = row.open !== 0 ? Number(((change / row.open) * 100).toFixed(4)) : 0;

    return Point.measurement('stock_quotes_aggregated')
        .setTag('ticker', row.ticker)
        .setTag('market', 'US')
        .setFloatField('open', row.open)
        .setFloatField('high', row.high)
        .setFloatField('low', row.low)
        .setFloatField('close', row.close)
        .setIntegerField('volume', row.volume)
        .setIntegerField('trades', row.transactions)
        .setFloatField('change', change)
        .setFloatField('changePercent', changePercent)
        .setStringField('name', row.ticker)
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

async function processDate(
    s3Client: S3Client,
    influxClient: InfluxDBClient | null,
    date: Date,
    config: BackfillConfig,
    stats: Stats
): Promise<void> {
    const dateStr = format(date, 'yyyy-MM-dd');
    const s3Key = getS3Key(date);
    const localPath = getLocalPath(config.dataDir, date);

    // Download file
    const downloaded = await downloadFile(s3Client, s3Key, localPath);
    
    if (downloaded) {
        stats.filesDownloaded++;
        console.log(`  ⬇️  Downloaded: ${dateStr}`);
    } else if (existsSync(localPath)) {
        stats.filesSkipped++;
        console.log(`  📁 Cached: ${dateStr}`);
    } else {
        console.log(`  ⏭️  Not found: ${dateStr} (holiday?)`);
        return;
    }

    // Skip DB writes if dry run or no client
    if (config.dryRun || !influxClient) {
        return;
    }

    // Process and write to InfluxDB
    const database = process.env.INFLUXDB_DATABASE || 'market_data';
    let batch: Point[] = [];
    let recordCount = 0;
    let filteredCount = 0;

    for await (const row of parseCSV(localPath)) {
        // Apply ticker filter
        if (!shouldIncludeTicker(row.ticker, config.tickerFilter)) {
            filteredCount++;
            continue;
        }

        batch.push(rowToPoint(row));
        recordCount++;

        if (batch.length >= config.batchSize) {
            const written = await writeBatch(influxClient, database, batch);
            stats.recordsWritten += written;
            batch = [];
        }
    }

    // Write remaining
    if (batch.length > 0) {
        const written = await writeBatch(influxClient, database, batch);
        stats.recordsWritten += written;
    }

    stats.recordsProcessed += recordCount;
    stats.recordsFiltered += filteredCount;
    console.log(`  ✅ ${dateStr}: ${recordCount.toLocaleString()} records (${filteredCount.toLocaleString()} filtered)`);
}

async function runBackfill(config: BackfillConfig): Promise<void> {
    console.log('═'.repeat(70));
    console.log('📊 Daily Data Backfill (Massive Flat Files)');
    console.log('═'.repeat(70));
    console.log(`Period: ${config.years} years`);
    console.log(`Filter: ${config.tickerFilter}`);
    console.log(`Data Dir: ${config.dataDir}`);
    console.log(`Dry Run: ${config.dryRun}`);
    console.log('═'.repeat(70));
    console.log(`Dry Run: ${config.dryRun}`);
    console.log('═'.repeat(70));

    const s3Client = createS3Client();
    const influxClient = config.dryRun ? null : await createInfluxClient();

    const endDate = new Date();
    let startDate: Date;
    
    if (config.fromDate) {
        startDate = parse(config.fromDate, 'yyyy-MM-dd', new Date());
    } else {
        startDate = subYears(endDate, config.years);
    }

    const tradingDays = getTradingDays(startDate, endDate);
    console.log(`\n📆 ${format(startDate, 'yyyy-MM-dd')} → ${format(endDate, 'yyyy-MM-dd')}`);
    console.log(`📊 Trading days: ${tradingDays.length}\n`);

    const stats: Stats = {
        filesDownloaded: 0,
        filesSkipped: 0,
        recordsProcessed: 0,
        recordsWritten: 0,
        recordsFiltered: 0,
        errors: 0,
        startTime: new Date(),
    };

    for (const date of tradingDays) {
        try {
            await processDate(s3Client, influxClient, date, config, stats);
        } catch (error: any) {
            console.error(`❌ Error ${format(date, 'yyyy-MM-dd')}:`, error.message);
            stats.errors++;
        }
    }

    // Summary
    const duration = (Date.now() - stats.startTime.getTime()) / 1000;
    console.log('\n' + '═'.repeat(70));
    console.log('📊 Summary');
    console.log('═'.repeat(70));
    console.log(`Filter: ${config.tickerFilter}`);
    console.log(`Files downloaded: ${stats.filesDownloaded}`);
    console.log(`Files cached: ${stats.filesSkipped}`);
    console.log(`Records processed: ${stats.recordsProcessed.toLocaleString()}`);
    console.log(`Records filtered: ${stats.recordsFiltered.toLocaleString()}`);
    console.log(`Records written: ${stats.recordsWritten.toLocaleString()}`);
    console.log(`Errors: ${stats.errors}`);
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Data saved to: ${config.dataDir}`);
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
            case '--years':
                config.years = parseInt(args[++i], 10);
                break;
            case '--from':
                config.fromDate = args[++i];
                break;
            case '--dry-run':
                config.dryRun = true;
                break;
            case '--data-dir':
                config.dataDir = args[++i];
                break;
            case '--batch-size':
                config.batchSize = parseInt(args[++i], 10);
                break;
            case '--filter':
                const filterArg = args[++i] as TickerFilter;
                if (['all', 'mainboard', 'common'].includes(filterArg)) {
                    config.tickerFilter = filterArg;
                } else {
                    console.error(`Invalid filter: ${filterArg}. Use: all, mainboard, common`);
                    process.exit(1);
                }
                break;
            case '--help':
                console.log(`
Daily Data Backfill (Massive Flat Files)

Usage:
  npx tsx scripts/backfill-daily.ts [options]

Options:
  --years <n>       Years to backfill (default: 5)
  --from <date>     Start from specific date (YYYY-MM-DD)
  --filter <type>   Ticker filter (default: common)
                    - all: All securities (~10k/day)
                    - mainboard: NYSE/NASDAQ style tickers only (~8k/day)
                    - common: Mainboard excluding warrants/units (~7k/day)
  --dry-run         Download only, no DB writes
  --data-dir <dir>  Local data directory (default: ../../data/market-daily)
  --batch-size <n>  InfluxDB batch size (default: 5000)
  --help            Show this help

Examples:
  npx tsx scripts/backfill-daily.ts --years 5
  npx tsx scripts/backfill-daily.ts --filter all --years 1
  npx tsx scripts/backfill-daily.ts --from 2023-01-01
  npx tsx scripts/backfill-daily.ts --dry-run
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
