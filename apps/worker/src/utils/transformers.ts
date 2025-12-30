/**
 * Data Transformers
 *
 * Transform API responses to database record formats.
 * Handles data from Massive and Alpaca APIs.
 */

import type {
    Market,
    QuoteRecord,
    DailyRecord,
    NewsRecord,
    FundamentalsRecord,
    Sentiment,
} from '@wavepilot/shared';

import { createLogger } from './logger.js';

const logger = createLogger('Transformer');

// ============================================================================
// Massive API Transformers
// ============================================================================

/**
 * Transform Massive bar data to QuoteRecord (minute-level)
 *
 * @param bar - Massive Aggregates API response item
 * @param ticker - Stock ticker symbol
 * @param market - Market identifier
 * @returns QuoteRecord for InfluxDB or null if invalid data
 *
 * @example
 * // Massive API bar format:
 * // { t: 1766048400000, o: 22.2, h: 22.2, l: 22.13, c: 22.13, v: 1286, vw: 22.1598, n: 14 }
 */
export function transformMassiveBarToQuote(
    bar: {
        t: number;      // timestamp (ms)
        o: number;      // open
        h: number;      // high
        l: number;      // low
        c: number;      // close
        v: number;      // volume
        vw?: number;    // vwap
        n?: number;     // trades
    },
    ticker: string,
    market: Market
): QuoteRecord | null {
    // Validate required fields
    if (!bar.t || bar.o === undefined || bar.c === undefined) {
        logger.warn(`Invalid bar data for ${ticker}: missing required fields`, { bar });
        return null;
    }

    return {
        time: new Date(bar.t),
        ticker,
        name: ticker,
        market,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        vwap: bar.vw,
        trades: bar.n,
    };
}

/**
 * Transform Massive bar data to DailyRecord
 *
 * @param bar - Massive Aggregates API response item (may include T for grouped daily)
 * @param ticker - Stock ticker symbol (fallback if bar.T not present)
 * @param market - Market identifier
 * @param date - Optional date override (for grouped daily)
 * @returns DailyRecord for InfluxDB
 */
export function transformMassiveBarToDaily(
    bar: {
        T?: string;     // ticker (grouped daily only)
        t: number;      // timestamp (ms)
        o: number;      // open
        h: number;      // high
        l: number;      // low
        c: number;      // close
        v: number;      // volume
        vw?: number;    // vwap
        n?: number;     // trades
    },
    ticker: string,
    market: Market,
    date?: Date
): DailyRecord {
    const change = Number((bar.c - bar.o).toFixed(4));
    const changePercent = bar.o !== 0
        ? Number(((bar.c - bar.o) / bar.o * 100).toFixed(4))
        : 0;

    return {
        time: date || new Date(bar.t),
        ticker: bar.T || ticker,
        name: bar.T || ticker,
        market,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        vwap: bar.vw,
        trades: bar.n,
        change,
        changePercent,
    };
}

/**
 * Transform Massive Snapshot ticker to DailyRecord
 *
 * @param ticker - Massive Snapshot API ticker item
 * @param market - Market identifier
 * @param date - Date for the record (typically today)
 * @returns DailyRecord for InfluxDB
 *
 * @example
 * // Massive Snapshot ticker format:
 * // {
 * //   ticker: "AAPL",
 * //   day: { o: 150.0, h: 152.0, l: 149.5, c: 151.5, v: 1000000, vw: 150.8 },
 * //   todaysChange: 1.5,
 * //   todaysChangePerc: 1.0
 * // }
 */
export function transformMassiveSnapshotToDaily(
    item: {
        ticker: string;
        day?: {
            o?: number;     // open
            h?: number;     // high
            l?: number;     // low
            c?: number;     // close
            v?: number;     // volume
            vw?: number;    // vwap
        };
        todaysChange?: number;
        todaysChangePerc?: number;
    },
    market: Market,
    date: Date
): DailyRecord {
    return {
        time: date,
        ticker: item.ticker,
        name: item.ticker,
        market,
        open: item.day?.o || 0,
        high: item.day?.h || 0,
        low: item.day?.l || 0,
        close: item.day?.c || 0,
        volume: item.day?.v || 0,
        vwap: item.day?.vw,
        change: item.todaysChange,
        changePercent: item.todaysChangePerc,
    };
}

/**
 * Transform Massive news item to NewsRecord
 *
 * @param item - Massive News API response item
 * @param ticker - Primary ticker to extract sentiment for
 * @param market - Market identifier
 * @returns NewsRecord for InfluxDB
 *
 * @example
 * // Massive News API item format:
 * // {
 * //   id: "abc123",
 * //   publisher: { name: "The Motley Fool", ... },
 * //   title: "...",
 * //   author: "...",
 * //   published_utc: "2025-12-15T15:10:00Z",
 * //   article_url: "https://...",
 * //   tickers: ["AAPL", "TSLA"],
 * //   image_url: "https://...",
 * //   description: "...",
 * //   keywords: ["AI", "stocks"],
 * //   insights: [{ ticker: "AAPL", sentiment: "positive", sentiment_reasoning: "..." }]
 * // }
 */
export function transformMassiveNewsToRecord(
    item: {
        id: string;
        publisher?: { name?: string };
        title: string;
        author?: string;
        published_utc: string;
        article_url: string;
        tickers?: string[];
        image_url?: string;
        description?: string;
        keywords?: string[];
        insights?: Array<{
            ticker: string;
            sentiment: string;
            sentiment_reasoning?: string;
        }>;
    },
    ticker: string,
    market: Market
): NewsRecord {
    // Find sentiment for the primary ticker
    const insight = item.insights?.find((i) => i.ticker === ticker);
    const sentimentMap: Record<string, Sentiment> = {
        positive: 'positive',
        negative: 'negative',
        neutral: 'neutral',
    };

    return {
        time: new Date(item.published_utc),
        ticker,
        market,
        id: item.id,
        title: item.title,
        url: item.article_url,
        source: item.publisher?.name || 'Unknown',
        author: item.author,
        description: item.description,
        imageUrl: item.image_url,
        keywords: item.keywords,
        tickers: item.tickers,
        sentiment: insight ? sentimentMap[insight.sentiment] : undefined,
        sentimentReasoning: insight?.sentiment_reasoning,
    };
}

/**
 * Transform Massive financials to FundamentalsRecord
 *
 * @param item - Massive Financials API response item
 * @param ticker - Stock ticker symbol
 * @param market - Market identifier
 * @returns FundamentalsRecord for InfluxDB
 */
export function transformMassiveFinancialsToRecord(
    item: {
        start_date?: string;
        end_date: string;
        filing_date?: string;
        timeframe?: string;
        fiscal_period?: string;
        fiscal_year?: string;
        company_name?: string;
        cik?: string;
        sic?: string;
        financials?: {
            income_statement?: Record<string, { value?: number }>;
            balance_sheet?: Record<string, { value?: number }>;
            cash_flow_statement?: Record<string, { value?: number }>;
        };
    },
    ticker: string,
    market: Market
): FundamentalsRecord {
    const financials = item.financials || {};
    const incomeStatement = financials.income_statement || {};
    const balanceSheet = financials.balance_sheet || {};
    const cashFlow = financials.cash_flow_statement || {};

    return {
        time: new Date(item.end_date),
        ticker,
        market,
        periodType: item.timeframe === 'quarterly' ? 'quarterly' : 'annual',
        fiscalYear: item.fiscal_year ? parseInt(item.fiscal_year) : undefined,
        fiscalPeriod: item.fiscal_period,
        filingDate: item.filing_date ? new Date(item.filing_date) : undefined,
        companyName: item.company_name,
        cik: item.cik,
        sic: item.sic,
        // Income Statement
        revenue: incomeStatement.revenues?.value,
        costOfRevenue: incomeStatement.cost_of_revenue?.value,
        grossProfit: incomeStatement.gross_profit?.value,
        operatingExpenses: incomeStatement.operating_expenses?.value,
        operatingIncome: incomeStatement.operating_income_loss?.value,
        netIncome: incomeStatement.net_income_loss?.value,
        eps: incomeStatement.basic_earnings_per_share?.value,
        epsDiluted: incomeStatement.diluted_earnings_per_share?.value,
        sharesBasic: incomeStatement.basic_average_shares?.value,
        sharesDiluted: incomeStatement.diluted_average_shares?.value,
        // Balance Sheet
        totalAssets: balanceSheet.assets?.value,
        currentAssets: balanceSheet.current_assets?.value,
        totalLiabilities: balanceSheet.liabilities?.value,
        currentLiabilities: balanceSheet.current_liabilities?.value,
        totalEquity: balanceSheet.equity?.value,
        fixedAssets: balanceSheet.fixed_assets?.value,
        accountsPayable: balanceSheet.accounts_payable?.value,
        // Cash Flow
        operatingCashFlow: cashFlow.net_cash_flow_from_operating_activities?.value,
        investingCashFlow: cashFlow.net_cash_flow_from_investing_activities?.value,
        financingCashFlow: cashFlow.net_cash_flow_from_financing_activities?.value,
        netCashFlow: cashFlow.net_cash_flow?.value,
    };
}

// ============================================================================
// Alpaca API Transformers
// ============================================================================

/**
 * Transform Alpaca bar to QuoteRecord
 *
 * @param bar - Alpaca Bars API response item
 * @param ticker - Stock ticker symbol
 * @param market - Market identifier
 * @returns QuoteRecord for InfluxDB
 *
 * @example
 * // Alpaca bar format:
 * // { Timestamp: "2025-...", OpenPrice: 22.2, HighPrice: 22.3, LowPrice: 22.1,
 * //   ClosePrice: 22.25, Volume: 1000, VWAP: 22.2, TradeCount: 50 }
 */
export function transformAlpacaBarToQuote(
    bar: {
        Timestamp: string;
        OpenPrice: number;
        HighPrice: number;
        LowPrice: number;
        ClosePrice: number;
        Volume: number;
        VWAP?: number;
        TradeCount?: number;
    },
    ticker: string,
    market: Market
): QuoteRecord {
    return {
        time: new Date(bar.Timestamp),
        ticker,
        name: ticker,
        market,
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume,
        vwap: bar.VWAP,
        trades: bar.TradeCount,
    };
}

/**
 * Transform Alpaca realtime bar (WebSocket) to QuoteRecord
 *
 * @param bar - Alpaca WebSocket bar event
 * @param market - Market identifier
 * @returns QuoteRecord for InfluxDB
 */
export function transformAlpacaRealtimeBarToQuote(
    bar: {
        Symbol: string;
        Timestamp: string;
        OpenPrice: number;
        HighPrice: number;
        LowPrice: number;
        ClosePrice: number;
        Volume: number;
        VWAP?: number;
        TradeCount?: number;
    },
    market: Market = 'US'
): QuoteRecord {
    return {
        time: new Date(bar.Timestamp),
        ticker: bar.Symbol,
        name: bar.Symbol,
        market,
        open: bar.OpenPrice,
        high: bar.HighPrice,
        low: bar.LowPrice,
        close: bar.ClosePrice,
        volume: bar.Volume,
        vwap: bar.VWAP,
        trades: bar.TradeCount,
    };
}
