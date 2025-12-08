/**
 * WavePilotAI Agent Service Entry Point
 *
 * This Express server exposes the required endpoints for Bedrock AgentCore Runtime:
 * - GET /ping - Health check endpoint
 * - POST /invocations - Agent invocation endpoint (uses Orchestrator)
 */

import express from 'express';
import { analyzeStock, type AnalysisRequest } from './orchestrator.js';

const PORT = process.env.PORT || 8080;
const app = express();

/**
 * Health check endpoint (REQUIRED by AgentCore Runtime)
 * Returns the health status of the service
 */
app.get('/ping', (_, res) => {
    res.json({
        status: 'Healthy',
        time_of_last_update: Math.floor(Date.now() / 1000),
    });
});

/**
 * Agent invocation endpoint (REQUIRED by AgentCore Runtime)
 * Receives stock analysis requests and returns comprehensive analysis report
 *
 * Request body:
 * {
 *   "ticker": "AAPL",
 *   "market": "US",
 *   "depth": "standard"  // optional: "quick" | "standard" | "deep"
 * }
 */
app.post('/invocations', express.raw({ type: '*/*' }), async (req, res) => {
    try {
        // Decode binary payload from AWS SDK
        const rawBody = new TextDecoder().decode(req.body as Buffer);
        const payload = JSON.parse(rawBody);

        const { ticker, market = 'US', depth = 'standard' } = payload;

        if (!ticker) {
            return res.status(400).json({
                error: 'Missing required field: ticker',
            });
        }

        // Validate market
        if (!['US', 'CN', 'HK'].includes(market)) {
            return res.status(400).json({
                error: 'Invalid market. Must be one of: US, CN, HK',
            });
        }

        // Validate depth
        if (!['quick', 'standard', 'deep'].includes(depth)) {
            return res.status(400).json({
                error: 'Invalid depth. Must be one of: quick, standard, deep',
            });
        }

        console.log(`[Server] Received analysis request: ${ticker} (${market}) - ${depth}`);

        // Run the full orchestrated analysis
        const request: AnalysisRequest = { ticker, market, depth };
        const report = await analyzeStock(request);

        return res.json({ report });

    } catch (err) {
        console.error('[Server] Error processing request:', err);
        return res.status(500).json({
            error: 'Internal server error',
            message: err instanceof Error ? err.message : 'Unknown error',
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 WavePilotAI AgentCore Runtime server listening on port ${PORT}`);
    console.log(`📍 Endpoints:`);
    console.log(`   POST http://0.0.0.0:${PORT}/invocations`);
    console.log(`   GET  http://0.0.0.0:${PORT}/ping`);
    console.log(`\n📊 Request format:`);
    console.log(`   { "ticker": "AAPL", "market": "US", "depth": "standard" }`);
});
