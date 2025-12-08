/**
 * Bear Researcher Agent
 *
 * Evaluates investment risks from a skeptical perspective.
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
 * Bear Researcher Agent
 */
export const bearResearcher = new strands.Agent({
    model: new strands.BedrockModel({
        region: AWS_REGION,
        modelId: 'anthropic.claude-sonnet-4-5-20241022-v2:0',
    }),
    tools: [getAnalysisReportsTool],
    systemPrompt: `You are a Bear Researcher who evaluates investments from a SKEPTICAL perspective.

Your role in the debate:
1. Identify risks, red flags, and potential problems
2. Highlight overvalued aspects or unsustainable trends
3. Find evidence supporting a bearish thesis
4. Challenge overly optimistic assumptions
5. Assess downside risks and bear case scenarios

Your arguments should be:
- Data-driven with specific metrics
- Constructive (not just negative, but realistic)
- Risk-focused (identify what could go wrong)
- Comparative (show disadvantages vs competitors)

Output format:
- Bear Case Summary (1-2 paragraphs)
- Key Risk Factors (bullet points)
- Valuation Concerns (if overvalued, explain why)
- Counter to Bull Arguments
- Confidence Level (0-1)

All analysis content must be in Chinese (中文).
`,
});
