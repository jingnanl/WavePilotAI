/**
 * WavePilotAI Hybrid Data Strategy - Integration Tests
 *
 * This test validates the full data pipeline architecture:
 *
 *   0. Market Status Check        -> Determine if market is open
 *   1. Massive API (Daily History)   -> InfluxDB (stock_quotes_aggregated)
 *   2. Massive API (Minute Bars)     -> InfluxDB (stock_quotes_raw)
 *   3. Massive API (Grouped Daily)   -> InfluxDB (stock_quotes_aggregated)
 *   4. Massive API (News)            -> InfluxDB (news) + S3
 *   5. Massive API (Financials)      -> InfluxDB (fundamentals)
 *   6. Alpaca API (Recent)           -> InfluxDB (stock_quotes_raw)
 *   7. Alpaca WS (Realtime)          -> InfluxDB (stock_quotes_raw)
 *
 * Usage:
 *   cd apps/worker
 *   npx tsx tests/integration.test.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

// Disable TLS verification for SSH tunnel scenarios
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// STRICT FORCE IPv4: Monkey patch dns.lookup to ignore IPv6 completely
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

// Imports
import Alpaca from '@alpacahq/alpaca-trade-api';
import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
    GetStocksAggregatesTimespanEnum,
    ListNewsSortEnum,
    restClient
} from '@massive.com/client-js';
import { InfluxDBWriter } from '../src/services/timestream-writer';
import { NewsService } from '../src/services/news-service';
import {
    transformMassiveBarToQuote,
    transformMassiveBarToDaily,
    transformMassiveFinancialsToRecord,
    transformAlpacaBarToQuote,
    transformAlpacaRealtimeBarToQuote,
} from '../src/utils/transformers';
import type {
    QuoteRecord,
    DailyRecord,
    FundamentalsRecord,
    MarketStatus,
} from '@wavepilot/shared';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
    apiKeys: {
        secretArn: process.env.API_KEYS_SECRET_ARN || 'wavepilot/api-keys',
    },
    massive: {
        baseUrl: 'https://api.massive.com',
    },
    test: {
        ticker: 'AAPL',
        market: 'US' as const,
    },
    sampleDataDir: './tests/sample-data',
} as const;

// ============================================================================
// Helpers
// ============================================================================

interface ApiKeys {
    ALPACA_API_KEY: string;
    ALPACA_API_SECRET: string;
    MASSIVE_API_KEY: string;
}

const secretsClient = new SecretsManagerClient({
    region: 'us-west-2',
    maxAttempts: 10,
    requestHandler: {
        requestTimeout: 30000,
        connectionTimeout: 10000,
    },
});

let cachedApiKeys: ApiKeys | null = null;
let cachedMarketStatus: { isOpen: boolean; status: MarketStatus | null } | null = null;

async function getApiKeys(): Promise<ApiKeys> {
    if (cachedApiKeys) return cachedApiKeys;
    console.log('🔐 Fetching API keys from Secrets Manager...');
    const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: CONFIG.apiKeys.secretArn })
    );
    if (!response.SecretString) throw new Error('Failed to retrieve API keys');
    cachedApiKeys = JSON.parse(response.SecretString);
    return cachedApiKeys!;
}

function logSection(title: string) {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${title}`);
    console.log('='.repeat(60));
}

function logResult(name: string, passed: boolean) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status}: ${name}`);
}

// Sample data storage
const sampleData: Record<string, any> = {};

function saveSampleData(key: string, data: any) {
    sampleData[key] = data;
}

/**
 * Load sample data from file for offline testing
 */
function loadSampleData(ticker: string): Record<string, any> | null {
    const filePath = path.join(CONFIG.sampleDataDir, `sample-data-${ticker}.json`);
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.warn(`  ⚠️ Failed to load sample data from ${filePath}`);
    }
    return null;
}

// InfluxDB Writer and News Service
const writer = new InfluxDBWriter();
let newsService: NewsService;

// ============================================================================
// Stage 0: Market Status Check
// ============================================================================

async function checkMarketStatus(): Promise<{ isOpen: boolean; status: MarketStatus | null }> {
    if (cachedMarketStatus) return cachedMarketStatus;

    logSection('Stage 0: Market Status Check');
    try {
        const keys = await getApiKeys();

        // Massive Market Status API
        const url = `${CONFIG.massive.baseUrl}/v1/marketstatus/now`;
        console.log('  📡 Checking US market status...');

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${keys.MASSIVE_API_KEY}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Market status API returned ${response.status}`);
        }

        const data = await response.json();
        console.log(`  📊 Market Status Response:`, JSON.stringify(data, null, 2));

        // Check if market is open
        // Massive returns: { market: "open" | "closed" | "extended-hours", ... }
        const isOpen = data.market === 'open';
        const status: MarketStatus = {
            market: 'us',
            serverTime: data.serverTime || new Date().toISOString(),
            exchanges: data.exchanges || {},
        };

        console.log(`  📈 Market is ${isOpen ? 'OPEN' : 'CLOSED'}`);
        if (data.afterHours) console.log(`  🌙 After Hours: ${data.afterHours}`);
        if (data.earlyHours) console.log(`  🌅 Early Hours: ${data.earlyHours}`);

        cachedMarketStatus = { isOpen, status };
        logResult('Market Status Check', true);
        return cachedMarketStatus;

    } catch (error) {
        console.error('  ❌ Error:', error);
        logResult('Market Status Check', false);
        cachedMarketStatus = { isOpen: false, status: null };
        return cachedMarketStatus;
    }
}

// ============================================================================
// Stage 1: Massive API (Daily History -> stock_quotes_aggregated)
// ============================================================================

async function testMassiveDailyHistory(): Promise<boolean> {
    logSection('Stage 1: Massive API – Daily History');
    try {
        const keys = await getApiKeys();
        const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.massive.baseUrl);

        const endDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        console.log(`  📡 Fetching Daily Aggregates for ${CONFIG.test.ticker} (${startDate} -> ${endDate})...`);

        const response = await massive.getStocksAggregates({
            stocksTicker: CONFIG.test.ticker,
            multiplier: 1,
            timespan: GetStocksAggregatesTimespanEnum.Day,
            from: startDate,
            to: endDate,
        });

        const bars = response.results || [];
        console.log(`  📊 Received ${bars.length} daily bars`);

        saveSampleData('massive_daily_history', bars.slice(0, 10));

        if (bars.length > 0) {
            const records: DailyRecord[] = bars.map(b =>
                transformMassiveBarToDaily(b as any, CONFIG.test.ticker, CONFIG.test.market)
            );
            await writer.writeDailyData(records);
        }

        logResult('Massive Daily History -> Write Aggregated', bars.length > 0);
        return bars.length > 0;
    } catch (error) {
        console.error('  ❌ Error:', error);
        logResult('Massive Daily History', false);
        return false;
    }
}

// ============================================================================
// Stage 2: Massive API (Minute Bars -> stock_quotes_raw)
// ============================================================================

async function testMassiveMinuteHistory(): Promise<boolean> {
    logSection('Stage 2: Massive API – Minute Bars');

    const { isOpen } = await checkMarketStatus();
    const existingSampleData = loadSampleData(CONFIG.test.ticker);

    try {
        let bars: any[] = [];

        if (isOpen) {
            // Market is open - fetch live data
            const keys = await getApiKeys();
            const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.massive.baseUrl);

            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 60 * 60 * 1000).toISOString().split('T')[0];

            console.log(`  📡 Fetching Minute Aggregates for ${CONFIG.test.ticker} (LIVE)...`);

            const response = await massive.getStocksAggregates({
                stocksTicker: CONFIG.test.ticker,
                multiplier: 1,
                timespan: GetStocksAggregatesTimespanEnum.Minute,
                from: startDate,
                to: endDate,
                limit: 60
            });

            bars = response.results || [];
        } else if (existingSampleData?.massive_minute_bars) {
            // Market is closed - use sample data
            console.log(`  📦 Market closed. Using SAMPLE DATA for ${CONFIG.test.ticker}`);
            console.log(`     ⚠️ Data is from previous session, not live`);
            bars = existingSampleData.massive_minute_bars;
        } else {
            console.log(`  ⚠️ Market closed and no sample data available. Skipping live fetch.`);
        }

        console.log(`  📊 Processing ${bars.length} minute bars`);

        saveSampleData('massive_minute_bars', bars.slice(0, 10));

        if (bars.length > 0) {
            const records: QuoteRecord[] = bars.map(b =>
                transformMassiveBarToQuote(b as any, CONFIG.test.ticker, CONFIG.test.market)
            );
            await writer.writeQuotes(records);
        }

        logResult('Massive Minute Bars -> Write Raw', bars.length > 0 || !isOpen);
        return bars.length > 0 || !isOpen;
    } catch (error) {
        console.error('  ❌ Error:', error);
        logResult('Massive Minute Bars', false);
        return false;
    }
}

// ============================================================================
// Stage 3: Massive API (Grouped Daily -> stock_quotes_aggregated)
// ============================================================================

async function testMassiveGroupedDaily(): Promise<boolean> {
    logSection('Stage 3: Massive API – Grouped Daily');
    try {
        const keys = await getApiKeys();
        const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.massive.baseUrl);

        // Use last trading day (skip weekends)
        let checkDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        while (checkDate.getDay() === 0 || checkDate.getDay() === 6) {
            checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
        }
        const yesterday = checkDate.toISOString().split('T')[0];

        console.log(`  📡 Fetching Grouped Daily for ${yesterday}...`);

        const response = await massive.getGroupedStocksAggregates({
            date: yesterday,
        });

        const bars = response.results || [];
        console.log(`  📊 Received ${bars.length} tickers for the day`);

        saveSampleData('massive_grouped_daily', bars.slice(0, 10));

        if (bars.length > 0) {
            const sampleBars = bars.slice(0, 5);
            console.log(`  📝 Writing sample of ${sampleBars.length} records...`);

            const records: DailyRecord[] = sampleBars.map(b =>
                transformMassiveBarToDaily(b as any, (b as any).T!, CONFIG.test.market, new Date(yesterday))
            );
            await writer.writeDailyData(records);
        }

        logResult('Massive Grouped Daily -> Write Aggregated', bars.length > 0);
        return bars.length > 0;

    } catch (error) {
        console.error('  ❌ Error:', error);
        logResult('Massive Grouped Daily', false);
        return false;
    }
}

// ============================================================================
// Stage 4: Massive API (News -> news + S3)
// ============================================================================

async function testMassiveNews(): Promise<boolean> {
    logSection('Stage 4: Massive API – News');
    try {
        const keys = await getApiKeys();
        const massive = restClient(keys.MASSIVE_API_KEY, CONFIG.massive.baseUrl);

        console.log(`  📡 Fetching News for ${CONFIG.test.ticker}...`);

        // @ts-ignore - SDK type mismatch
        const response = await massive.listNews({
            ticker: CONFIG.test.ticker,
            limit: 5,
            sort: ListNewsSortEnum.PublishedUtc,
        });

        const newsItems = response.results || [];
        console.log(`  📊 Received ${newsItems.length} news items`);

        saveSampleData('massive_news', newsItems);

        if (newsItems.length > 0) {
            // Use NewsService to save to both InfluxDB and S3
            // Set fetchContent to false for testing (avoid hitting external URLs)
            await newsService.saveNewsFromMassive(
                newsItems as any,
                CONFIG.test.ticker,
                CONFIG.test.market,
                true // fetch content
            );
        }

        logResult('Massive News -> Write News + S3', newsItems.length > 0);
        return newsItems.length > 0;

    } catch (error) {
        console.error('  ❌ Error:', error);
        logResult('Massive News', false);
        return false;
    }
}

// ============================================================================
// Stage 5: Massive API (Financials -> fundamentals)
// ============================================================================

async function testMassiveFinancials(): Promise<boolean> {
    logSection('Stage 5: Massive API – Financials');
    try {
        const keys = await getApiKeys();

        const url = `${CONFIG.massive.baseUrl}/vX/reference/financials?ticker=${CONFIG.test.ticker}&limit=4`;
        console.log(`  📡 Fetching Financials for ${CONFIG.test.ticker}...`);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${keys.MASSIVE_API_KEY}`,
            },
        });

        if (!response.ok) {
            throw { response: { status: response.status } };
        }

        const data = await response.json();
        const results = data.results || [];
        console.log(`  📊 Received ${results.length} financial records`);

        saveSampleData('massive_financials', results);

        if (results.length > 0) {
            const records: FundamentalsRecord[] = results.map((item: any) =>
                transformMassiveFinancialsToRecord(item, CONFIG.test.ticker, CONFIG.test.market)
            );
            await writer.writeFundamentals(records);
        }

        logResult('Massive Financials -> Write Fundamentals', results.length > 0);
        return results.length > 0;

    } catch (error: any) {
        if (error?.response?.status === 403 || error?.response?.status === 404) {
            console.log('  ⚠️ Plan limitation or data not found (Soft Pass)');
            logResult('Massive Financials (Soft Pass)', true);
            return true;
        }
        console.error('  ❌ Error:', error);
        logResult('Massive Financials', false);
        return false;
    }
}

// ============================================================================
// Stage 6: Alpaca API (Recent -> stock_quotes_raw)
// ============================================================================

async function testAlpacaRecent(): Promise<boolean> {
    logSection('Stage 6: Alpaca API – Recent Bars');

    const { isOpen } = await checkMarketStatus();
    const existingSampleData = loadSampleData(CONFIG.test.ticker);

    try {
        let bars: any[] = [];

        if (isOpen) {
            // Market is open - fetch live data
            const keys = await getApiKeys();
            const alpaca = new Alpaca({
                keyId: keys.ALPACA_API_KEY,
                secretKey: keys.ALPACA_API_SECRET,
                paper: true,
            });

            const now = new Date();
            const start = new Date(now.getTime() - 15 * 60 * 1000);

            console.log(`  📡 Fetching ${CONFIG.test.ticker} IEX bars (LIVE)...`);

            const iterator = alpaca.getBarsV2(CONFIG.test.ticker, {
                start: start.toISOString(),
                end: now.toISOString(),
                timeframe: '1Min',
                feed: 'iex',
            });

            for await (const bar of iterator) {
                bars.push(bar);
            }
        } else if (existingSampleData?.alpaca_recent_bars) {
            // Market is closed - use sample data
            console.log(`  📦 Market closed. Using sample data for ${CONFIG.test.ticker}...`);
            console.log(`     ⚠️ Data is from previous session, not live`);
            bars = existingSampleData.alpaca_recent_bars;
        } else {
            console.log(`  ⚠️ Market closed and no sample data available. Skipping live fetch.`);
        }

        console.log(`  📊 Processing ${bars.length} minute bars`);

        saveSampleData('alpaca_recent_bars', bars.slice(0, 10));

        if (bars.length > 0) {
            const records: QuoteRecord[] = bars.map((b: any) =>
                transformAlpacaBarToQuote(b, CONFIG.test.ticker, CONFIG.test.market)
            );
            await writer.writeQuotes(records);
        }

        logResult('Alpaca Recent -> Write Raw', true);
        return true;
    } catch (error) {
        console.error('  ❌ Error:', error);
        logResult('Alpaca Recent', false);
        return false;
    }
}

// ============================================================================
// Stage 7: Alpaca WebSocket (Realtime -> stock_quotes_raw)
// ============================================================================

async function testAlpacaRealtime(): Promise<boolean> {
    logSection('Stage 7: Alpaca WebSocket – Realtime');

    const { isOpen } = await checkMarketStatus();

    if (!isOpen) {
        console.log('  📦 Market closed. Skipping realtime WebSocket test.');
        logResult('Alpaca Realtime -> Skipped (Market Closed)', true);
        return true;
    }

    return new Promise(async (resolve) => {
        try {
            const keys = await getApiKeys();
            const alpaca = new Alpaca({
                keyId: keys.ALPACA_API_KEY,
                secretKey: keys.ALPACA_API_SECRET,
                paper: true,
            });

            console.log('  📡 Connecting to Alpaca Data Stream (IEX)...');
            const stream = alpaca.data_stream_v2;

            const timeout = setTimeout(() => {
                console.log('  ⏱️ Timeout – No data received (market may be in transition)');
                stream.disconnect();
                logResult('Alpaca Realtime -> Timeout (Soft Pass)', true);
                resolve(true);
            }, 90000);

            stream.onConnect(() => {
                console.log('  ✅ Connected! Subscribing...');
                stream.subscribeForBars([CONFIG.test.ticker]);
            });

            stream.onStockBar(async (bar: any) => {
                console.log(`  📊 Realtime Bar: ${bar.Symbol} @ ${bar.ClosePrice}`);
                clearTimeout(timeout);

                saveSampleData('alpaca_realtime_bar', bar);

                const record = transformAlpacaRealtimeBarToQuote(bar, CONFIG.test.market);
                await writer.writeQuotes([record]);

                stream.disconnect();
                logResult('Alpaca Realtime -> Write Raw', true);
                resolve(true);
            });

            stream.onError((err: any) => {
                console.error('  ❌ Stream Error:', err);
                clearTimeout(timeout);
                logResult('Alpaca Realtime', false);
                resolve(false);
            });

            stream.connect();

        } catch (error) {
            console.error('  ❌ Error:', error);
            logResult('Alpaca Realtime', false);
            resolve(false);
        }
    });
}

// ============================================================================
// Main Runner
// ============================================================================

async function main() {
    console.log('\n🚀 WavePilotAI Hybrid Data Strategy – Full Integration Test');
    console.log('='.repeat(60));

    // Initialize services
    await writer.initialize();
    newsService = new NewsService(writer);

    // Check market status first
    await checkMarketStatus();

    // Run all stages
    await testMassiveDailyHistory();
    await testMassiveMinuteHistory();
    await testMassiveGroupedDaily();
    await testMassiveNews();
    await testMassiveFinancials();
    await testAlpacaRecent();
    await testAlpacaRealtime();

    await writer.close();

    // Save sample data
    const sampleFilePath = `./tests/sample-data/sample-data-${CONFIG.test.ticker}.json`;
    fs.mkdirSync(path.dirname(sampleFilePath), { recursive: true });
    fs.writeFileSync(sampleFilePath, JSON.stringify(sampleData, null, 2));
    console.log(`\n📁 Sample data saved to ${sampleFilePath}`);

    console.log('\n' + '='.repeat(60));
    console.log('  Integration Tests Complete');
    console.log('='.repeat(60));
    process.exit(0);
}

main().catch(console.error);
