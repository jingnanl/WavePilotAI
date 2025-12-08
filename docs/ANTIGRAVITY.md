# ANTIGRAVITY.md

本文件为 Antigravity (Google Deepmind Agent) 在 WavePilotAI 代码库中工作时提供全面指导。

## 项目概述

WavePilotAI 是一个基于 AWS 云服务和 Claude LLM 的智能股票分析与交易系统。

**核心架构决策 (Hybrid Architecture):**
为了平衡开发效率和实时性能，我们采用 **Hybrid (混合)** 架构：
- **前端与 API**: 使用 **Amplify Gen 2 (Serverless)**。利用 Next.js 和 Lambda 提供易于维护的 Web 界面和 API。
- **数据摄取**: 使用 **AWS Fargate (Serverless Container)**。运行常驻的 TypeScript Worker，维护与 Alpaca 的 WebSocket 长连接，实现毫秒级数据摄取。
- **AI Agents**: 使用 **Strands Agents TypeScript SDK + Bedrock AgentCore**。Agent 代码打包成容器部署到 AgentCore Runtime。
- **数据存储**: **Amazon Timestream** 作为单一事实来源 (Single Source of Truth)。

## 技术栈

### 核心框架
- **Structure**: Polyrepo-style Monorepo (Independent `apps/frontend`, `apps/worker`, `apps/agents`)
- **IaC**: AWS Amplify Gen 2 (基于 CDK) + `@aws-cdk/aws-bedrock-agentcore-alpha`
- **Frontend**: Next.js 15 (App Router), Tailwind CSS, shadcn/ui
- **Backend**: TypeScript (Lambda API, Fargate Worker, AI Agents)
- **AI**: Amazon Bedrock (Claude Sonnet 4.5 / Opus), Strands Agents SDK

### AI Agent 技术栈
- **Agent 开发**: `@strands-agents/sdk` (TypeScript)
- **Agent 部署**: `@aws-cdk/aws-bedrock-agentcore-alpha` (CDK 集成到 Amplify)
- **Agent 调用**: `@aws-sdk/client-bedrock-agentcore` (Runtime SDK)
- **LLM 模型**: Claude Sonnet 4.5 / Opus 4.5 (通过 Amazon Bedrock)

### 数据架构
- **US Real-time (Watchlist)**: **Alpaca (IEX WebSocket)** for high-frequency, real-time data.
- **US Recent History (Last 15m)**: **Alpaca (IEX REST)** to fill the gap caused by Massive's delay.
- **US Whole Market (Intraday)**: **Massive** `Snapshot` API (15m delayed) for broad market overview.
- **US History (SIP)**: **Massive** `Aggregates` API (15m delayed) for accurate historical data.
- **A 股数据**: Akshare -> Fargate (Polling) -> Timestream
- **数据库**:
    - **Amazon Timestream**: 存储 K 线 (Candles), 基本面 (Fundamentals), 新闻元数据 (News Metadata)。
    - **Amazon S3**: 存储新闻正文 (News Content), 财报文档 (Financials)。
    - **DynamoDB**: 用户配置 (Watchlist), 交易记录 (Trades)。

### Agent 参考

Agent 架构设计借鉴 TradingAgents-CN 项目，采用相同的核心概念：

- **多智能体协作**：专业化智能体协同工作
- **结构化辩论机制**：看涨 vs 看跌研究员的平衡分析
- **统一工具架构**：智能路由到最优数据源
- **分层风险评估**：多角度风险管理

**完整 Agent 角色列表**：
| 团队 | 角色 | 职责 |
|------|------|------|
| 分析师 | FundamentalsAnalyst | 财务报表、估值计算 |
| | MarketAnalyst | 技术指标、趋势识别 |
| | NewsAnalyst | 新闻事件影响评估 |
| | SocialAnalyst | 社交媒体情绪分析 |
| 研究员 | BullResearcher | 乐观视角、增长机会 |
| | BearResearcher | 悲观视角、风险识别 |
| | ResearchManager | 协调辩论、形成共识 |
| 风险 | Aggressive/Conservative/Neutral | 三种风险策略评估 |
| | RiskManager | 综合风险评估 |
| 执行 | Trader | 最终决策、买卖建议 |

**参考项目位置**：`/Users/jingnanl/workspace/Stock/TradingAgents-CN`

## 开发工作流

### 1. 基础设施 (Amplify Gen 2 + AgentCore CDK)
所有 AWS 资源定义在 `apps/frontend/amplify/backend.ts`，包括 AgentCore 相关资源。
- **添加 AgentCore**: 使用 `@aws-cdk/aws-bedrock-agentcore-alpha` 在 `backend.ts` 中定义。
- **部署**: `npx amplify push` 一键部署所有资源（包括 AgentCore）

### 2. TypeScript Worker (Fargate)
代码位于 `apps/worker/`。
- 职责：WebSocket 监听, 定时任务 (Cron), 数据清洗与写入 Timestream。

### 3. AI Agent 开发
代码位于 `apps/agents/`。
- 使用 `@strands-agents/sdk` 开发 Agent
- CDK 自动构建 Docker 并部署到 AgentCore Runtime
- 职责：深度分析, 投资辩论, 报告生成。

```bash
# Agent 开发流程
cd apps/agents
npm install
npm run dev     # 本地测试

# 部署（CDK 自动构建 Docker 并推送 ECR）
cd ../frontend
npx amplify push
```

## 关键规则

1.  **文档同步**: 任何架构或需求变更，必须同步更新 `ANTIGRAVITY.md`, `requirements.md`, `design.md`, `tasks.md`, `CLAUDE.md`。
2.  **成本意识**:
    - Massive (Polygon) 成本 $29/mo。
    - Fargate 运行成本 (t4g.nano 或类似)。
    - Timestream 写入与查询成本。
    - Bedrock API 调用成本。
3.  **代码规范**:
    - TypeScript: ESLint + Prettier (全项目统一)
4.  **数据源**:
    - **US Real-time (Watchlist)**: Alpaca (IEX Feed)
    - **US Whole Market**: Massive (Snapshot & SIP)
    - **US History/News**: Massive
    - **CN**: Akshare

## 参考资源

### Agent 开发与部署
- [Strands Agents Documentation](https://strandsagents.com/latest/documentation/docs/)
- [Strands Agents TypeScript SDK](https://github.com/strands-agents/sdk-typescript)
- [Strands Agents + Bedrock AgentCore Deploy Guide](https://strandsagents.com/latest/documentation/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/)
- [CDK for Bedrock AgentCore](https://github.com/aws/aws-cdk/tree/main/packages/%40aws-cdk/aws-bedrock-agentcore-alpha)
- [SDK for Bedrock AgentCore](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agentcore/)
- [Bedrock AgentCore User Guide](https://aws.github.io/bedrock-agentcore-starter-toolkit/index.html)
- [Bedrock AgentCore Samples](https://github.com/awslabs/amazon-bedrock-agentcore-samples/tree/main)

### 数据源
- [Massive Documentation](https://massive.com/docs)
- [Alpaca API Docs](https://alpaca.markets/docs/)

### AWS 服务
- [Amplify Gen 2 Docs](https://docs.amplify.aws/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)

### 前端
- [Next.js Documentation](https://nextjs.org/docs)
- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/)

### 参考项目
- **TradingAgents-CN**（`/Users/jingnanl/workspace/Stock/TradingAgents-CN`）

---

*本文档版本：1.0*
*更新日期：2025-12-06*
*作者：JN.L*
