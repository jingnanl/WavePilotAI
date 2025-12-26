/**
 * Constants
 *
 * Centralized magic numbers and configuration values.
 */

// ============================================================================
// Timeouts & Intervals
// ============================================================================

/** HTTP request timeout in milliseconds */
export const HTTP_TIMEOUT_MS = 10_000;

/** WebSocket ping interval in milliseconds */
export const WS_PING_INTERVAL_MS = 30_000;

/** WebSocket pong timeout in milliseconds (disconnect if no pong received) */
export const WS_PONG_TIMEOUT_MS = 10_000;

// ============================================================================
// Data Limits
// ============================================================================

/** Minimum article content length to be considered valid */
export const MIN_ARTICLE_CONTENT_LENGTH = 100;

/** Maximum article content size in characters */
export const MAX_ARTICLE_CONTENT_SIZE = 50_000;

/** Maximum S3 metadata value length (ASCII only) */
export const MAX_S3_METADATA_LENGTH = 200;

/** Batch size for database writes */
export const DB_WRITE_BATCH_SIZE = 1_000;

// ============================================================================
// Rate Limiting
// ============================================================================

/** Delay between API requests to avoid rate limiting (ms) */
export const API_REQUEST_DELAY_MS = 200;

/** Delay between backfill requests (ms) */
export const BACKFILL_REQUEST_DELAY_MS = 300;

// ============================================================================
// Market Hours (Eastern Time)
// ============================================================================

/** Pre-market start time in minutes from midnight ET */
export const PRE_MARKET_START_MINUTES = 4 * 60; // 4:00 AM

/** Regular market open time in minutes from midnight ET */
export const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM

/** Regular market close time in minutes from midnight ET */
export const MARKET_CLOSE_MINUTES = 16 * 60; // 4:00 PM

/** After-hours end time in minutes from midnight ET */
export const AFTER_HOURS_END_MINUTES = 20 * 60; // 8:00 PM
