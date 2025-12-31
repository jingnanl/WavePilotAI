/**
 * Quick field completeness check for InfluxDB tables
 */

import https from 'https';
import { config } from 'dotenv';
config();

const CONFIG = {
    INFLUXDB_ENDPOINT: process.env.INFLUXDB_ENDPOINT || 'localhost',
    INFLUXDB_PORT: parseInt(process.env.INFLUXDB_PORT || '8181', 10),
    INFLUXDB_DATABASE: process.env.INFLUXDB_DATABASE || 'market_data_test',
    INFLUXDB_TOKEN: process.env.INFLUXDB_TOKEN || '',
};

const agent = new https.Agent({ rejectUnauthorized: false });

async function queryInfluxDB(sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ db: CONFIG.INFLUXDB_DATABASE, q: sql, format: 'json' });
        const options = {
            hostname: CONFIG.INFLUXDB_ENDPOINT,
            port: CONFIG.INFLUXDB_PORT,
            path: '/api/v3/query_sql',
            method: 'POST',
            agent,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CONFIG.INFLUXDB_TOKEN}`,
                'Content-Length': Buffer.byteLength(postData),
            },
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${data}`)); return; }
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`Parse error: ${data}`)); }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function main() {
    console.log('='.repeat(80));
    console.log('Field Completeness Check');
    console.log('='.repeat(80));

    // Check stock_quotes_raw for specific tickers
    console.log('\n📊 stock_quotes_raw - Sample records for AAPL, NVDA:');
    const rawSample = await queryInfluxDB(`
        SELECT ticker, time, name, open, high, low, close, volume, vwap, trades, change, "changePercent", "previousClose"
        FROM stock_quotes_raw 
        WHERE ticker IN ('AAPL', 'NVDA', 'AMZN')
        ORDER BY time DESC 
        LIMIT 5
    `);
    rawSample.forEach((r, i) => {
        console.log(`\n[${i+1}] ${r.ticker} @ ${r.time}`);
        console.log(`  OHLCV: O=${r.open} H=${r.high} L=${r.low} C=${r.close} V=${r.volume}`);
        console.log(`  Extended: vwap=${r.vwap ?? 'NULL'}, trades=${r.trades ?? 'NULL'}`);
        console.log(`  Derived: change=${r.change ?? 'NULL'}, changePercent=${r.changePercent ?? 'NULL'}, prevClose=${r.previousClose ?? 'NULL'}`);
        console.log(`  Name: ${r.name ?? 'NULL'}`);
    });

    // Check stock_quotes_aggregated
    console.log('\n\n📈 stock_quotes_aggregated - Sample records:');
    const aggSample = await queryInfluxDB(`
        SELECT ticker, time, name, open, high, low, close, volume, vwap, trades, change, "changePercent"
        FROM stock_quotes_aggregated 
        WHERE ticker IN ('AAPL', 'NVDA', 'AMZN')
        ORDER BY time DESC 
        LIMIT 5
    `);
    aggSample.forEach((r, i) => {
        console.log(`\n[${i+1}] ${r.ticker} @ ${r.time}`);
        console.log(`  OHLCV: O=${r.open} H=${r.high} L=${r.low} C=${r.close} V=${r.volume}`);
        console.log(`  Extended: vwap=${r.vwap ?? 'NULL'}, trades=${r.trades ?? 'NULL'}`);
        console.log(`  Derived: change=${r.change ?? 'NULL'}, changePercent=${r.changePercent ?? 'NULL'}`);
        console.log(`  Name: ${r.name ?? 'NULL'}`);
    });

    // Check news
    console.log('\n\n📰 news - Sample records:');
    const newsSample = await queryInfluxDB(`
        SELECT ticker, time, source, title, "sentimentValue", "sentimentReason", author, description, "s3Path"
        FROM news 
        ORDER BY time DESC 
        LIMIT 3
    `);
    newsSample.forEach((r, i) => {
        console.log(`\n[${i+1}] ${r.ticker} @ ${r.time}`);
        console.log(`  Title: ${(r.title || '').substring(0, 60)}...`);
        console.log(`  Source: ${r.source ?? 'NULL'}`);
        console.log(`  Sentiment: value=${r.sentimentValue ?? 'NULL'}`);
        console.log(`  Reason: ${(r.sentimentReason || 'NULL').substring(0, 80)}...`);
        console.log(`  Author: ${r.author ?? 'NULL'}, s3Path: ${r.s3Path ?? 'NULL'}`);
    });

    // Check fundamentals
    console.log('\n\n💰 fundamentals - Sample records:');
    const fundSample = await queryInfluxDB(`
        SELECT ticker, time, "periodType", "fiscalYear", "fiscalPeriod", "companyName", revenue, "netIncome", eps, "totalAssets", "totalEquity"
        FROM fundamentals 
        ORDER BY time DESC 
        LIMIT 3
    `);
    fundSample.forEach((r, i) => {
        console.log(`\n[${i+1}] ${r.ticker} @ ${r.time} (${r.periodType})`);
        console.log(`  Period: FY${r.fiscalYear ?? '?'} ${r.fiscalPeriod ?? '?'}`);
        console.log(`  Company: ${r.companyName ?? 'NULL'}`);
        console.log(`  Income: revenue=${r.revenue ?? 'NULL'}, netIncome=${r.netIncome ?? 'NULL'}, eps=${r.eps ?? 'NULL'}`);
        console.log(`  Balance: totalAssets=${r.totalAssets ?? 'NULL'}, totalEquity=${r.totalEquity ?? 'NULL'}`);
    });

    // Count null fields
    console.log('\n\n' + '='.repeat(80));
    console.log('NULL Field Analysis');
    console.log('='.repeat(80));

    // Raw quotes null analysis
    const rawNulls = await queryInfluxDB(`
        SELECT 
            COUNT(*) as total,
            COUNT(name) as has_name,
            COUNT(vwap) as has_vwap,
            COUNT(trades) as has_trades,
            COUNT(change) as has_change,
            COUNT("changePercent") as has_changePercent,
            COUNT("previousClose") as has_previousClose
        FROM stock_quotes_raw
    `);
    if (rawNulls[0]) {
        const r = rawNulls[0];
        console.log('\nstock_quotes_raw:');
        console.log(`  Total records: ${r.total}`);
        console.log(`  name: ${r.has_name}/${r.total} (${((r.has_name/r.total)*100).toFixed(1)}%)`);
        console.log(`  vwap: ${r.has_vwap}/${r.total} (${((r.has_vwap/r.total)*100).toFixed(1)}%)`);
        console.log(`  trades: ${r.has_trades}/${r.total} (${((r.has_trades/r.total)*100).toFixed(1)}%)`);
        console.log(`  change: ${r.has_change}/${r.total} (${((r.has_change/r.total)*100).toFixed(1)}%)`);
        console.log(`  changePercent: ${r.has_changePercent}/${r.total} (${((r.has_changePercent/r.total)*100).toFixed(1)}%)`);
        console.log(`  previousClose: ${r.has_previousClose}/${r.total} (${((r.has_previousClose/r.total)*100).toFixed(1)}%)`);
    }

    // Aggregated quotes null analysis
    const aggNulls = await queryInfluxDB(`
        SELECT 
            COUNT(*) as total,
            COUNT(name) as has_name,
            COUNT(vwap) as has_vwap,
            COUNT(trades) as has_trades,
            COUNT(change) as has_change,
            COUNT("changePercent") as has_changePercent
        FROM stock_quotes_aggregated
    `);
    if (aggNulls[0]) {
        const r = aggNulls[0];
        console.log('\nstock_quotes_aggregated:');
        console.log(`  Total records: ${r.total}`);
        console.log(`  name: ${r.has_name}/${r.total} (${((r.has_name/r.total)*100).toFixed(1)}%)`);
        console.log(`  vwap: ${r.has_vwap}/${r.total} (${((r.has_vwap/r.total)*100).toFixed(1)}%)`);
        console.log(`  trades: ${r.has_trades}/${r.total} (${((r.has_trades/r.total)*100).toFixed(1)}%)`);
        console.log(`  change: ${r.has_change}/${r.total} (${((r.has_change/r.total)*100).toFixed(1)}%)`);
        console.log(`  changePercent: ${r.has_changePercent}/${r.total} (${((r.has_changePercent/r.total)*100).toFixed(1)}%)`);
    }

    console.log('\n✅ Done');
}

main().catch(console.error);
