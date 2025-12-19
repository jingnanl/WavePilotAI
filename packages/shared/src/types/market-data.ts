/**
 * Market Data Types
 *
 * Shared data structures for market data across WavePilotAI.
 * Used by: Worker (data ingestion), Frontend (display), Agents (analysis)
 *
 * Based on actual API responses from Massive and Alpaca.
 */

// ============================================================================
// Common Types
// ============================================================================

/** Supported market identifiers */
export type Market = 'US' | 'CN' | 'HK';

/** Sentiment classification */
export type Sentiment = 'positive' | 'negative' | 'neutral';

/** Financial report period type */
export type PeriodType = 'quarterly' | 'annual';

// ============================================================================
// stock_quotes_raw - 1-minute bar data
// ============================================================================

/**
 * Real-time quote record for minute-level data
 *
 * Data Sources:
 * - Massive Aggregates API (minute timespan)
 * - Alpaca Bars API (1Min timeframe)
 *
 * Storage: InfluxDB measurement "stock_quotes_raw"
 *
 * @example
 * // Massive API response mapping:
 * // { t: timestamp, o: open, h: high, l: low, c: close, v: volume, vw: vwap, n: trades }
 */
export interface QuoteRecord {
    // --- Tags (indexed) ---
    /** Stock ticker symbol (e.g., AAPL, TSLA) */
    ticker: string;
    /** Market identifier */
    market: Market;

    // --- Fields ---
    /** Bar timestamp */
    time: Date;
    /** Stock name (for display) */
    name: string;

    // OHLCV core data
    /** Opening price (Massive: o, Alpaca: OpenPrice) */
    open: number;
    /** Highest price (Massive: h, Alpaca: HighPrice) */
    high: number;
    /** Lowest price (Massive: l, Alpaca: LowPrice) */
    low: number;
    /** Closing price (Massive: c, Alpaca: ClosePrice) */
    close: number;
    /** Trading volume (Massive: v, Alpaca: Volume) */
    volume: number;

    // Extended fields from API
    /** Volume-weighted average price (Massive: vw, Alpaca: VWAP) */
    vwap?: number;
    /** Number of trades in the bar (Massive: n, Alpaca: TradeCount) */
    trades?: number;

    // Derived fields (optional)
    /** Price change from previous close */
    change?: number;
    /** Price change percentage */
    changePercent?: number;
    /** Previous day's closing price */
    previousClose?: number;
}

// ============================================================================
// stock_quotes_aggregated - Daily bar data
// ============================================================================

/**
 * Daily aggregated record for daily-level data
 *
 * Data Sources:
 * - Massive Aggregates API (day timespan)
 * - Massive Grouped Daily API (all tickers for a date)
 *
 * Storage: InfluxDB measurement "stock_quotes_aggregated"
 *
 * Design Notes:
 * - Only stores daily (1D) historical K-line data
 * - Intraday periods (5m, 30m, 1h) are aggregated from stock_quotes_raw
 * - Daily data is corrected using Massive Grouped Daily after market close
 */
export interface DailyRecord {
    // --- Tags (indexed) ---
    /** Stock ticker symbol */
    ticker: string;
    /** Market identifier */
    market: Market;

    // --- Fields ---
    /** Trading day timestamp (usually 00:00:00 or market close time) */
    time: Date;
    /** Stock name */
    name: string;

    // OHLCV core data
    /** Opening price */
    open: number;
    /** Highest price */
    high: number;
    /** Lowest price */
    low: number;
    /** Closing price */
    close: number;
    /** Trading volume */
    volume: number;

    // Extended fields from API
    /** Volume-weighted average price */
    vwap?: number;
    /** Number of trades */
    trades?: number;

    // Derived fields
    /** Price change (close - open) */
    change?: number;
    /** Price change percentage ((close - open) / open * 100) */
    changePercent?: number;
}

// ============================================================================
// news - News metadata
// ============================================================================

/**
 * News insight for a specific ticker (from Massive API insights array)
 */
export interface NewsInsight {
    /** Related ticker */
    ticker: string;
    /** Sentiment classification */
    sentiment: Sentiment;
    /** Reasoning for the sentiment */
    sentimentReasoning: string;
}

/**
 * News record with metadata
 *
 * Data Source: Massive News API
 *
 * Storage:
 * - InfluxDB measurement "news": metadata for time-series queries
 * - S3 bucket: full article content for Agent analysis
 *
 * Design Notes:
 * - InfluxDB stores only metadata (title, url, sentiment, etc.)
 * - S3 stores fetched full article content with metadata in object tags
 * - s3Path links InfluxDB record to S3 object
 */
export interface NewsRecord {
    // --- Tags (indexed) ---
    /** Primary ticker (first in tickers array) */
    ticker: string;
    /** Market identifier */
    market: Market;
    /** Publisher name (Massive: publisher.name) */
    source: string;

    // --- Fields ---
    /** Publication time (Massive: published_utc) */
    time: Date;
    /** Unique news ID (Massive: id) */
    id: string;
    /** Article title */
    title: string;
    /** Article URL (Massive: article_url) */
    url: string;

    // Extended fields
    /** Author name */
    author?: string;
    /** Article description/summary */
    description?: string;
    /** Article image URL (Massive: image_url) */
    imageUrl?: string;
    /** Keywords array (stored as JSON string in InfluxDB) */
    keywords?: string[];
    /** All related tickers (stored as JSON string in InfluxDB) */
    tickers?: string[];

    // Sentiment analysis (from Massive API insights)
    /** Overall sentiment for the primary ticker */
    sentiment?: Sentiment;
    /** Sentiment score (-1 to 1, derived) */
    sentimentScore?: number;
    /** Sentiment reasoning */
    sentimentReasoning?: string;

    // Storage reference
    /** S3 path for full article content */
    s3Path?: string;
}

/**
 * Full news content for S3 storage
 * Includes fetched article content for Agent analysis
 */
export interface NewsContent {
    /** Unique news ID */
    id: string;
    /** Primary ticker */
    ticker: string;
    /** All related tickers */
    tickers: string[];
    /** Article title */
    title: string;
    /** Publisher name */
    source: string;
    /** Article URL */
    url: string;
    /** Publication time */
    publishedAt: string;
    /** Author name */
    author?: string;
    /** Article description/summary */
    description?: string;
    /** Article image URL */
    imageUrl?: string;
    /** Keywords */
    keywords?: string[];
    /** Fetched full article content (HTML or text) */
    content?: string;
    /** Content fetch timestamp */
    fetchedAt?: string;
    /** Sentiment insights per ticker */
    insights?: NewsInsight[];
}

// ============================================================================
// fundamentals - Financial data
// ============================================================================

/**
 * Fundamentals record with comprehensive financial data
 *
 * Data Source: Massive Financials API (/vX/reference/financials)
 *
 * Storage: InfluxDB measurement "fundamentals"
 *
 * Design Notes:
 * - Stores quarterly and annual financial reports
 * - Includes Income Statement, Balance Sheet, Cash Flow Statement
 * - Supports historical comparison and trend analysis
 */
export interface FundamentalsRecord {
    // --- Tags (indexed) ---
    /** Stock ticker symbol */
    ticker: string;
    /** Market identifier */
    market: Market;
    /** Report period type */
    periodType: PeriodType;

    // --- Fields ---
    /** Report end date (Massive: end_date) */
    time: Date;

    // Period identification
    /** Fiscal year (e.g., 2024, 2025) */
    fiscalYear?: number;
    /** Fiscal period (Q1, Q2, Q3, Q4, FY) */
    fiscalPeriod?: string;
    /** SEC filing date */
    filingDate?: Date;

    // Company info
    /** Company name */
    companyName?: string;
    /** SEC CIK number */
    cik?: string;
    /** SIC industry code */
    sic?: string;

    // Income Statement (利润表)
    /** Total revenue (Massive: revenues) */
    revenue?: number;
    /** Cost of revenue (Massive: cost_of_revenue) */
    costOfRevenue?: number;
    /** Gross profit (Massive: gross_profit) */
    grossProfit?: number;
    /** Operating expenses (Massive: operating_expenses) */
    operatingExpenses?: number;
    /** Operating income/loss (Massive: operating_income_loss) */
    operatingIncome?: number;
    /** Net income/loss (Massive: net_income_loss) */
    netIncome?: number;
    /** Basic EPS (Massive: basic_earnings_per_share) */
    eps?: number;
    /** Diluted EPS (Massive: diluted_earnings_per_share) */
    epsDiluted?: number;
    /** Basic average shares */
    sharesBasic?: number;
    /** Diluted average shares */
    sharesDiluted?: number;

    // Balance Sheet (资产负债表)
    /** Total assets (Massive: assets) */
    totalAssets?: number;
    /** Current assets */
    currentAssets?: number;
    /** Total liabilities (Massive: liabilities) */
    totalLiabilities?: number;
    /** Current liabilities */
    currentLiabilities?: number;
    /** Total equity (Massive: equity) */
    totalEquity?: number;
    /** Fixed assets (property, plant, equipment) */
    fixedAssets?: number;
    /** Accounts payable */
    accountsPayable?: number;

    // Cash Flow Statement (现金流量表)
    /** Operating cash flow (Massive: net_cash_flow_from_operating_activities) */
    operatingCashFlow?: number;
    /** Investing cash flow (Massive: net_cash_flow_from_investing_activities) */
    investingCashFlow?: number;
    /** Financing cash flow (Massive: net_cash_flow_from_financing_activities) */
    financingCashFlow?: number;
    /** Net cash flow (Massive: net_cash_flow) */
    netCashFlow?: number;

    // Valuation ratios (derived or external)
    /** Price-to-earnings ratio */
    pe?: number;
    /** Price-to-book ratio */
    pb?: number;
    /** Market capitalization */
    marketCap?: number;
    /** Return on equity */
    roe?: number;
}

// ============================================================================
// Market Status
// ============================================================================

/**
 * Market status from Massive Market Status API
 */
export interface MarketStatus {
    /** Market identifier (e.g., "us") */
    market: string;
    /** Server time */
    serverTime: string;
    /** List of exchanges with their status */
    exchanges: {
        [key: string]: string; // e.g., { "nasdaq": "open", "nyse": "open" }
    };
    /** List of currencies with their status */
    currencies?: {
        [key: string]: string;
    };
}

// ============================================================================
// Watchlist (DynamoDB)
// ============================================================================

/**
 * Watchlist item for user's stock watchlist
 * Storage: DynamoDB via Amplify Data
 */
export interface WatchlistItem {
    /** User ID (partition key) */
    userId: string;
    /** Stock ticker symbol */
    ticker: string;
    /** Stock name */
    name: string;
    /** Market identifier */
    market: Market;
    /** When the stock was added */
    addedAt: Date;
    /** User notes */
    notes?: string;
    /** Price alerts configuration */
    alerts?: {
        priceAbove?: number;
        priceBelow?: number;
        changePercent?: number;
    };
}

// ============================================================================
// Agent Analysis Results
// ============================================================================

/**
 * Agent analysis result
 * Storage: DynamoDB
 */
export interface AgentAnalysis {
    /** Analysis ID (partition key) */
    analysisId: string;
    /** Analysis timestamp */
    timestamp: Date;
    /** Stock ticker */
    ticker: string;
    /** Stock name */
    name: string;
    /** Market */
    market: Market;
    /** Agent type that produced this analysis */
    agentType: 'fundamentals' | 'market' | 'news' | 'social' | 'risk' | 'trader';
    /** Analysis report content */
    report: string;
    /** Confidence score (0-1) */
    confidence: number;
    /** Recommendation details */
    recommendation?: {
        action: 'buy' | 'hold' | 'sell';
        targetPrice?: number;
        stopLoss?: number;
        reasoning: string;
    };
}
