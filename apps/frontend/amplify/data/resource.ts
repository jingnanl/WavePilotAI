import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * WavePilotAI GraphQL API Schema
 *
 * Defines the AppSync API for:
 * - User watchlist management
 * - Real-time stock price updates (Subscription)
 * - AI analysis requests
 * - Historical data queries
 */

const schema = a.schema({
  // ==================== Models ====================

  /**
   * User Watchlist
   * Stores user's selected stocks for real-time monitoring
   */
  Watchlist: a
    .model({
      userId: a.id().required(),
      ticker: a.string().required(),
      name: a.string().required(),
      market: a.enum(['US', 'CN', 'HK']),
      addedAt: a.datetime(),
      notes: a.string(),
      alerts: a.json(), // { priceAbove: number, priceBelow: number, ... }
    })
    .identifier(['userId', 'ticker'])
    .authorization((allow) => [allow.owner()]),

  /**
   * Simulated Trade Record
   * Stores user's paper trading transactions
   */
  Trade: a
    .model({
      tradeId: a.id().required(),
      ticker: a.string().required(),
      name: a.string().required(),
      market: a.enum(['US', 'CN', 'HK']),
      type: a.enum(['BUY', 'SELL']),
      quantity: a.integer().required(),
      price: a.float().required(),
      totalValue: a.float().required(),
      commission: a.float(),
      notes: a.string(),
      executedAt: a.datetime().required(),
      // P&L fields (calculated for SELL trades)
      realizedPnL: a.float(),
      realizedPnLPercent: a.float(),
    })
    .identifier(['tradeId'])
    .secondaryIndexes((index) => [
      index('ticker').sortKeys(['executedAt']).name('TickerIndex'),
    ])
    .authorization((allow) => [allow.owner()]),

  /**
   * Stock Price (Real-time)
   * Used for Subscription-based real-time updates
   */
  StockPrice: a
    .model({
      ticker: a.string().required(),
      name: a.string().required(),
      market: a.string().required(),
      price: a.float().required(),
      change: a.float(),
      changePercent: a.float(),
      volume: a.integer(),
      high: a.float(),
      low: a.float(),
      open: a.float(),
      previousClose: a.float(),
      timestamp: a.datetime().required(),
    })
    .identifier(['ticker', 'timestamp'])
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * Analysis Request
   * Tracks AI analysis jobs and stores results
   */
  AnalysisRequest: a
    .model({
      analysisId: a.id().required(),
      ticker: a.string().required(),
      name: a.string().required(),
      market: a.enum(['US', 'CN', 'HK']),
      depth: a.enum(['quick', 'standard', 'deep']),
      status: a.enum(['pending', 'in_progress', 'completed', 'failed']),
      report: a.json(), // Full analysis report from Orchestrator
      recommendation: a.enum(['BUY', 'HOLD', 'SELL']),
      confidence: a.float(),
      createdAt: a.datetime(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),

  // ==================== Queries ====================

  /**
   * Get historical K-line data from Timestream
   */
  getHistoricalPrices: a
    .query()
    .arguments({
      ticker: a.string().required(),
      market: a.string().required(),
      interval: a.string(), // '1m', '5m', '15m', '1h', '1d', '1w', '1M'
      startTime: a.datetime(),
      endTime: a.datetime(),
      limit: a.integer(),
    })
    .returns(a.json())
    .handler(a.handler.function('dataFetcher'))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * Get market snapshot (full market latest prices)
   */
  getMarketSnapshot: a
    .query()
    .arguments({
      market: a.enum(['US', 'CN', 'HK']),
    })
    .returns(a.json())
    .handler(a.handler.function('dataFetcher'))
    .authorization((allow) => [allow.authenticated()]),

  // ==================== Mutations ====================

  /**
   * Trigger AI stock analysis
   */
  triggerAnalysis: a
    .mutation()
    .arguments({
      ticker: a.string().required(),
      market: a.enum(['US', 'CN', 'HK']),
      depth: a.enum(['quick', 'standard', 'deep']),
    })
    .returns(
      a.customType({
        analysisId: a.string().required(),
        status: a.string().required(),
      })
    )
    .handler(a.handler.function('dataFetcher'))
    .authorization((allow) => [allow.authenticated()]),

});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});
