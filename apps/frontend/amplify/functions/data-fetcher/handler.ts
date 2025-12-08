import { AppSyncResolverHandler } from 'aws-lambda';
import {
  TimestreamQueryClient,
  QueryCommand,
} from '@aws-sdk/client-timestream-query';

const timestreamClient = new TimestreamQueryClient({});

// Environment variables
const DATABASE_NAME = process.env.TIMESTREAM_DATABASE || 'wavepilot-db';

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
 * AppSync Resolver: getHistoricalPrices
 *
 * Queries Timestream for K-line data based on the requested interval.
 * - For intervals < 1d: Query stock_quotes_raw
 * - For intervals >= 1d: Query stock_quotes_aggregated
 */
export const handler: AppSyncResolverHandler<GetHistoricalPricesArgs, KlineData[]> = async (
  event
) => {
  const { ticker, market, interval = '1d', startTime, endTime, limit = 500 } = event.arguments;

  console.log(`[getHistoricalPrices] ${ticker} (${market}) - ${interval}`);

  try {
    // Determine which table to query based on interval
    const tableName = getTableForInterval(interval);
    const query = buildQuery(tableName, ticker, market, interval, startTime, endTime, limit);

    const command = new QueryCommand({ QueryString: query });
    const response = await timestreamClient.send(command);

    // Parse Timestream response
    const klines = parseTimestreamResponse(response);

    console.log(`[getHistoricalPrices] Returned ${klines.length} records`);
    return klines;

  } catch (error) {
    console.error('[getHistoricalPrices] Error:', error);
    throw error;
  }
};

/**
 * Determine which Timestream table to query based on interval
 */
function getTableForInterval(interval: string): string {
  const dailyIntervals = ['1d', '1w', '1M'];
  return dailyIntervals.includes(interval) ? 'stock_quotes_aggregated' : 'stock_quotes_raw';
}

/**
 * Build Timestream query string
 */
function buildQuery(
  tableName: string,
  ticker: string,
  market: string,
  interval: string,
  startTime?: string,
  endTime?: string,
  limit?: number
): string {
  const now = new Date().toISOString();
  const defaultStart = getDefaultStartTime(interval);

  let query = `
    SELECT 
      time,
      open,
      high,
      low,
      close,
      volume
    FROM "${DATABASE_NAME}"."${tableName}"
    WHERE ticker = '${ticker}'
      AND market = '${market}'
      AND time >= '${startTime || defaultStart}'
      AND time <= '${endTime || now}'
  `;

  // For raw table, filter by interval if applicable
  if (tableName === 'stock_quotes_raw' && interval !== '1m') {
    // Aggregation needed for 5m, 15m, 1h intervals
    query = buildAggregatedQuery(ticker, market, interval, startTime || defaultStart, endTime || now, limit);
  } else {
    query += ` ORDER BY time DESC LIMIT ${limit || 500}`;
  }

  return query;
}

/**
 * Build aggregated query for sub-daily intervals (5m, 15m, 1h)
 */
function buildAggregatedQuery(
  ticker: string,
  market: string,
  interval: string,
  startTime: string,
  endTime: string,
  limit?: number
): string {
  const binSize = intervalToBinSize(interval);

  return `
    SELECT 
      bin(time, ${binSize}) AS time,
      FIRST(price, time) AS open,
      MAX(high) AS high,
      MIN(low) AS low,
      LAST(price, time) AS close,
      SUM(volume) AS volume
    FROM "${DATABASE_NAME}"."stock_quotes_raw"
    WHERE ticker = '${ticker}'
      AND market = '${market}'
      AND time >= '${startTime}'
      AND time <= '${endTime}'
    GROUP BY bin(time, ${binSize})
    ORDER BY time DESC
    LIMIT ${limit || 500}
  `;
}

/**
 * Convert interval string to Timestream bin size
 */
function intervalToBinSize(interval: string): string {
  const mapping: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '1h': '1h',
    '1d': '1d',
  };
  return mapping[interval] || '1d';
}

/**
 * Get default start time based on interval
 */
function getDefaultStartTime(interval: string): string {
  const now = new Date();
  const mapping: Record<string, number> = {
    '1m': 1,      // 1 day
    '5m': 5,      // 5 days
    '15m': 7,     // 7 days
    '1h': 30,     // 30 days
    '1d': 365,    // 1 year
    '1w': 365 * 2, // 2 years
    '1M': 365 * 5, // 5 years
  };
  const days = mapping[interval] || 365;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

/**
 * Parse Timestream query response to KlineData array
 */
function parseTimestreamResponse(response: any): KlineData[] {
  if (!response.Rows || response.Rows.length === 0) {
    return [];
  }

  const columnInfo = response.ColumnInfo || [];
  const columnNames = columnInfo.map((col: any) => col.Name);

  return response.Rows.map((row: any) => {
    const data: Record<string, any> = {};
    row.Data.forEach((cell: any, index: number) => {
      const colName = columnNames[index];
      const value = cell.ScalarValue;
      data[colName] = colName === 'time' ? value : parseFloat(value) || 0;
    });

    return {
      time: data.time,
      open: data.open,
      high: data.high,
      low: data.low,
      close: data.close,
      volume: data.volume,
    };
  });
}