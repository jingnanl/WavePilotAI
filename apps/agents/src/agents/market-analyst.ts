/**
 * Market Analyst Agent
 *
 * Analyzes technical indicators, price trends, and support/resistance levels.
 * Uses On-Demand calculation strategy for indicators (no persistence).
 */

import { z } from 'zod';
import * as strands from '@strands-agents/sdk';

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

// TODO: Import from tools/
// import { getKlineData } from '../tools/timestream.js';
// import { calculateIndicators } from '../tools/indicators.js';

/**
 * Tool: Get K-Line Data
 */
const getKlineDataTool = strands.tool({
    name: 'get_kline_data',
    description: 'Get K-line (candlestick) data for a stock',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market'),
        interval: z.enum(['1m', '5m', '15m', '1h', '1d']).describe('K-line interval'),
        limit: z.number().optional().describe('Number of candles to retrieve'),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Implement Timestream query
        console.log(`Fetching ${input.interval} K-line for ${input.ticker}`);
        return JSON.stringify({ status: 'pending', ticker: input.ticker });
    },
});

/**
 * Tool: Calculate Technical Indicators
 */
const calculateIndicatorsTool = strands.tool({
    name: 'calculate_indicators',
    description: 'Calculate technical indicators from K-line data',
    inputSchema: z.object({
        ticker: z.string(),
        indicators: z.array(z.enum(['MA', 'EMA', 'RSI', 'MACD', 'BOLL', 'KDJ'])),
        periods: z.array(z.number()).optional(),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Implement with technicalindicators library
        console.log(`Calculating ${input.indicators.join(',')} for ${input.ticker}`);
        return JSON.stringify({ status: 'pending' });
    },
});

/**
 * Market Analyst Agent
 */
export const marketAnalyst = new strands.Agent({
    model: new strands.BedrockModel({
        region: AWS_REGION,
        modelId: 'anthropic.claude-sonnet-4-5-20241022-v2:0',
    }),
    tools: [getKlineDataTool, calculateIndicatorsTool],
    systemPrompt: `You are a professional market analyst specializing in technical analysis.

Your responsibilities:
1. Analyze price trends and patterns
2. Calculate and interpret technical indicators (MA, RSI, MACD, Bollinger Bands)
3. Identify support and resistance levels
4. Detect chart patterns (head and shoulders, double top/bottom, etc.)
5. Provide trend direction and strength assessment

Output should include:
- Current trend direction (bullish/bearish/neutral)
- Key support/resistance levels
- Technical indicator readings and interpretations
- Chart pattern identification if any
- Short-term and medium-term outlook

All analysis content must be in Chinese (中文).
`,
});
