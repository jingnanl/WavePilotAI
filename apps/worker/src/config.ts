import { Market } from '@wavepilot/shared';

/**
 * Centralized configuration for WavePilotAI Worker Service
 *
 * Environment variables are configured via:
 * - Local: apps/worker/.env
 * - Production: Amplify Console Environment Variables
 */
export const CONFIG = {
  // =========================================================================
  // AWS
  // =========================================================================
  AWS_REGION: process.env.AWS_REGION || 'us-west-2',

  // =========================================================================
  // InfluxDB (Timestream for InfluxDB)
  // =========================================================================
  INFLUXDB_ENDPOINT: process.env.INFLUXDB_ENDPOINT || '',
  INFLUXDB_PORT: parseInt(process.env.INFLUXDB_PORT || '8181', 10),
  INFLUXDB_DATABASE: process.env.INFLUXDB_DATABASE || 'market_data',
  INFLUXDB_SECRET_ARN: process.env.INFLUXDB_SECRET_ARN || '',

  // =========================================================================
  // S3 Storage
  // =========================================================================
  DATA_BUCKET: process.env.DATA_BUCKET || '',
  FETCH_NEWS_CONTENT: process.env.FETCH_NEWS_CONTENT === 'true',

  // =========================================================================
  // Secrets Manager
  // =========================================================================
  API_KEYS_SECRET_ARN: process.env.API_KEYS_SECRET_ARN || 'wavepilot/api-keys',

  // =========================================================================
  // Massive API (Market Data Provider)
  // =========================================================================
  MASSIVE_BASE_URL: process.env.MASSIVE_BASE_URL || 'https://api.massive.com',
  MASSIVE_WS_URL: process.env.MASSIVE_WS_URL || 'wss://socket.massive.com/stocks',
  MASSIVE_DELAYED_WS_URL: process.env.MASSIVE_DELAYED_WS_URL || 'wss://delayed.massive.com/stocks',

  // =========================================================================
  // Worker Runtime Settings
  // =========================================================================
  DEFAULT_WATCHLIST: (process.env.DEFAULT_WATCHLIST || 'AAPL,TSLA,NVDA,AMZN,GOOGL').split(','),
  HEALTH_CHECK_PORT: parseInt(process.env.HEALTH_CHECK_PORT || '8080', 10),
  ENABLE_REALTIME: process.env.ENABLE_REALTIME !== 'false',
  ENABLE_SCHEDULER: process.env.ENABLE_SCHEDULER !== 'false',

  // =========================================================================
  // Connection Settings (hardcoded)
  // =========================================================================
  RECONNECT_DELAY_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 10,
  MARKET_CHECK_INTERVAL_MS: 60 * 1000, // 1 minute
  POST_MARKET_BUFFER_MS: 15 * 60 * 1000, // 15 minutes

  // =========================================================================
  // Business Logic (hardcoded)
  // =========================================================================
  DEFAULT_MARKET: 'US' as Market,
  BACKFILL_DAYS: 30, // History backfill window
  STITCHING_DELAY_MINUTES: 15, // Delay for SIP vs IEX stitching
};
