/**
 * Market Status Utility
 *
 * Centralized market status checking using Massive API with fallback to time-based logic.
 * Provides caching to avoid excessive API calls.
 */

import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { toZonedTime } from 'date-fns-tz';
import { getHours, getMinutes, getDay } from 'date-fns';
import { CONFIG } from '../config.js';
import { createLogger } from './logger.js';
import {
    PRE_MARKET_START_MINUTES,
    MARKET_OPEN_MINUTES,
    MARKET_CLOSE_MINUTES,
    AFTER_HOURS_END_MINUTES,
} from './constants.js';

const logger = createLogger('MarketStatus');

// US Eastern timezone identifier
const EASTERN_TIMEZONE = 'America/New_York';

// Cache TTL
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

export interface MarketStatus {
    isOpen: boolean;
    afterHours: boolean;
    earlyHours: boolean;
}

interface CachedStatus extends MarketStatus {
    timestamp: number;
}

// Singleton instance for shared state
let cachedStatus: CachedStatus | null = null;
let apiKey: string | null = null;
let secretsClient: SecretsManagerClient | null = null;

/**
 * Get Massive API key from Secrets Manager
 */
async function getApiKey(): Promise<string> {
    if (apiKey) return apiKey;

    if (!secretsClient) {
        secretsClient = new SecretsManagerClient({ region: CONFIG.AWS_REGION });
    }

    const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: CONFIG.API_KEYS_SECRET_ARN })
    );

    if (!response.SecretString) {
        throw new Error('Failed to retrieve API keys');
    }

    const keys = JSON.parse(response.SecretString);
    apiKey = keys.MASSIVE_API_KEY;
    return apiKey!;
}

/**
 * Convert UTC date to Eastern Time components using date-fns-tz
 * Automatically handles DST transitions correctly
 *
 * @param date - UTC date
 * @returns Object with ET hours, minutes, and day of week
 */
function getEasternTimeComponents(date: Date): { hours: number; minutes: number; dayOfWeek: number } {
    // Convert to Eastern Time using date-fns-tz (handles DST automatically)
    const etTime = toZonedTime(date, EASTERN_TIMEZONE);

    return {
        hours: getHours(etTime),
        minutes: getMinutes(etTime),
        dayOfWeek: getDay(etTime),
    };
}

/**
 * Check market status based on time (fallback)
 * Uses Eastern Time for US market hours
 */
export function getMarketStatusByTime(): MarketStatus {
    const now = new Date();
    const et = getEasternTimeComponents(now);

    // Weekend - market closed
    if (et.dayOfWeek === 0 || et.dayOfWeek === 6) {
        return { isOpen: false, afterHours: false, earlyHours: false };
    }

    const currentMinutes = et.hours * 60 + et.minutes;

    return {
        isOpen: currentMinutes >= MARKET_OPEN_MINUTES && currentMinutes < MARKET_CLOSE_MINUTES,
        earlyHours: currentMinutes >= PRE_MARKET_START_MINUTES && currentMinutes < MARKET_OPEN_MINUTES,
        afterHours: currentMinutes >= MARKET_CLOSE_MINUTES && currentMinutes < AFTER_HOURS_END_MINUTES,
    };
}

/**
 * Get market status from Massive API with caching
 * Falls back to time-based check on API failure
 */
export async function getMarketStatus(forceRefresh: boolean = false): Promise<MarketStatus> {
    // Return cached value if still valid
    if (!forceRefresh && cachedStatus && Date.now() - cachedStatus.timestamp < CACHE_TTL_MS) {
        return {
            isOpen: cachedStatus.isOpen,
            afterHours: cachedStatus.afterHours,
            earlyHours: cachedStatus.earlyHours,
        };
    }

    try {
        const key = await getApiKey();
        const url = `${CONFIG.MASSIVE_BASE_URL}/v1/marketstatus/now`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${key}`,
            },
        });

        if (!response.ok) {
            logger.warn(`API returned ${response.status}, using fallback`);
            return getMarketStatusByTime();
        }

        const data = await response.json();

        // Massive returns: { market: "open" | "closed" | "extended-hours", afterHours: bool, earlyHours: bool }
        const status: MarketStatus = {
            isOpen: data.market === 'open',
            afterHours: data.afterHours || false,
            earlyHours: data.earlyHours || false,
        };

        // Update cache
        cachedStatus = {
            ...status,
            timestamp: Date.now(),
        };

        return status;
    } catch (error) {
        logger.warn('Failed to check market status:', { error: (error as Error).message });
        return getMarketStatusByTime();
    }
}

/**
 * Check if market is currently open (regular trading hours)
 */
export async function isMarketOpen(): Promise<boolean> {
    const status = await getMarketStatus();
    return status.isOpen;
}

/**
 * Check if market is in extended hours (pre-market or after-hours)
 */
export async function isExtendedHours(): Promise<boolean> {
    const status = await getMarketStatus();
    return status.afterHours || status.earlyHours;
}

/**
 * Get extended hours details (pre-market and after-hours status)
 */
export async function getExtendedHoursStatus(): Promise<{ afterHours: boolean; earlyHours: boolean }> {
    const status = await getMarketStatus();
    return {
        afterHours: status.afterHours,
        earlyHours: status.earlyHours,
    };
}

/**
 * Clear cached status (useful for testing)
 */
export function clearCache(): void {
    cachedStatus = null;
}

/**
 * Check if we should maintain SIP WebSocket connection
 * SIP data is 15-minute delayed, so we stay connected 15 minutes after market close
 * to receive all delayed data
 */
export async function shouldConnectSipWebSocket(): Promise<boolean> {
    const status = await getMarketStatus();

    // During regular market hours - always connect
    if (status.isOpen) {
        return true;
    }

    // During after-hours - stay connected for 15 minutes to receive delayed SIP data
    if (status.afterHours) {
        const now = new Date();
        const et = getEasternTimeComponents(now);
        const currentMinutes = et.hours * 60 + et.minutes;

        // Market closes at 16:00 ET (960 minutes)
        // Stay connected until 16:15 ET (975 minutes)
        const sipBufferEndMinutes = MARKET_CLOSE_MINUTES + 15;
        return currentMinutes < sipBufferEndMinutes;
    }

    return false;
}
