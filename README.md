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
│  for InfluxDB │    │   (Multi-Agent AI)  │    │    (Watchlist/Trades)   │
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
| **Data** | Amazon Timestream for InfluxDB, DynamoDB, S3 |
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
│           └── services/         # Alpaca, Massive, InfluxDB
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
| InfluxDBWriter | Write data to Timestream for InfluxDB |

### Environment Variables

Worker 环境变量通过 Amplify Console 配置，在部署时注入到 Fargate Task。

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `INFLUXDB_ENDPOINT` | ✅ | InfluxDB 实例地址 | - |
| `INFLUXDB_PORT` | | InfluxDB 端口 | `8181` |
| `INFLUXDB_SECRET_ARN` | ✅ | InfluxDB 凭证的 Secrets Manager ARN | - |
| `INFLUXDB_DATABASE` | | 数据库名称 | `market_data` |
| `AWS_REGION` | | AWS 区域 | `us-west-2` |
| `LOG_LEVEL` | | 日志级别 (debug/info/warn/error) | `info` |
| `FETCH_NEWS_CONTENT` | | 抓取新闻正文内容 | `true` |
| `MASSIVE_BASE_URL` | | Massive REST API 地址 | `https://api.massive.com` |
| `MASSIVE_WS_URL` | | Massive 实时 WebSocket 地址 | `wss://socket.massive.com/stocks` |
| `MASSIVE_DELAYED_WS_URL` | | Massive 延迟 WebSocket 地址 | `wss://delayed.massive.com/stocks` |
| `DEFAULT_WATCHLIST` | | 默认监控股票列表 | `AAPL,TSLA,NVDA,AMZN,GOOGL` |
| `HEALTH_CHECK_PORT` | | 健康检查端口 | `8080` |
| `ENABLE_REALTIME` | | 启用实时数据流 | `true` |
| `ENABLE_SCHEDULER` | | 启用定时任务 | `true` |

以下变量由基础设施自动生成，无需手动配置：
- `NODE_ENV` - 固定为 `production`
- `DATA_BUCKET` - S3 存储桶名称
- `API_KEYS_SECRET_ARN` - API 密钥 Secret ARN

敏感信息（API Keys、数据库密码）存储在 AWS Secrets Manager 中：
- `wavepilot/api-keys` - Alpaca/Massive API 密钥
- InfluxDB 凭证 - 由 Timestream for InfluxDB 自动创建

> **Note**: InfluxDB 3 需要通过 AWS Console 手动创建。

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
