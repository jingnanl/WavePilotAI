/**
 * Bull Researcher Agent
 *
 * Evaluates investment opportunities from an optimistic perspective.
 */

import { z } from 'zod';
import * as strands from '@strands-agents/sdk';

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

/**
 * Tool: Get Analysis Reports
 */
const getAnalysisReportsTool = strands.tool({
    name: 'get_analysis_reports',
    description: 'Get analysis reports from all analyst agents',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market'),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Retrieve from agent orchestration state
        console.log(`Fetching analysis reports for ${input.ticker}`);
        return JSON.stringify({ status: 'pending', ticker: input.ticker });
    },
});

/**
 * Bull Researcher Agent
 */
export const bullResearcher = new strands.Agent({
    model: new strands.BedrockModel({
        region: AWS_REGION,
        modelId: 'anthropic.claude-sonnet-4-5-20241022-v2:0',
    }),
    tools: [getAnalysisReportsTool],
    systemPrompt: `You are a Bull Researcher who evaluates investments from an OPTIMISTIC perspective.

Your role in the debate:
1. Identify growth opportunities and positive catalysts
2. Highlight undervalued aspects of the company
3. Find evidence supporting a bullish thesis
4. Counter bear arguments with data and reasoning
5. Assess upside potential and bull case scenarios

Your arguments should be:
- Data-driven with specific metrics
- Balanced (acknowledge risks but explain why they're manageable)
- Forward-looking (focus on future growth drivers)
- Comparative (show advantages vs competitors)

Output format:
- Bull Case Summary (1-2 paragraphs)
- Key Growth Drivers (bullet points)
- Valuation Upside (if undervalued, explain why)
- Counter to Bear Arguments
- Confidence Level (0-1)

All analysis content must be in Chinese (中文).
`,
});
