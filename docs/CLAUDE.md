# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在 WavePilotAI 代码库中工作时提供全面指导，包括项目规范、开发准则和维护一致性的重要规则。

## 项目概述

WavePilotAI 是一个基于 AWS 云服务和 Claude LLM 的智能股票分析与交易系统。系统采用多智能体协作架构，通过专业化分工实现全面的市场分析、投资建议和模拟交易功能。

## 核心使命

构建生产级 AI 驱动的股票交易平台：
- 通过 AWS Bedrock 发挥 Claude 的高级推理能力
- 使用 Bedrock AgentCore + Strands Agents 实现多智能体协作
- 优先支持美股，扩展支持 A 股的实时市场分析
- 交付机构级投资研究和风险管理

## 参考架构

系统架构设计借鉴 TradingAgents-CN 项目，该项目成功使用 LangGraph 实现多智能体股票分析。我们采用相同的核心概念，但使用 Strands Agents：

- **多智能体协作**：专业化智能体协同工作
- **结构化辩论机制**：看涨 vs 看跌研究员的平衡分析
- **统一工具架构**：智能路由到最优数据源
- **分层风险评估**：多角度风险管理

**参考项目位置**：`/Users/jingnanl/workspace/Stock/TradingAgents-CN`

## 技术栈

### 智能体框架 (All TypeScript)
- **Agent 开发**: `@strands-agents/sdk` (TypeScript SDK)
- **Agent 部署**: `@aws-cdk/aws-bedrock-agentcore-alpha` (CDK 集成到 Amplify)
- **Agent 调用**: `@aws-sdk/client-bedrock-agentcore` (Runtime SDK)
- **LLM 模型**：Claude Sonnet 4.5 / Opus 4.5（通过 Amazon Bedrock）
- **部署平台**：AWS Bedrock AgentCore Runtime

### 统一架构 (Amplify Gen 2)
- **核心理念**：前后端通过 Amplify Gen 2 统一管理，所有 AWS 资源通过 `apps/frontend/amplify/backend.ts` 管理
- **基础设施定义**：`amplify/backend.ts` 包含所有 AWS 资源（基于 CDK），包括 AgentCore
- **部署方式**：`npx amplify push` 一键部署所有资源

### 后端服务
- **计算**：AWS Lambda + Fargate（在 Amplify 中定义）
- **API 层**：AWS AppSync（GraphQL + Subscriptions）用于实时推送
- **数据存储**：Timestream for InfluxDB、S3、DynamoDB（通过 CDK 在 Amplify 中定义）

### 前端技术
- **框架**：Next.js 15 with App Router
- **部署**：Amplify Hosting（Git 集成自动 CI/CD）
- **UI 组件**：shadcn/ui 实现一致设计
- **图表**：TradingView Lightweight Charts
- **样式**：Tailwind CSS

### 数据架构
- **时序数据**：Amazon Timestream for InfluxDB 存储市场数据
- **文档存储**：S3 存储报告和分析文档，使用单一 S3 存储桶，通过文件夹前缀组织数据（raw/, processed/, knowledge-base/）
- **应用数据**：DynamoDB 存储用户数据和配置
- **知识库**：Bedrock Knowledge Base 用于历史分析

### 基础设施即代码
- **项目管理**：Polyrepo-style Monorepo
- **IaC**：Amplify Gen 2（内置 CDK，统一管理前后端
- **监控**：CloudWatch + Amplify Console
- **安全**：AWS KMS 加密，Secrets Manager 管理 API 密钥

## 多智能体系统设计

### 智能体团队（借鉴 TradingAgents-CN）

#### 1. 分析师团队（并行执行）
- **基本面分析师（FundamentalsAnalyst）**：财务报表、估值指标、DCF 建模
- **市场分析师（MarketAnalyst）**：技术指标、价格模式、成交量分析
- **新闻分析师（NewsAnalyst）**：实时新闻处理、事件影响评估
- **社交媒体分析师（SocialMediaAnalyst）**：Reddit、Twitter 情绪分析（美股），微博情绪分析（A 股）

#### 2. 研究团队（顺序辩论）
- **看涨研究员（BullResearcher）**：乐观视角、增长机会
- **看跌研究员（BearResearcher）**：悲观观点、风险识别
- **研究经理（ResearchManager）**：综合辩论、形成共识

#### 3. 执行团队
- **风险评估（RiskAssessment）**：多层风险评价（激进/保守/中性）
- **风险经理（RiskManager）**：投资组合级风险管理
- **交易员（Trader）**：基于所有输入做出最终投资决策

### Strands Agents 实现模式

使用 **Graph Pattern** 实现复杂的分析流程：
- 支持条件分支和循环
- 支持并行执行（分析师团队同时工作）
- 支持顺序执行（研究员辩论按顺序进行）
- 通过 CDK 集成部署到 AgentCore Runtime

详细实现参考 TradingAgents-CN 项目中的多智能体协作模式，使用 Strands Agents

## 项目结构

```
wavepilot/
├── apps/
│   ├── frontend/                      # Next.js + Amplify Gen 2 统一应用
│   │   ├── amplify/                   # Amplify Gen 2 后端（所有 AWS 资源）
│   │   │   ├── backend.ts             # 统一的资源定义（含 AgentCore CDK）
│   │   │   ├── auth/
│   │   │   │   └── resource.ts        # Cognito 认证配置
│   │   │   ├── data/
│   │   │   │   └── resource.ts        # AppSync GraphQL API
│   │   │   └── functions/             # Lambda 函数
│   │   │       ├── data-fetcher/      # 数据获取
│   │   │       ├── trigger-analysis/  # 触发 AI 分析
│   │   │       └── get-historical/    # 历史数据查询
│   │   ├── app/                       # Next.js App Router
│   │   ├── components/                # React 组件
│   │   ├── lib/                       # 工具函数
│   │   ├── amplify.yml                # CI/CD 配置
│   │   └── package.json
│   │
│   ├── worker/                        # TypeScript Fargate Worker (数据摄取)
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │
│   └── agents/                        # Strands Agents TypeScript 实现
│       ├── package.json               # Node.js 项目配置
│       ├── tsconfig.json              # TypeScript 配置
│       ├── Dockerfile                 # AgentCore 容器
│       ├── src/
│       │   ├── index.ts               # Express 服务器入口
│       │   ├── agents/                # Agent 定义
│       │   │   ├── fundamentals-analyst.ts
│       │   │   ├── market-analyst.ts
│       │   │   ├── news-analyst.ts
│       │   │   └── trader.ts
│       │   └── tools/                 # Agent 工具
│       │       ├── stock-data.ts
│       │       └── financial-data.ts
│       └── README.md
│
└── docs/                             # 项目文档
    ├── CLAUDE.md                     # 本文件
    ├── ANTIGRAVITY.md                # Antigravity 指导
    ├── requirements.md               # 需求规范
    ├── design.md                     # 系统设计
    └── tasks.md                      # 任务清单
```

## 开发工作流

### 初始设置

```bash
# 创建项目目录
mkdir -p wavepilot/apps
cd wavepilot

# 初始化前端和 Amplify Gen 2
cd apps/frontend
npm install
npx amplify init

# 初始化智能体项目
cd ../agents
npm install

# 部署所有资源（前端 + 后端 + AgentCore）
cd ../frontend
npx amplify push  # 一个命令部署所有 AWS 资源
```

### 智能体开发

```bash
# 进入智能体目录
cd apps/agents

# 安装依赖
npm install

# 本地测试 Agent
npm run dev

# 部署（CDK 使用 fromAsset 自动构建 Docker 并推送 ECR）
cd ../frontend
npx amplify push
```

### 前端开发

```bash
# 启动 Amplify 沙箱环境（本地开发）
cd apps/frontend
npx amplify sandbox

# 启动 Next.js 开发服务器
npm run dev

# 部署到云端
npx amplify push

# 或配置 Git 自动部署
git push  # Amplify Hosting 自动构建和部署
```

## 数据管理

### 数据源配置

#### 美股市场（优先支持）
- **自选股实时数据**：Alpaca WebSocket (IEX Feed, Real-time)
- **全市场数据**：Massive API (Snapshot, 15m Delayed)
- **历史数据**：Massive API (SIP, 15m Delayed)
- **近端补缺**：Alpaca API (IEX, Last 15m)
- **新闻**：Massive API (Real-time/History)

#### A 股市场（扩展支持）
- **主要数据源**：AKShare `stock_zh_a_spot_em()`（一次性获取所有 A 股）
- **备用数据源**：通达信 API
- **社交媒体**：微博 API
- **新闻**：财联社、新浪财经

### 数据流架构

```
外部 APIs ──WebSocket──→ Fargate Worker ──→ InfluxDB ──→ AppSync → 前端
          ──REST/定时──→ Fargate Worker        ↓              ↓
                              ↓           S3（归档）   Subscription
                              └─────────────────↓
                                      Bedrock Knowledge Base

前端 ──Query/Mutation──→ AppSync ──→ Lambda (API) ──→ InfluxDB/S3
```

> **说明**：Fargate Worker 负责所有数据摄取（WebSocket 长连接 + 内置 Cron 定时任务），Lambda 仅处理前端 API 请求。

### 数据存储策略
- **热数据**（当天分时数据）：InfluxDB 内存存储，7 天保留
- **温数据**（历史 K 线）：InfluxDB 磁盘存储，10 年保留
- **冷数据**（财务新闻）：S3 → Bedrock Knowledge Base

### 实时数据推送
- **技术方案**：AWS AppSync + GraphQL Subscription
- **自选股**：通过 Subscription 推送 1 分钟级数据（交易时间内）
- **全市场**：5 分钟级数据定时更新（交易时间内）
- **新闻事件**：15 分钟轮询，通过 Subscription 推送

**AppSync 优势**：
- 自动连接管理和断线重连
- 内置扩展性，无连接数限制
- 离线支持和数据同步
- 简化开发，无需手动管理 WebSocket

### 数据更新频率
- **自选股**：1 分钟（交易时间内，Alpaca WebSocket）
- **全市场**：5 分钟（交易时间内，Massive Snapshot，15m 延迟）
- **财务数据**：每日收盘后更新
- **新闻数据**：每小时/实时（Massive API），通过 AppSync 推送

## 安全实现

### API 密钥管理
所有 API 密钥存储在 AWS Secrets Manager：
- Alpaca API Key
- Massive API Key
- Reddit API Credentials
- 其他第三方服务密钥

### 认证与授权
- **用户认证**：AWS Cognito with MFA
- **API 认证**：AppSync + Cognito 授权器
- **智能体认证**：IAM 角色 + STS assume role
- **数据加密**：KMS 静态和传输加密

## 性能优化

### Lambda 优化
- 使用 Lambda Layers 共享依赖
- 设置适当内存（智能体最少 1024MB）
- 关键函数使用预置并发
- 实现连接池复用

### 前端优化
- 动态导入实现代码分割
- React.memo 优化昂贵组件
- react-window 虚拟化长列表
- Tree shaking 优化包大小

### InfluxDB 查询优化
- 设计合适的tags（ticker, market, interval）
- 使用 `bin()` 函数进行时间窗口聚合
- 使用 `LIMIT` 限制查询结果
- 批量 API 请求

## 重要规则与指令

### 1. 文档同步规则 ⚠️

**关键**：当任何需求变更时，必须更新所有相关文档：
- `CLAUDE.md` - 本文件，AI 的工作指导
- `ANTIGRAVITY.md` - Antigravity 的工作指导
- `requirements.md` - 详细需求规范
- `design.md` - 系统架构设计
- `tasks.md` - 开发任务清单

### 2. 文档更新哲学

更新文档时要像从头创建文档一样写作。文档应该显得连贯完整，不显示增量更新的痕迹。在所有章节中保持语调、结构和技术深度的一致性。

### 3. 参考资源使用

TradingAgents-CN 项目作为我们的架构参考。实现相似功能时：
- 研究 `/Users/jingnanl/workspace/Stock/TradingAgents-CN` 中的实现
- 调整模式以适配 AWS 服务和 Claude 模型
- 使用 Strands Agents TypeScript SDK
- 专注于 Claude 特定优化而非多模型支持

### 4. 智能体开发原则

- 每个智能体应有单一、明确定义的职责
- 智能体通过结构化接口通信
- 充分利用 Claude 的推理能力
- 实现适当的错误处理和回退机制
- 记录所有决策用于审计和改进
- 使用 CDK 集成部署到 AgentCore Runtime

### 5. 成本管理

- 实现 token 计数
- 积极使用缓存减少 API 调用
- 优化数据获取频率，仅在交易时间内高频更新

### 6. 市场支持优先级

- **第一阶段**：完整实现美股分析和交易功能
  - Alpaca 自选股实时数据
  - Massive 全市场数据
  - Massive 新闻分析

- **第二阶段**：扩展支持 A 股市场
  - AKShare A 股数据
  - 微博情绪分析
  - 财经新闻集成

- **暂不支持**：港股、期货、期权等其他金融产品
- **多用户支持**：架构设计中考虑，但当前版本不实现

### 7. 语言规范

**用户界面语言**：
- **前端界面**：全部使用中文
- **用户交互文本**：中文（按钮、提示、错误消息等）
- **分析报告输出**：中文

**Agent Prompt 语言**：
- **System Prompt**：使用英文（LLM 理解更准确，推理更稳定）
- **Tool 描述和文档**：使用英文（便于调试和日志分析）
- **输出要求**：在 prompt 中明确要求 Agent 用中文输出报告
- **示例**：`"All analysis content must be in Chinese (中文)"`

**代码注释和文档**：
- **代码注释**：英文（便于国际化协作）
- **项目文档**：中文（CLAUDE.md, requirements.md 等）
- **README**：英文为主，关键说明可双语

### 8. 代码规范

- **TypeScript**：使用 ESLint + Prettier，严格模式
- **命名规范**：
  - 组件：PascalCase（`MarketAnalyst`）
  - 函数：camelCase（`fetchStockData`）
  - 常量：UPPER_SNAKE_CASE（`MAX_RETRIES`）
- **提交信息**：遵循 Conventional Commits 规范

### 9. 测试要求

- Lambda 函数必须有单元测试
- 关键业务逻辑必须有集成测试
- 智能体工具必须有 mock 测试
- 重要的前端组件快照测试（非必需）

### 10. Claude Code 开发/调试指导

- 部署资源到AWS时，使用本地AWS **default** profile，并部署到 us-west-2 region
- 使用 Chrome DevTools MCP tool 调试 UI

## 开发最佳实践

### 智能体提示工程
- 在提示中具体和结构化
- 在系统提示中提供清晰示例
- 对结构化数据使用 XML 标签
- 实施提示版本控制
- 参考 TradingAgents-CN 中的提示词设计

### 状态管理
- 使用 DynamoDB 进行智能体状态持久化
- 为并发更新实现乐观锁
- 定期清理陈旧状态
- 为迁移实现状态架构版本化

### 错误处理
- 所有外部 API 调用必须有重试机制
- 使用指数退避策略
- 记录详细的错误上下文
- 实现优雅降级

## 监控与可观测性

### 关键指标
- **系统**：Lambda 执行时间、错误率、冷启动
- **业务**：分析完成时间、智能体决策质量
- **成本**：API 调用次数、计算使用量、数据传输

### 告警配置
- API 错误率 > 5%
- Lambda 超时 > 10 次/小时
- 数据获取失败 > 3 次连续

## 未来增强

### 计划功能
1. **完善 A 股支持**：扩展 A 股数据源和分析功能
2. **高级智能体**：期权分析师、宏观经济学家、量化分析师
3. **回测引擎**：历史策略验证
4. **投资组合优化**：Markowitz 优化、风险平价
5. **移动应用**：iOS/Android React Native 应用
6. **多资产支持**：港股、商品、外汇、加密货币（长期规划）

### 研究领域
- 强化学习改进智能体决策
- 图神经网络预测市场关联
- 自然语言报告生成
- 多源实时情绪分析

## 支持与资源

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
  - 多智能体协作架构参考
  - 看涨/看跌辩论机制
  - 统一工具架构设计

## 常见问题

### Q: 为什么选择 TypeScript 而不是 Python 来开发 Agents？
**A**:
1. **统一语言**：前端、后端、Agents 全部使用 TypeScript，减少上下文切换
2. **CDK 集成**：AgentCore CDK 构造可以直接集成到 Amplify backend.ts
3. **简化部署**：无需管理 Python 虚拟环境和依赖
4. **更好的类型安全**：TypeScript 静态类型检查

### Q: 为什么选择 AppSync 而不是 API Gateway WebSocket？
**A**: AppSync 提供自动连接管理、内置扩展性、离线支持，与 Amplify 深度集成，大幅简化实时数据推送的开发和运维。

### Q: 如何控制成本？
**A**:
1. 仅在交易时间内高频更新数据
2. 使用不同 Claude 模型（Haiku < Sonnet < Opus）
3. 实施积极的缓存策略
4. 设置计费告警和请求限流

## 许可证

本项目基于 MIT 许可证授权。详情请见 LICENSE 文件。

---

*本文档版本：1.0*
*更新日期：2025-12-07*
*作者：JN.L*
