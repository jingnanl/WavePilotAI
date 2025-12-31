/**
 * InfluxDB Data Verification Script
 *
 * Checks data completeness and quality across all tables.
 *
 * Usage:
 *   npx tsx scripts/check-data.ts
 */

import 'dotenv/config';

// Disable TLS verification for SSH tunnel
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Force IPv4
import dns from 'node:dns';
const originalLookup = dns.lookup;
(dns as any).lookup = (
    hostname: string,
    options: any,
    callback?: any
) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const newOptions = (options && typeof options === 'object') ? { ...options, family: 4 } : { family: 4 };
    return (originalLookup as any)(hostname, newOptions, callback);
};

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import https from 'https';

const CONFIG = {
    INFLUXDB_ENDPOINT: process.env.INFLUXDB_ENDPOINT || 'localhost',
    INFLUXDB_PORT: parseInt(process.env.INFLUXDB_PORT || '8181', 10),
    INFLUXDB_DATABASE: process.env.INFLUXDB_DATABASE || 'market_data',
    INFLUXDB_SECRET_ARN: process.env.INFLUXDB_SECRET_ARN || '',
    AWS_REGION: process.env.AWS_REGION || 'us-west-2',
};

const agent = new https.Agent({ rejectUnauthorized: false });

let influxToken: string | null = null;

async function getInfluxToken(): Promise<string> {
    if (influxToken) return influxToken;

    console.log('🔑 Fetching InfluxDB credentials...');
    const client = new SecretsManagerClient({ region: CONFIG.AWS_REGION });
    const response = await client.send(
        new GetSecretValueCommand({ SecretId: CONFIG.INFLUXDB_SECRET_ARN })
    );

    if (!response.SecretString) {
        throw new Error('Failed to get InfluxDB credentials');
    }

    const creds = JSON.parse(response.SecretString);
    influxToken = creds.token || creds.password;
    return influxToken!;
}

async function queryInfluxDB(sql: string): Promise<any[]> {
    const token = await getInfluxToken();

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            db: CONFIG.INFLUXDB_DATABASE,
            q: sql,
            format: 'json'
        });

        const options = {
            hostname: CONFIG.INFLUXDB_ENDPOINT,
            port: CONFIG.INFLUXDB_PORT,
            path: '/api/v3/query_sql',
            method: 'POST',
            agent,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Parse error: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function logSection(title: string) {
    console.log('\n' + '═'.repeat(70));
    console.log(`  ${title}`);
    console.log('═'.repeat(70));
}

async function checkDailyData() {
    logSection('📊 Daily Data (stock_quotes_aggregated)');

    // Total count (last 30 days to avoid file limit)
    const countResult = await queryInfluxDB(`
        SELECT COUNT(*) as total FROM stock_quotes_aggregated
        WHERE time > NOW() - INTERVAL '30 days'
    `);
    console.log(`\nRecords (last 30 days): ${countResult[0]?.total?.toLocaleString() || 0}`);

    // Date range (last 30 days)
    const rangeResult = await queryInfluxDB(`
        SELECT MIN(time) as min_date, MAX(time) as max_date 
        FROM stock_quotes_aggregated
        WHERE time > NOW() - INTERVAL '30 days'
    `);
    if (rangeResult[0]) {
        console.log(`Date range (30d): ${rangeResult[0].min_date?.split('T')[0]} → ${rangeResult[0].max_date?.split('T')[0]}`);
    }

    // Unique tickers (last 7 days)
    const tickerResult = await queryInfluxDB(`
        SELECT COUNT(DISTINCT ticker) as unique_tickers 
        FROM stock_quotes_aggregated
        WHERE time > NOW() - INTERVAL '7 days'
    `);
    console.log(`Unique tickers (7d): ${tickerResult[0]?.unique_tickers?.toLocaleString() || 0}`);

    // Records per day (recent)
    console.log('\nRecords per day (last 5 trading days):');
    const dailyResult = await queryInfluxDB(`
        SELECT DATE_TRUNC('day', time) as date, COUNT(*) as count
        FROM stock_quotes_aggregated
        WHERE time > NOW() - INTERVAL '10 days'
        GROUP BY DATE_TRUNC('day', time)
        ORDER BY date DESC
        LIMIT 5
    `);
    dailyResult.forEach((r: any) => {
        console.log(`  ${r.date?.split('T')[0]}: ${r.count?.toLocaleString()} records`);
    });

    // Sample data
    console.log('\nSample records (AAPL, NIO):');
    const sampleResult = await queryInfluxDB(`
        SELECT ticker, time, open, high, low, close, volume, change, "changePercent"
        FROM stock_quotes_aggregated
        WHERE ticker IN ('AAPL', 'NIO')
          AND time > NOW() - INTERVAL '7 days'
        ORDER BY time DESC
        LIMIT 4
    `);
    sampleResult.forEach((r: any) => {
        console.log(`  ${r.ticker} ${r.time?.split('T')[0]}: O=${r.open} H=${r.high} L=${r.low} C=${r.close} V=${r.volume?.toLocaleString()} Chg=${r.changePercent?.toFixed(2)}%`);
    });
}

async function checkMinuteData() {
    logSection('📈 Minute Data (stock_quotes_raw)');

    // Total count (last 7 days)
    const countResult = await queryInfluxDB(`
        SELECT COUNT(*) as total FROM stock_quotes_raw
        WHERE time > NOW() - INTERVAL '7 days'
    `);
    console.log(`\nRecords (last 7 days): ${countResult[0]?.total?.toLocaleString() || 0}`);

    // Date range (last 7 days)
    const rangeResult = await queryInfluxDB(`
        SELECT MIN(time) as min_date, MAX(time) as max_date 
        FROM stock_quotes_raw
        WHERE time > NOW() - INTERVAL '7 days'
    `);
    if (rangeResult[0]) {
        console.log(`Date range (7d): ${rangeResult[0].min_date} → ${rangeResult[0].max_date}`);
    }

    // Unique tickers (last 1 day)
    const tickerResult = await queryInfluxDB(`
        SELECT COUNT(DISTINCT ticker) as unique_tickers 
        FROM stock_quotes_raw
        WHERE time > NOW() - INTERVAL '1 day'
    `);
    console.log(`Unique tickers (1d): ${tickerResult[0]?.unique_tickers?.toLocaleString() || 0}`);

    // Recent data (last hour)
    console.log('\nRecent minute bars (last 30 mins):');
    const recentResult = await queryInfluxDB(`
        SELECT ticker, time, close, volume
        FROM stock_quotes_raw
        WHERE time > NOW() - INTERVAL '30 minutes'
        ORDER BY time DESC
        LIMIT 10
    `);
    if (recentResult.length === 0) {
        console.log('  ⚠️  No data in last 30 minutes');
    } else {
        recentResult.forEach((r: any) => {
            const timeStr = r.time?.split('T')[1]?.substring(0, 8) || '';
            console.log(`  ${r.ticker} ${timeStr}: $${r.close} V=${r.volume?.toLocaleString()}`);
        });
    }

    // Today's data by ticker
    console.log('\nToday\'s minute bars by ticker:');
    const todayResult = await queryInfluxDB(`
        SELECT ticker, COUNT(*) as bars, MIN(time) as first, MAX(time) as last
        FROM stock_quotes_raw
        WHERE time > DATE_TRUNC('day', NOW())
        GROUP BY ticker
        ORDER BY bars DESC
        LIMIT 10
    `);
    if (todayResult.length === 0) {
        console.log('  ⚠️  No data today');
    } else {
        todayResult.forEach((r: any) => {
            const first = r.first?.split('T')[1]?.substring(0, 5) || '';
            const last = r.last?.split('T')[1]?.substring(0, 5) || '';
            console.log(`  ${r.ticker}: ${r.bars} bars (${first} → ${last})`);
        });
    }
}

async function checkNewsData() {
    logSection('📰 News Data');

    const countResult = await queryInfluxDB(`
        SELECT COUNT(*) as total FROM news
    `);
    console.log(`\nTotal records: ${countResult[0]?.total?.toLocaleString() || 0}`);

    // Recent news
    console.log('\nRecent news:');
    const recentResult = await queryInfluxDB(`
        SELECT ticker, time, source, title, "sentimentValue"
        FROM news
        ORDER BY time DESC
        LIMIT 5
    `);
    recentResult.forEach((r: any) => {
        const title = (r.title || '').substring(0, 50);
        console.log(`  ${r.ticker} [${r.sentimentValue || 'N/A'}] ${title}...`);
    });
}

async function checkFundamentalsData() {
    logSection('💰 Fundamentals Data');

    const countResult = await queryInfluxDB(`
        SELECT COUNT(*) as total FROM fundamentals
    `);
    console.log(`\nTotal records: ${countResult[0]?.total?.toLocaleString() || 0}`);

    // By ticker
    console.log('\nRecords by ticker:');
    const tickerResult = await queryInfluxDB(`
        SELECT ticker, COUNT(*) as count, MAX(time) as latest
        FROM fundamentals
        GROUP BY ticker
        ORDER BY count DESC
        LIMIT 10
    `);
    tickerResult.forEach((r: any) => {
        console.log(`  ${r.ticker}: ${r.count} records (latest: ${r.latest?.split('T')[0]})`);
    });
}

async function main() {
    console.log('═'.repeat(70));
    console.log('  InfluxDB Data Verification');
    console.log('═'.repeat(70));
    console.log(`Endpoint: ${CONFIG.INFLUXDB_ENDPOINT}:${CONFIG.INFLUXDB_PORT}`);
    console.log(`Database: ${CONFIG.INFLUXDB_DATABASE}`);

    try {
        await checkDailyData();
        await checkMinuteData();
        await checkNewsData();
        await checkFundamentalsData();

        console.log('\n' + '═'.repeat(70));
        console.log('  ✅ Verification Complete');
        console.log('═'.repeat(70));
    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

main();
