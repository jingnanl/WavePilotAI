/**
 * Stock Analysis Orchestrator
 *
 * Coordinates the multi-agent analysis workflow following the Graph Pattern:
 * 1. Parallel Analysis: FundamentalsAnalyst, MarketAnalyst, NewsAnalyst, SocialAnalyst
 * 2. Debate: BullResearcher vs BearResearcher → ResearchManager
 * 3. Risk Assessment: RiskManager
 * 4. Final Decision: Trader
 */

import { fundamentalsAnalyst } from './agents/fundamentals-analyst.js';
import { marketAnalyst } from './agents/market-analyst.js';
import { newsAnalyst } from './agents/news-analyst.js';
import { socialAnalyst } from './agents/social-analyst.js';
import { bullResearcher } from './agents/bull-researcher.js';
import { bearResearcher } from './agents/bear-researcher.js';
import { researchManager } from './agents/research-manager.js';
import { riskManager } from './agents/risk-manager.js';
import { trader } from './agents/trader.js';

export interface AnalysisRequest {
    ticker: string;
    market: 'US' | 'CN' | 'HK';
    depth?: 'quick' | 'standard' | 'deep';
}

export interface AnalysisReport {
    ticker: string;
    market: string;
    timestamp: string;
    analysts: {
        fundamentals?: string;
        market?: string;
        news?: string;
        social?: string;
    };
    debate: {
        bullCase?: string;
        bearCase?: string;
        consensus?: string;
    };
    risk: {
        assessment?: string;
        score?: number;
    };
    decision: {
        recommendation?: 'BUY' | 'HOLD' | 'SELL';
        targetPrice?: number;
        confidence?: number;
        reasoning?: string;
    };
}

/**
 * Execute parallel analysis with all analyst agents
 */
async function runParallelAnalysis(
    ticker: string,
    market: string
): Promise<AnalysisReport['analysts']> {
    console.log(`[Orchestrator] Starting parallel analysis for ${ticker}`);

    const prompt = `分析股票 ${ticker} (${market} 市场)，提供详细的分析报告。`;

    // Run all analysts in parallel
    const [fundamentals, technical, news, social] = await Promise.allSettled([
        fundamentalsAnalyst.invoke(prompt),
        marketAnalyst.invoke(prompt),
        newsAnalyst.invoke(prompt),
        socialAnalyst.invoke(prompt),
    ]);

    return {
        fundamentals: fundamentals.status === 'fulfilled' ? String(fundamentals.value) : undefined,
        market: technical.status === 'fulfilled' ? String(technical.value) : undefined,
        news: news.status === 'fulfilled' ? String(news.value) : undefined,
        social: social.status === 'fulfilled' ? String(social.value) : undefined,
    };
}

/**
 * Execute the debate between Bull and Bear researchers
 */
async function runDebate(
    ticker: string,
    analystsReports: AnalysisReport['analysts']
): Promise<AnalysisReport['debate']> {
    console.log(`[Orchestrator] Starting Bull vs Bear debate for ${ticker}`);

    const context = `
基于以下分析师报告，请从你的角度（看涨/看跌）评估 ${ticker}：

基本面分析：${analystsReports.fundamentals || '暂无'}
技术分析：${analystsReports.market || '暂无'}
新闻分析：${analystsReports.news || '暂无'}
社交情绪：${analystsReports.social || '暂无'}
`;

    // Run Bull and Bear in parallel
    const [bullCase, bearCase] = await Promise.allSettled([
        bullResearcher.invoke(context),
        bearResearcher.invoke(context),
    ]);

    // ResearchManager synthesizes the debate
    const debateContext = `
请综合以下多空双方的观点，形成研究共识：

看涨观点：${bullCase.status === 'fulfilled' ? String(bullCase.value) : '暂无'}
看跌观点：${bearCase.status === 'fulfilled' ? String(bearCase.value) : '暂无'}
`;

    const consensus = await researchManager.invoke(debateContext);

    return {
        bullCase: bullCase.status === 'fulfilled' ? String(bullCase.value) : undefined,
        bearCase: bearCase.status === 'fulfilled' ? String(bearCase.value) : undefined,
        consensus: String(consensus),
    };
}

/**
 * Execute risk assessment
 */
async function runRiskAssessment(
    ticker: string,
    debateResult: AnalysisReport['debate']
): Promise<AnalysisReport['risk']> {
    console.log(`[Orchestrator] Running risk assessment for ${ticker}`);

    const context = `
请对 ${ticker} 进行风险评估，基于以下研究共识：

${debateResult.consensus || '暂无共识'}
`;

    const assessment = await riskManager.invoke(context);

    return {
        assessment: String(assessment),
        score: 0.5, // TODO: Parse from assessment
    };
}

/**
 * Execute final trading decision
 */
async function runTradingDecision(
    ticker: string,
    analystsReports: AnalysisReport['analysts'],
    debateResult: AnalysisReport['debate'],
    riskResult: AnalysisReport['risk']
): Promise<AnalysisReport['decision']> {
    console.log(`[Orchestrator] Making final trading decision for ${ticker}`);

    const context = `
请综合以下所有信息，为 ${ticker} 做出最终投资决策：

=== 分析师报告 ===
基本面：${analystsReports.fundamentals || '暂无'}
技术面：${analystsReports.market || '暂无'}
新闻：${analystsReports.news || '暂无'}
社交：${analystsReports.social || '暂无'}

=== 研究共识 ===
${debateResult.consensus || '暂无'}

=== 风险评估 ===
${riskResult.assessment || '暂无'}
风险分数：${riskResult.score || '未知'}
`;

    const decision = await trader.invoke(context);

    return {
        recommendation: 'HOLD', // TODO: Parse from decision
        confidence: 0.7, // TODO: Parse from decision
        reasoning: String(decision),
    };
}

/**
 * Main orchestration function
 * Coordinates the full analysis workflow
 */
export async function analyzeStock(request: AnalysisRequest): Promise<AnalysisReport> {
    const { ticker, market, depth = 'standard' } = request;

    console.log(`[Orchestrator] Starting ${depth} analysis for ${ticker} (${market})`);
    const startTime = Date.now();

    const report: AnalysisReport = {
        ticker,
        market,
        timestamp: new Date().toISOString(),
        analysts: {},
        debate: {},
        risk: {},
        decision: {},
    };

    try {
        // Phase 1: Parallel Analysis
        report.analysts = await runParallelAnalysis(ticker, market);

        // Phase 2: Debate (skip for 'quick' depth)
        if (depth !== 'quick') {
            report.debate = await runDebate(ticker, report.analysts);
        }

        // Phase 3: Risk Assessment
        report.risk = await runRiskAssessment(ticker, report.debate);

        // Phase 4: Trading Decision
        report.decision = await runTradingDecision(
            ticker,
            report.analysts,
            report.debate,
            report.risk
        );

        const duration = Date.now() - startTime;
        console.log(`[Orchestrator] Analysis completed in ${duration}ms`);

    } catch (error) {
        console.error(`[Orchestrator] Analysis failed:`, error);
        throw error;
    }

    return report;
}
