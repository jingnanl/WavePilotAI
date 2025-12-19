# WavePilotAI 项目上下文

## 项目概述

WavePilotAI 是一个基于 AWS 云服务和 Claude LLM 的智能股票分析与交易系统，采用多智能体协作架构。

## 核心技术栈

- **全栈语言**: TypeScript
- **前端**: Next.js 15 + Amplify Gen 2 + shadcn/ui + TradingView Charts
- **后端**: Lambda (API) + Fargate (Worker) + AppSync (GraphQL)
- **AI Agent**: Strands Agents TypeScript SDK + Bedrock AgentCore
- **数据库**: Amazon Timestream for InfluxDB + DynamoDB + S3
- **IaC**: Amplify Gen 2 (基于 CDK)

## 项目结构

```
wavepilot/
├── packages/
│   └── shared/       # 共享类型 (@wavepilot/shared)
├── apps/
│   ├── frontend/     # Next.js + Amplify Gen 2
│   ├── worker/       # Fargate Worker (数据摄取)
│   └── agents/       # Strands Agents (AI 分析)
├── docs/             # 项目文档
└── package.json      # npm workspaces 根配置
```

> 使用 npm workspaces 管理 monorepo，所有 app 通过 Amplify Gen 2 统一部署。

## 关键文档引用

开发时请参考以下文档：
- #[[file:docs/requirements.md]] - 详细需求规范
- #[[file:docs/design.md]] - 系统架构设计
- #[[file:docs/tasks.md]] - 开发任务清单

## 开发规范

### 语言规范
- **前端界面**: 中文
- **Agent System Prompt**: 英文（输出要求中文）
- **代码注释**: 英文
- **项目文档**: 中文

### 代码规范
- TypeScript 严格模式
- ESLint + Prettier
- 组件命名: PascalCase
- 函数命名: camelCase
- 常量命名: UPPER_SNAKE_CASE

### 部署规范
- AWS Region: us-west-2
- AWS Profile: default
- 部署命令: `npx amplify push`
