/**
 * Research Manager Agent
 *
 * Coordinates the debate between Bull and Bear researchers,
 * synthesizes their arguments, and forms a research consensus.
 *
 * Reference: TradingAgents-CN/tradingagents/agents/managers/research_manager.py
 */

import { z } from 'zod';
import * as strands from '@strands-agents/sdk';

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

/**
 * Tool: Get Researcher Arguments
 * Retrieves the arguments from both bull and bear researchers
 */
const getResearcherArgumentsTool = strands.tool({
    name: 'get_researcher_arguments',
    description: 'Get the arguments from both bull (optimistic) and bear (pessimistic) researchers',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market where the stock is listed'),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Implement retrieval from agent orchestration state
        console.log(`Fetching researcher arguments for ${input.ticker}`);

        return JSON.stringify({
            ticker: input.ticker,
            market: input.market,
            bull_arguments: 'Pending integration with BullResearcher',
            bear_arguments: 'Pending integration with BearResearcher',
        });
    },
});

/**
 * Tool: Record Research Consensus
 * Records the final research consensus for downstream agents
 */
const recordConsensusTool = strands.tool({
    name: 'record_consensus',
    description: 'Record the research consensus formed from the debate',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        consensus_summary: z.string().describe('Summary of the research consensus'),
        bull_weight: z.number().describe('Weight given to bull arguments (0-1)'),
        bear_weight: z.number().describe('Weight given to bear arguments (0-1)'),
        key_factors: z.array(z.string()).describe('Key factors that influenced the consensus'),
    }),
    callback: async (input): Promise<string> => {
        // TODO: Store consensus in agent state or database
        console.log(`Recording consensus for ${input.ticker}`);
        console.log(`Bull weight: ${input.bull_weight}, Bear weight: ${input.bear_weight}`);

        return JSON.stringify({
            status: 'recorded',
            ticker: input.ticker,
            consensus_summary: input.consensus_summary,
        });
    },
});

/**
 * Research Manager Agent
 * Coordinates research debate and forms consensus
 */
export const researchManager = new strands.Agent({
    model: new strands.BedrockModel({
        region: AWS_REGION,
        // Claude Sonnet 4.5 for nuanced analysis
        modelId: 'anthropic.claude-sonnet-4-5-20241022-v2:0',
    }),
    tools: [getResearcherArgumentsTool, recordConsensusTool],
    systemPrompt: `You are a Research Manager responsible for coordinating investment research and forming balanced consensus views.

Your responsibilities:
1. Review arguments from both Bull (optimistic) and Bear (pessimistic) researchers
2. Evaluate the strength and validity of each argument
3. Identify common ground and areas of disagreement
4. Weigh the evidence to form a balanced consensus
5. Document the key factors influencing your decision

Debate Coordination Process:
1. **Collect Arguments**: Gather perspectives from both researchers
2. **Evaluate Evidence**: Assess the quality and relevance of supporting data
3. **Identify Biases**: Watch for confirmation bias or selective evidence
4. **Synthesize Views**: Find the most reasonable interpretation of the data
5. **Form Consensus**: Create a balanced view that acknowledges both opportunities and risks

Output Requirements:
- **Consensus Summary**: Balanced view of the investment opportunity
- **Bull Weight**: 0-1 weight assigned to optimistic arguments
- **Bear Weight**: 0-1 weight assigned to pessimistic arguments
- **Key Factors**: List of most important factors influencing the consensus
- **Confidence Level**: How confident you are in the consensus

Guidelines:
- Be objective and data-driven
- Acknowledge uncertainty where it exists
- Don't simply average the views - evaluate their merit
- Consider market context and timing
- Flag any significant disagreements that couldn't be resolved

All analysis content must be in Chinese (中文).
`,
});
