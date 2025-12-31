/**
 * Ticker Filtering Utilities
 *
 * Filters stock tickers to exclude OTC, warrants, units, rights, and other
 * non-common stock securities.
 */

export type TickerFilterType = 'all' | 'mainboard' | 'common';

/**
 * Check if ticker should be included based on filter type
 *
 * Filter types:
 * - all: Include everything (OTC, preferred, warrants, etc.)
 * - mainboard: Only 1-5 uppercase letter tickers (NYSE/NASDAQ style)
 *              Excludes most: OTC (with numbers), preferred (with . or -), foreign ordinaries
 *              Note: Some OTC stocks with pure letter tickers may pass through
 * - common: Mainboard + exclude SPAC derivatives (warrants, units, rights)
 *
 * @param ticker - Stock ticker symbol
 * @param filter - Filter type to apply
 * @returns true if ticker should be included
 */
export function shouldIncludeTicker(ticker: string, filter: TickerFilterType = 'common'): boolean {
    if (filter === 'all') return true;

    // Basic validation: must be uppercase letters only, 1-5 chars
    // This excludes:
    // - OTC stocks with numbers or special chars
    // - Preferred stocks (e.g., BAC-PL, WFC.PRZ)
    // - Foreign ordinaries (e.g., BABA.SW)
    const isMainboard = /^[A-Z]{1,5}$/.test(ticker);
    if (!isMainboard) return false;

    if (filter === 'mainboard') return true;

    // For 'common' filter, exclude known non-common patterns
    // These are heuristics based on common SPAC naming conventions
    const excludePatterns = [
        /^[A-Z]{4}W$/, // Warrants (e.g., SPACW, ACAHW)
        /^[A-Z]{4}U$/, // Units (e.g., SPACU, ACAHU)
        /^[A-Z]{4}R$/, // Rights (e.g., SPACR, ACAHR)
        /^[A-Z]{3}WS$/, // Alternative warrant format
    ];

    for (const pattern of excludePatterns) {
        if (pattern.test(ticker)) return false;
    }

    return true;
}

/**
 * Filter an array of records by ticker
 *
 * @param records - Array of records with ticker property
 * @param filter - Filter type to apply
 * @returns Filtered array
 */
export function filterByTicker<T extends { ticker: string }>(
    records: T[],
    filter: TickerFilterType = 'common'
): T[] {
    if (filter === 'all') return records;
    return records.filter((r) => shouldIncludeTicker(r.ticker, filter));
}

/**
 * Filter an array of Massive API bars by ticker (T field)
 *
 * @param bars - Array of Massive API bars with T (ticker) property
 * @param filter - Filter type to apply
 * @returns Filtered array
 */
export function filterBarsByTicker<T extends { T?: string }>(
    bars: T[],
    filter: TickerFilterType = 'common'
): T[] {
    if (filter === 'all') return bars;
    return bars.filter((b) => b.T && shouldIncludeTicker(b.T, filter));
}
