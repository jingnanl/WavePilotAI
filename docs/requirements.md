# WavePilotAI 项目需求文档

## 📋 项目概述

WavePilotAI 是一个基于 AWS 云服务和 Claude 大语言模型的智能股票分析与交易系统。系统采用多智能体协作架构，通过专业化分工实现全面的市场分析、投资建议和模拟交易功能。

### 核心价值
- **智能分析**：利用多个专业 AI Agent 进行深度市场分析
- **实时决策**：支持盘中实时数据获取和分析
- **风险管理**：多层次风险评估确保投资决策稳健性
- **模拟交易**：提供完整的模拟盘功能验证投资策略

## 🎯 功能需求

### 1. 数据获取与处理

#### 1.1 定时任务系统
- **触发机制**：Fargate Worker 内置 Cron Scheduler（node-cron 或类似库）
- **开发语言**：TypeScript（全栈统一）
- **执行频率**：
  - **美股实时 (Watchlist)**：实时流式获取（Alpaca WebSocket）
  - **美股全市场 (Intraday)**：每 5 分钟快照（Massive API）
  - **美股盘后 (EOD)**：每日收盘后获取 SIP 官方数据进行修正（Massive API）
  - **美股新闻**：每 15 分钟轮询（Massive API）
  - **A 股市场**：每 5 分钟轮询（Akshare）
  - **财务数据**：每日收盘后更新

- **智能市场状态判断**：
  - 自动检测美股和 A 股的交易时间
  - 非交易时间自动跳过数据获取
  - 考虑节假日和特殊交易日

#### 1.2 数据源集成

**美股数据**
- **Alpaca API**：实时行情（WebSocket）
  - 免费 IEX 数据源
  - 实时 K 线推送
  - 由 Fargate Worker 统一接入

- **Massive (formerly Polygon)**：历史/全市场数据（$29/mo）
  - **Intraday**: `Snapshot - All Tickers` (全市场快照，15分钟延迟)
  - **History**: `Aggregates` (SIP 历史数据，15分钟延迟)
  - **Post-Market**: `Grouped Daily` (官方 SIP 合并数据，用于修正历史)
  - **News**: 实时/历史新闻 API

> **成本优化策略**: 由于 Massive $29 套餐有 15分钟延迟，我们将使用 **Alpaca (IEX)** 填补最近 15 分钟的数据空缺，实现低成本的"伪全量"实时体验。

**A 股数据**（第二期）
- **AKShare**：`stock_zh_a_spot_em()`（一次性获取所有 A 股）
- **Tushare**（备选）：需要积分，数据更全面
- **财联社/新浪财经**：新闻数据
- **雪球/东方财富**：社交媒体情绪

#### 1.3 数据验证与处理
- 数据完整性检查
- 异常值处理
- 数据格式标准化
- 失败重试机制（指数退避）

### 2. 数据存储架构

#### 2.1 时序数据存储 (Amazon Timestream for InfluxDB)
> **说明**：使用 AWS 托管的 InfluxDB 3 服务，通过 AWS Console 手动创建实例。

- **Candles**: 价格数据 (1m, 1h)
- **Fundamentals**: 每日基本面指标 (PE, EPS, MarketCap)
  - 用于 Agent 进行历史估值对比分析
- **NewsEvents**: 新闻元数据 (Ticker, Title, Sentiment, URL)
  - 用于事件驱动分析

#### 2.2 对象存储 (S3)
- **NewsContent**: 新闻完整正文
  - 用于 Agent 深度阅读 (RAG)
- **Financials**: 完整财报文档
- **Knowledge Base**: 向量化知识库源文件

#### 2.3 数据分区策略
- 美股和 A 股数据分开存储
- 按股票代码和时间戳分区
- 支持高效的时间范围查询

### 3. 多智能体分析系统

#### 3.1 技术框架

**SDK 选型决策**

经过对比 Claude Agent SDK、Vercel AI SDK、Amazon Strands Agents SDK 三种方案，选择 **Strands Agents 统一后端 + AI SDK 前端渲染** 的混合架构：

| SDK | 角色 | 理由 |
|-----|------|------|
| **Strands Agents** | 后端 Agent 系统（核心） | 原生支持多 Agent 编排（Graph Pattern）、托管部署（AgentCore）、Memory 管理、AWS 深度集成 |
| **Vercel AI SDK** | 前端流式渲染（辅助） | `useChat` hook 简化对话 UI 开发，仅做渲染层，不定义 tools |
| ~~Claude SDK~~ | 不采用 | 无多 Agent 编排、无托管部署、与 AWS 集成弱 |

**核心技术栈**
- **Agent 开发**：`@strands-agents/sdk` (TypeScript SDK)
- **Agent 部署**：`@aws-cdk/aws-bedrock-agentcore-alpha` (CDK L2 构造，Experimental)
  - `AgentRuntimeArtifact.fromAsset()` - 从本地 Dockerfile 构建
  - `Runtime` - AgentCore Runtime 资源
  - `Memory` - AgentCore Memory 资源（支持 STM + LTM）
- **Agent 调用**：`@aws-sdk/client-bedrock-agentcore` (Runtime SDK)
- **前端渲染**：`ai` (Vercel AI SDK) - 仅用于流式 UI 渲染
- **协作模式**：Graph Pattern（支持条件分支和复杂流程）
- **部署平台**：Amazon Bedrock AgentCore Runtime
- **LLM 模型**：Claude Sonnet 4.5 / Opus 4.5

**架构原则**
- **Tools 统一定义**：所有工具（查询 InfluxDB、获取新闻等）在 Strands Agents 中实现，用户对话和深度分析共享同一套 tools
- **AI 逻辑集中**：前端不做任何 AI 逻辑，仅透传 AgentCore API 响应并渲染
- **单一 Agent 代码库**：避免维护两套 Agent 实现

#### 3.2 Agent 团队架构

**分析师团队（并行执行）**
- **基本面分析师（Fundamentals Analyst）**
  - 分析公司财务数据
  - 计算估值指标（PE、PB、ROE 等）
  - 行业对比分析

- **市场分析师（Market Analyst）**
  - **技术指标计算**：
    - 基础指标：MA, EMA, RSI, MACD, BOLL, VWAP
  - 价格趋势识别
  - 支撑阻力位分析
  - **缠论特征 (Chanlun Features)**（第三阶段）：详见后续迭代计划

- **新闻分析师（News Analyst）**
  - 实时新闻监控
  - 事件影响评估
  - 宏观经济分析

- **社交媒体分析师（Social Media Analyst）**
  - Reddit/Twitter 情绪分析
  - 投资者关注度追踪
  - 市场热点识别

**研究员团队（顺序辩论）**
- **看涨研究员（Bull Researcher）**
  - 从乐观角度评估投资机会
  - 识别积极催化剂

- **看跌研究员（Bear Researcher）**
  - 从悲观角度评估投资风险
  - 识别潜在风险因素

**交易执行**
- **交易员（Trader）**
  - 综合各方信息
  - 制定交易决策
  - 生成具体买卖建议

**风险管理**
- **激进风险评估**：高风险高收益策略评估
- **保守风险评估**：低风险稳健策略评估
- **中性风险评估**：平衡风险收益评估

**管理层**
- **研究经理**：协调研究员辩论，形成研究共识
- **风险经理**：综合风险评估，制定风险限额

#### 3.3 Agent 工具集成
- 封装 Lambda 函数作为 Agent 工具
- 从 Timestream 获取实时数据
- 工具调用日志记录

### 4. 用户界面

#### 4.1 技术栈
- **框架**：Next.js 15 (App Router with Turbopack)
- **部署**：AWS Amplify Gen 2（自动 CI/CD，环境管理）
- **UI 组件**：shadcn/ui
- **图表库**：TradingView Lightweight Charts
- **状态管理**：Zustand / TanStack Query
- **样式**：Tailwind CSS
- **AI 对话 UI**：Vercel AI SDK (`useChat` hook) - 仅用于流式渲染，调用后端 AgentCore API

#### 4.2 核心功能模块

**股票行情展示**
- K 线图（支持多周期：1 分钟、5 分钟、15 分钟、1 小时、日线、周线、月线等）
- 分时图
- 技术指标叠加（MA 均线）
- 副图指标（成交量、MACD、RSI）
- 使用 TradingView 组件实现

**股票分析功能**
- 选择分析深度（快速/标准/深度）
- 实时分析进度展示
- 流式输出分析结果
- 支持 K 线级别和分时级别分析

**对话交互**
- 与 AI Agent 对话查询股票信息（通过 Strands Chat Agent）
- Agent 可调用 tools 获取实时数据（InfluxDB）
- 历史对话记录
- 上下文理解能力（AgentCore Memory）

**自选股管理**
- 添加/删除自选股
- 实时价格更新
- 盘中监控和提醒

#### 4.3 响应式设计
- 桌面端优先
- 移动端适配
- 深色/浅色主题切换

### 5. 实时数据推送

#### 5.1 技术方案
- **核心技术**：AWS AppSync + GraphQL Subscription
- **推送内容**：
  - 自选股 1 分钟级价格更新
  - 全市场 5 分钟级价格更新
  - 新闻数据 60 分钟级更新
  - Agent 分析进度和结果

#### 5.2 AppSync 优势
- 自动连接管理和断线重连
- 内置扩展性，无连接数限制
- 离线支持和数据同步
- 简化开发，无需手动管理 WebSocket

### 6. 模拟盘功能

#### 6.1 基础功能
- 初始资金设置（默认 20 万）
- 买入/卖出操作
- 实时持仓显示
- 盈亏计算

#### 6.2 交易验证
- 可用资金检查
- 持仓数量验证
- 交易时间限制
- 最小交易单位

#### 6.3 记录与统计
- 交易历史记录
- 收益率曲线
- 持仓分析
- 业绩归因

### 7. 知识库集成

#### 7.1 Bedrock Knowledge Base
- **数据源**：S3 存储的历史数据
- **向量化**：自动文档切分和嵌入
- **检索增强**：RAG 模式提升回答准确性

#### 7.2 Agent Memory
- **Memory 方案**：Amazon Bedrock AgentCore Memory（托管服务）
- **Short-term Memory**：会话内上下文保持
  - 理解用户引用和对话流
  - 支持复杂多轮分析对话
- **Long-term Memory**：跨会话持久化
  - 自动学习用户偏好（风险偏好、关注股票、分析深度）
  - 存储历史分析结果和用户反馈
  - 改进决策质量和个性化体验
- **多用户支持**：自动 memory 隔离和管理
- **集成方式**：通过 AgentCore Runtime 原生集成

## 🔧 非功能需求

### 1. 性能要求
- 页面加载时间 < 3 秒
- API 响应时间 < 2 秒
- 实时数据延迟 < 1 秒（AppSync Subscription）
- 预留多用户支持

### 2. 可靠性要求
- 系统可用性 > 99.9%
- 数据备份策略
- 故障自动恢复

### 3. 安全要求
- **认证授权**：AWS Cognito with MFA
- **API 密钥管理**：AWS Secrets Manager
- **数据加密**：传输加密（TLS）、存储加密（KMS）
- **访问控制**：IAM 角色和策略

### 4. 可扩展性
- 支持水平扩展
- 预留 A 股市场扩展接口
- 模块化架构设计
- 插件式 Agent 扩展

### 5. 监控与日志
- **应用日志**：CloudWatch Logs
- **错误追踪**：结构化错误日志
- **性能监控**：CloudWatch Metrics
- **成本监控**：AWS Cost Explorer

## 🚀 部署需求

### 1. 基础设施
- **IaC 工具**：AWS CDK（TypeScript）+ Amplify Gen 2
- **项目管理**：Polyrepo-style Monorepo

### 2. 前端部署
- **平台**：AWS Amplify Gen 2
  - 基于 CDK，可扩展
  - 自动 CI/CD（GitHub 集成）
  - 自动配置 CloudFront + S3

### 3. 后端部署
- **Lambda 函数**：API 服务（Serverless）
- **Fargate 容器**：数据摄取 Worker（Serverless Container）
  - 运行 TypeScript 脚本
  - 维护 WebSocket 长连接
  - 执行定时任务
- **Agent 部署**：使用 CDK 部署到 Bedrock AgentCore Runtime
  - 容器化部署
  - 自动会话隔离
  - 企业级内存管理
- **API 网关**：
  - AppSync（GraphQL + Subscriptions）
  - API Gateway（REST API）

### 4. CI/CD
- **代码仓库**：GitHub
- **前端构建**：Amplify Gen 2 自动 CI/CD
- **后端部署**：Amplify Gen 2 统一部署所有资源（含 AgentCore）
- **自动化测试**：单元测试、集成测试

## 📊 成本优化建议

### 1. LLM 调用优化
- **快速任务**：使用 Claude Sonnet 4.5
- **标准分析**：使用 Claude Sonnet 4.5
- **深度分析**：使用 Claude Opus 4.5
- **缓存策略**：相同查询结果缓存

### 2. 数据存储优化
- InfluxDB 自动数据保留策略

### 3. 计算资源优化
- Lambda 按需计费
- 预置并发（关键函数）
- 自动扩缩容
- 仅在交易时间内高频更新数据

### 4. 数据获取优化
  - 实时数据使用 Alpaca WebSocket（高效）
  - 历史数据使用 Massive（批量）
  - 内存缓存：Fargate Worker 内部缓存热点数据

## 🗓️ 项目阶段

### 第一阶段（MVP）
- 美股市场数据获取和存储（Alpaca + Massive）
- 混合架构搭建（Amplify + Fargate）
- 基础多 Agent 分析系统（Strands Agents TypeScript + AgentCore CDK）
- Web 界面核心功能（Next.js + Amplify Gen 2）
- 实时数据推送（AppSync Subscription）
- 简单模拟盘
- 单用户系统

### 第二阶段
- A 股市场支持（AKShare）
- 高级分析功能
- 多用户支持（Cognito）
- 交易策略回测

### 第三阶段
- 移动端应用
- 高级风险管理
- 自定义 Agent
- 期权期货支持
- **缠论特征分析 (Chanlun Features)**：
  - K 线包含关系处理 (Inclusion Handling)
  - 分型与笔识别 (Fractals & Strokes)
  - 中枢区间计算 (Center Range)
  - MACD 面积与背驰因子 (Divergence Factor)
  - 买卖点识别与趋势判断

## 📝 技术约束

### 1. 编程语言
- **全栈**：TypeScript（前端、后端、Agents）
- **IaC**：TypeScript（CDK）

### 2. 开发工具
- ESLint/Prettier 代码规范
- Git 版本控制
- npm 包管理

## 🎯 成功标准

1. **功能完整性**：实现所有核心功能
2. **用户体验**：界面流畅、响应快速
3. **分析质量**：Agent 分析结果准确、有价值
4. **系统稳定性**：无重大故障、数据准确
5. **成本可控**：月度运营成本在预算内（< $500）

## 📚 参考资源

### 核心技术文档
- [Strands Agents TypeScript SDK](https://github.com/strands-agents/sdk-typescript)
- [CDK for Bedrock AgentCore](https://github.com/aws/aws-cdk/tree/main/packages/%40aws-cdk/aws-bedrock-agentcore-alpha)
- [SDK for Bedrock AgentCore](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agentcore/)
- [Strands Agents + Bedrock AgentCore Deploy Guide](https://strandsagents.com/latest/documentation/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [AWS Amplify Gen 2 Documentation](https://docs.amplify.aws/react/)
- [Vercel AI SDK](https://sdk.vercel.ai/docs) - 前端流式 UI 渲染

### 数据源
- [Massive Documentation](https://massive.com/docs)
- [Alpaca API Docs](https://alpaca.markets/docs/)

### 其他资源
- [Next.js Documentation](https://nextjs.org/docs)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/)

### 参考项目
- **TradingAgents-CN**（`/Users/jingnanl/workspace/Stock/TradingAgents-CN`）
  - 多智能体协作架构参考
  - 使用 Strands Agents 实现（TypeScript 版本）

---

*本文档版本：1.0*
*更新日期：2025-12-31*
*作者：JN.L*
