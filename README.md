# WavePilotAI

> Ride the Waves, Shape Your Gains — An AI-Powered Engine for Insightful Market Analysis & Trading

## Overview

WavePilotAI is an intelligent stock analysis and trading system built on AWS cloud services and Claude LLM. The system uses a multi-agent collaboration architecture to provide comprehensive market analysis, investment recommendations, and simulated trading capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Frontend                                    │
│                     Next.js + TradingView Charts                         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                         AWS AppSync (GraphQL)                            │
│               Query / Mutation / Subscription                            │
└───────┬───────────────────────┬─────────────────────────────┬───────────┘
        │                       │                             │
┌───────▼───────┐    ┌──────────▼──────────┐    ┌─────────────▼───────────┐
│   Timestream  │    │   Bedrock AgentCore │    │         DynamoDB        │
│  (K-Line Data)│    │   (Multi-Agent AI)  │    │    (Watchlist/Trades)   │
└───────────────┘    └─────────────────────┘    └─────────────────────────┘
        ▲
        │
┌───────┴───────────────────────────────────────────────────────────────┐
│                    Fargate Worker (Data Ingestion)                     │
│              Alpaca WebSocket + Massive API Integration                │
└───────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14+ (App Router), shadcn/ui, TradingView Lightweight Charts |
| **API** | AWS AppSync (GraphQL + Subscriptions) |
| **AI Agents** | Strands Agents SDK (TypeScript) + Bedrock AgentCore |
| **Data** | Amazon Timestream, DynamoDB, S3 |
| **Compute** | AWS Lambda (API), Fargate (Data Worker) |
| **Deploy** | AWS Amplify Gen 2 (unified CDK deployment) |

## Project Structure

```
wavepilot/
├── apps/
│   ├── frontend/              # Next.js + Amplify Gen 2
│   │   ├── amplify/           # AWS resources (CDK-based)
│   │   │   ├── backend.ts     # All infrastructure definitions
│   │   │   ├── auth/          # Cognito configuration
│   │   │   ├── data/          # AppSync GraphQL schema
│   │   │   └── functions/     # Lambda handlers
│   │   └── app/               # Next.js App Router
│   │
│   ├── agents/                # Strands Agents (TypeScript)
│   │   └── src/
│   │       ├── orchestrator.ts   # Multi-agent workflow
│   │       ├── agents/           # 9 specialized agents
│   │       └── tools/            # Shared agent tools
│   │
│   └── worker/                # Fargate data worker (TypeScript)
│       └── src/
│           ├── index.ts          # Entry point
│           └── services/         # Alpaca, Massive, Timestream
│
└── docs/                      # Project documentation
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- AWS CLI configured with credentials
- Amplify CLI (`npm install -g @aws-amplify/cli`)

### Frontend

```bash
cd apps/frontend
npm install
npm run dev
```

### Agents

```bash
cd apps/agents
npm install
npm run dev
```

### Worker

```bash
cd apps/worker
npm install
npm run dev
```

### Deploy to AWS

```bash
cd apps/frontend
npx amplify push
```

---

## Agents Module

### Agent Workflow

```
                    ┌─────────────────┐
                    │   /invocations  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Orchestrator   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   Fundamentals         Market              News/Social (Parallel)
        └────────────────────┼────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   BullResearcher    ResearchManager     BearResearcher (Debate)
                             │
                     ┌───────▼───────┐
                     │ RiskManager   │
                     └───────┬───────┘
                             │
                     ┌───────▼───────┐
                     │    Trader     │
                     └───────────────┘
```

### Agent Roles

| Agent | Role |
|-------|------|
| FundamentalsAnalyst | 财务分析、估值计算 |
| MarketAnalyst | 技术指标、趋势识别 |
| NewsAnalyst | 新闻事件影响评估 |
| SocialAnalyst | 社交媒体情绪分析 |
| BullResearcher | 看涨视角研究 |
| BearResearcher | 看跌视角研究 |
| ResearchManager | 协调辩论、形成共识 |
| RiskManager | 综合风险评估 |
| Trader | 最终投资决策 |

### Agent API

```bash
curl -X POST http://localhost:8080/invocations \
  -d '{"ticker": "AAPL", "market": "US", "depth": "standard"}'
```

---

## Worker Module

### Services

| Service | Description |
|---------|-------------|
| AlpacaWebSocketService | Real-time 1m bar (watchlist stocks) |
| MassiveScheduler | 5m snapshot, EOD correction, news |
| TimestreamWriter | Write data to Timestream |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `AWS_REGION` | AWS region |
| `TIMESTREAM_DATABASE` | Timestream database name |
| `ALPACA_API_KEY` | Alpaca API key |
| `MASSIVE_API_KEY` | Massive API key |

---

## Documentation

- [Requirements](docs/requirements.md) - Requirements specification
- [Design](docs/design.md) - System architecture and design
- [Tasks](docs/tasks.md) - Development roadmap

---

## License

MIT License - See [LICENSE](LICENSE) file for details.

---

*WavePilotAI v1.0 Development*
