---
inclusion: fileMatch
fileMatchPattern: "apps/agents/**/*"
---

# Agent Development Guide

This guide covers Strands Agents SDK patterns for the WavePilotAI multi-agent stock analysis system.

## Required Imports

```typescript
import * as strands from '@strands-agents/sdk';
import { z } from 'zod';
```

## Agent Definition

```typescript
const AWS_REGION = process.env.AWS_REGION || 'us-west-2';

export const agentName = new strands.Agent({
    model: new strands.BedrockModel({
        region: AWS_REGION,
        modelId: 'anthropic.claude-sonnet-4-5-20241022-v2:0',
    }),
    tools: [toolOne, toolTwo],
    systemPrompt: `English prompt content here.

All analysis content must be in Chinese (中文).`,
});
```

## Tool Definition

```typescript
const toolName = strands.tool({
    name: 'snake_case_name',
    description: 'English description for LLM understanding',
    inputSchema: z.object({
        ticker: z.string().describe('Stock ticker symbol'),
        market: z.enum(['US', 'CN', 'HK']).describe('Market identifier'),
    }),
    callback: async (input): Promise<string> => {
        return JSON.stringify({ result: 'data' });
    },
});
```

## Agent Invocation

```typescript
const result = await agent.invoke(prompt);
const output = String(result);
```

## Multi-Agent Orchestration (Graph Pattern)

The system executes 4 sequential phases:

1. **Parallel Analysis**: `fundamentalsAnalyst`, `marketAnalyst`, `newsAnalyst`, `socialAnalyst`
2. **Debate**: `bullResearcher` + `bearResearcher` → `researchManager` synthesizes
3. **Risk**: `riskManager` evaluates findings
4. **Decision**: `trader` outputs BUY/HOLD/SELL

Use `Promise.allSettled()` for parallel execution:
```typescript
const [a, b] = await Promise.allSettled([
    agentA.invoke(prompt),
    agentB.invoke(prompt),
]);
const resultA = a.status === 'fulfilled' ? String(a.value) : '暂无';
```

## System Prompt Requirements

- Write in English for better LLM comprehension
- End with: `All analysis content must be in Chinese (中文).`
- Specify currency: USD ($) for US, CNY (¥) for CN, HKD (HK$) for HK
- Include explicit output format requirements

## Express Server (AgentCore Runtime)

Required endpoints for Bedrock AgentCore:

```typescript
app.get('/ping', (_, res) => {
    res.json({ status: 'Healthy', time_of_last_update: Math.floor(Date.now() / 1000) });
});

app.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
    const rawBody = new TextDecoder().decode(req.body as Buffer);
    const payload = JSON.parse(rawBody);
    // Validate: ticker (required), market (US|CN|HK), depth (quick|standard|deep)
    const report = await analyzeStock(payload);
    return res.json({ report });
});
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| File | kebab-case | `bull-researcher.ts` |
| Export | camelCase | `export const bullResearcher` |
| Tool name | snake_case | `get_analysis_summary` |
| Directory | agents in `src/agents/`, tools in `src/tools/` |

## Error Handling

- Always use `Promise.allSettled()` for parallel agent calls
- Check `status === 'fulfilled'` before accessing `.value`
- Provide Chinese fallback: `'暂无'` for failed 
