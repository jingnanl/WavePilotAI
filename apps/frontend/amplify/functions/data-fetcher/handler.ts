import { AppSyncResolverHandler } from 'aws-lambda';
import { InfluxDBClient } from '@influxdata/influxdb3-client';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// Environment variables
const INFLUXDB_ENDPOINT = process.env.INFLUXDB_ENDPOINT || '';
const INFLUXDB_SECRET_ARN = process.env.INFLUXDB_SECRET_ARN || '';
const DATABASE = 'market-data';

// Clients
let influxClient: InfluxDBClient | null = null;
const secretsClient = new SecretsManagerClient({});

interface GetHistoricalPricesArgs {
  ticker: string;
  market: string;
  interval?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M';
  startTime?: string;
  endTime?: string;
  limit?: number;
}

interface KlineData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Initialize InfluxDB client with credentials from Secrets Manager
 */
async function getInfluxClient(): Promise<InfluxDBClient> {
  if (influxClient) return influxClient;

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

  console.log('[InfluxDB] Client initialized');
  return influxClient;
}

/**
 * AppSync Resolver: getHistoricalPrices
 *
 * Queries InfluxDB for K-line data based on the requested interval.
 */
export const handler: AppSyncResolverHandler<GetHistoricalPricesArgs, KlineData[]> = async (
  event
) => {
  const { ticker, market, interval = '1d', startTime, endTime, limit = 500 } = event.arguments;
  console.log(`[getHistoricalPrices] ${ticker} (${market}) - ${interval}`);

  try {
    const client = await getInfluxClient();

    // Build query based on interval
    const measurement = interval === '1d' || interval === '1w' || interval === '1M'
      ? 'stock_quotes_aggregated'
      : 'stock_quotes_raw';

    const timeFilter = buildTimeFilter(interval, startTime, endTime);

    const query = `
      SELECT time, open, high, low, close, volume 
      FROM ${measurement}
      WHERE ticker = '${ticker}' 
        AND market = '${market}'
        ${timeFilter}
      ORDER BY time DESC
      LIMIT ${limit}
    `;

    console.log('[getHistoricalPrices] Query:', query);

    const results: KlineData[] = [];
    const reader = client.query(query, DATABASE);

    for await (const row of reader) {
      results.push({
        time: row.time?.toString() || '',
        open: parseFloat(row.open) || 0,
        high: parseFloat(row.high) || 0,
        low: parseFloat(row.low) || 0,
        close: parseFloat(row.close) || 0,
        volume: parseInt(row.volume) || 0,
      });
    }

    console.log(`[getHistoricalPrices] Returned ${results.length} records`);
    return results;

  } catch (error) {
    console.error('[getHistoricalPrices] Error:', error);
    throw error;
  }
};

/**
 * Build time filter clause for InfluxDB query
 */
function buildTimeFilter(interval: string, startTime?: string, endTime?: string): string {
  const now = new Date();
  const defaultDays: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 7,
    '1h': 30,
    '1d': 365,
    '1w': 730,
    '1M': 1825,
  };

  const days = defaultDays[interval] || 365;
  const defaultStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const start = startTime ? new Date(startTime) : defaultStart;
  const end = endTime ? new Date(endTime) : now;

  return `AND time >= '${start.toISOString()}' AND time <= '${end.toISOString()}'`;
}