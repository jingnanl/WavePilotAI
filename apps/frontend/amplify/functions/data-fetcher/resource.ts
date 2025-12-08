import { defineFunction } from '@aws-amplify/backend';

/**
 * Data Fetcher Lambda Function
 *
 * Fetches stock market data from external APIs (FinnHub, AKShare)
 * and writes to Timestream database
 */
export const dataFetcher = defineFunction({
  name: 'wavepilot-data-fetcher',
  runtime: 20, // Node.js 20.x
  timeoutSeconds: 120,
  memoryMB: 1024,
  entry: './handler.ts',
});