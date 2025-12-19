---
inclusion: fileMatch
fileMatchPattern: "apps/worker/**/*"
---

# Worker 开发指南

## 职责
Fargate Worker 负责所有数据摄取任务：
- WebSocket 长连接（Alpaca 实时数据）
- 定时任务（Massive API、Akshare 轮询）
- 数据写入 InfluxDB

## 数据源

### 美股
- **实时 (Watchlist)**: Alpaca WebSocket (IEX Feed)
- **全市场快照**: Massive Snapshot API (15m 延迟)
- **历史数据**: Massive Aggregates API (SIP)
- **新闻**: Massive News API

### A 股（第二期）
- **数据源**: AKShare `stock_zh_a_spot_em()`

## 数据拼接策略

三段式拼接填补 Massive 15 分钟延迟：
1. **远端历史**: Massive SIP (< Now-15m)
2. **近端补缺**: Alpaca REST (Now-15m ~ Now)
3. **实时流**: Alpaca WebSocket (> Now)

## InfluxDB 表结构
- `stock_quotes_raw` - 1 分钟原始数据
- `stock_quotes_aggregated` - 日线聚合数据
- `fundamentals` - 基本面数据
- `news` - 新闻元数据
