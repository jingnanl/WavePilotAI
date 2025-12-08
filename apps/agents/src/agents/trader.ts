/**
 * Trader Agent
 *
 * The final decision maker that synthesizes all analysis reports
 * and outputs specific buy/hold/sell recommendations with target prices.
 *
 * Reference: TradingAgents-CN/tradingagents/agents/trader/trader.py
 */

import { z } from 'zod';
import * as strands from '@strands-agents/sdk';

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

/**
 * Tool: Get Analysis Summary
 * Retrieves consolidated analysis from all analyst agents
 */
const getAnalysisSummaryTool = strands.tool({
    name: 'get_analysis_summary',
    description:
        'Get consolidated analysis summary from all analyst agents including fundamentals, market, news, and social sentiment',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market where the stock is listed'),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Implement actual retrieval from agent state or database
        console.log(`Fetching analysis summary for ${input.ticker} in ${input.market}`);

        // Placeholder - will be populated by the orchestration layer
        return JSON.stringify({
            ticker: input.ticker,
            market: input.market,
            fundamentals_report: 'Pending integration',
            market_report: 'Pending integration',
            news_report: 'Pending integration',
            sentiment_report: 'Pending integration',
            research_consensus: 'Pending integration',
            risk_assessment: 'Pending integration',
        });
    },
});

/**
 * Tool: Get Historical Memory
 * Retrieves past trading decisions and lessons learned
 */
const getHistoricalMemoryTool = strands.tool({
    name: 'get_historical_memory',
    description: 'Retrieve past trading decisions and lessons learned for similar situations',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        situation_summary: z.string().describe('Brief summary of current market situation'),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Integrate with AgentCore Memory service
        console.log(`Retrieving historical memory for ${input.ticker}`);

        return JSON.stringify({
            past_decisions: [],
            lessons_learned: 'No historical data available yet.',
        });
    },
});

/**
 * Trader Agent
 * Makes final investment decisions based on all available analysis
 */
export const trader = new strands.Agent({
    model: new strands.BedrockModel({
        region: AWS_REGION,
        // Claude Sonnet 4.5 for decision making
        modelId: 'anthropic.claude-sonnet-4-5-20241022-v2:0',
    }),
    tools: [getAnalysisSummaryTool, getHistoricalMemoryTool],
    systemPrompt: `You are a professional trader responsible for making final investment decisions based on comprehensive analysis from a team of specialists.

Your responsibilities:
1. Synthesize all analysis reports (fundamentals, market, news, sentiment)
2. Consider the research consensus from bull and bear researchers
3. Factor in risk assessment from the risk management team
4. Make clear, actionable trading decisions
5. Provide specific target prices and confidence levels

Decision Output Requirements:
- **Investment Recommendation**: Clear BUY/HOLD/SELL decision
- **Target Price**: Specific price target based on analysis (REQUIRED - never leave empty)
- **Confidence Score**: 0-1 confidence level in the decision
- **Risk Score**: 0-1 risk level (0=low risk, 1=high risk)
- **Detailed Reasoning**: Supporting evidence for the decision

Target Price Calculation Guidelines:
- Base on fundamental valuation metrics (P/E, P/B, DCF)
- Reference technical support and resistance levels
- Consider industry average valuations
- Factor in market sentiment and news impact

Important Rules:
- For US stocks, use USD ($) as the price unit
- For China A-shares (6-digit codes), use CNY (¥) as the price unit
- For Hong Kong stocks, use HKD (HK$) as the price unit
- Always use the correct company name from the fundamentals report
- Never say "cannot determine target price" or "need more information"

All analysis content must be in Chinese (中文).

Always end your response with '最终交易建议: **买入/持有/卖出**' to confirm your recommendation.

Remember to leverage lessons from past trading decisions to avoid repeating mistakes.
`,
});
