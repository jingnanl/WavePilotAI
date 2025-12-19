/**
 * InfluxDB Query Tool
 *
 * Provides utilities for querying Amazon Timestream for InfluxDB for stock data.
 * Uses SQL queries for flexible data retrieval.
 */

import { z } from 'zod';
import * as strands from '@strands-agents/sdk';
import { InfluxDBClient } from '@influxdata/influxdb3-client';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const INFLUXDB_ENDPOINT = process.env.INFLUXDB_ENDPOINT || '';
const INFLUXDB_SECRET_ARN = process.env.INFLUXDB_SECRET_ARN || '';
const DATABASE = process.env.INFLUXDB_DATABASE || 'market_data';

// Singleton client instance
let influxClient: InfluxDBClient | null = null;

/**
 * Initialize or get the InfluxDB client
 */
async function getClient(): Promise<InfluxDBClient> {
    if (influxClient) return influxClient;

    const secretsClient = new SecretsManagerClient({});
    const secretResponse = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: INFLUXDB_SECRET_ARN })
    );

    if (!secretResponse.SecretString) {
        throw new Error('Failed to retrieve InfluxDB credentials');
    }

    const credentials = JSON.parse(secretResponse.SecretString);
    const token = credentials.token || credentials.password;

    influxClient = new InfluxDBClient({
        host: `https://${INFLUXDB_ENDPOINT}:8181`,
        token: token,
        database: DATABASE,
    });

    return influxClient;
}

/**
 * Query K-line data from stock_quotes_raw
 */
export const queryKlineData = async (
    ticker: string,
    market: string,
    interval: string,
    limit: number = 500
): Promise<unknown[]> => {
    const client = await getClient();

    // Calculate time range based on interval
    const intervalHours: Record<string, number> = {
        '1m': 8,      // 8 hours of 1-minute data
        '5m': 24,     // 24 hours of 5-minute data
        '15m': 72,    // 3 days of 15-minute data
        '1h': 168,    // 1 week of hourly data
        '1d': 8760,   // 1 year of daily data
    };

    const hours = intervalHours[interval] || 24;

    const query = `
        SELECT *
        FROM stock_quotes_raw
        WHERE ticker = '${ticker}'
          AND market = '${market}'
          AND time >= now() - INTERVAL '${hours} hours'
        ORDER BY time DESC
        LIMIT ${limit}
    `;

    try {
        const results: unknown[] = [];
        for await (const row of client.query(query, DATABASE)) {
            results.push(row);
        }
        console.log(`[InfluxDB] Queried ${results.length} K-line records for ${ticker}`);
        return results;
    } catch (error) {
        console.error('[InfluxDB] Query error:', error);
        throw error;
    }
};

/**
 * Query daily data from stock_quotes_aggregated
 */
export const queryDailyData = async (
    ticker: string,
    market: string,
    days: number = 365
): Promise<unknown[]> => {
    const client = await getClient();

    const query = `
        SELECT *
        FROM stock_quotes_aggregated
        WHERE ticker = '${ticker}'
          AND market = '${market}'
          AND time >= now() - INTERVAL '${days} days'
        ORDER BY time DESC
    `;

    try {
        const results: unknown[] = [];
        for await (const row of client.query(query, DATABASE)) {
            results.push(row);
        }
        console.log(`[InfluxDB] Queried ${results.length} daily records for ${ticker}`);
        return results;
    } catch (error) {
        console.error('[InfluxDB] Query error:', error);
        throw error;
    }
};

/**
 * Query fundamentals data
 */
export const queryFundamentals = async (
    ticker: string,
    market: string,
    periodType?: string
): Promise<unknown> => {
    const client = await getClient();

    let query = `
        SELECT *
        FROM fundamentals
        WHERE ticker = '${ticker}'
          AND market = '${market}'
    `;

    if (periodType) {
        query += ` AND periodType = '${periodType}'`;
    }

    query += ` ORDER BY time DESC LIMIT 10`;

    try {
        const results: unknown[] = [];
        for await (const row of client.query(query, DATABASE)) {
            results.push(row);
        }
        console.log(`[InfluxDB] Queried ${results.length} fundamentals records for ${ticker}`);
        return results;
    } catch (error) {
        console.error('[InfluxDB] Query error:', error);
        throw error;
    }
};

/**
 * Query news data
 */
export const queryNews = async (
    ticker: string,
    market: string,
    hours: number = 24
): Promise<unknown[]> => {
    const client = await getClient();

    const query = `
        SELECT *
        FROM news
        WHERE ticker = '${ticker}'
          AND market = '${market}'
          AND time >= now() - INTERVAL '${hours} hours'
        ORDER BY time DESC
        LIMIT 50
    `;

    try {
        const results: unknown[] = [];
        for await (const row of client.query(query, DATABASE)) {
            results.push(row);
        }
        console.log(`[InfluxDB] Queried ${results.length} news records for ${ticker}`);
        return results;
    } catch (error) {
        console.error('[InfluxDB] Query error:', error);
        throw error;
    }
};

/**
 * Strands Tool: Get Stock Quotes
 */
export const getStockQuotesTool = strands.tool({
    name: 'get_stock_quotes',
    description: 'Get stock quote data (K-line/candlestick) from InfluxDB',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market: US, CN (China A-shares), or HK'),
        interval: z.enum(['1m', '5m', '15m', '1h', '1d']).describe('Time interval for K-line data'),
        limit: z.number().optional().describe('Maximum number of records to return'),
    }),
    callback: async (input): Promise<string> => {
        const data = await queryKlineData(
            input.ticker,
            input.market,
            input.interval,
            input.limit || 500
        );
        return JSON.stringify(data);
    },
});

/**
 * Strands Tool: Get Daily Stock Data
 */
export const getDailyDataTool = strands.tool({
    name: 'get_daily_data',
    description: 'Get historical daily stock data from InfluxDB',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market: US, CN, or HK'),
        days: z.number().optional().describe('Number of days of history to retrieve'),
    }),
    callback: async (input): Promise<string> => {
        const data = await queryDailyData(
            input.ticker,
            input.market,
            input.days || 365
        );
        return JSON.stringify(data);
    },
});

/**
 * Strands Tool: Get Stock Fundamentals
 */
export const getFundamentalsTool = strands.tool({
    name: 'get_fundamentals',
    description: 'Get stock fundamentals (financial data) from InfluxDB',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market: US, CN, or HK'),
        periodType: z.enum(['quarterly', 'annual']).optional().describe('Financial period type'),
    }),
    callback: async (input): Promise<string> => {
        const data = await queryFundamentals(
            input.ticker,
            input.market,
            input.periodType
        );
        return JSON.stringify(data);
    },
});

/**
 * Strands Tool: Get Stock News
 */
export const getNewsTool = strands.tool({
    name: 'get_news',
    description: 'Get recent news for a stock from InfluxDB',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market: US, CN, or HK'),
        hours: z.number().optional().describe('Number of hours of news to retrieve'),
    }),
    callback: async (input): Promise<string> => {
        const data = await queryNews(
            input.ticker,
            input.market,
            input.hours || 24
        );
        return JSON.stringify(data);
    },
});
