/**
 * WavePilotAI Data Ingestion Worker
 *
 * Fargate-based service for:
 * 1. Real-time data ingestion via Alpaca WebSocket (IEX feed)
 * 2. SIP data correction via Massive WebSocket (15m delayed)
 * 3. Scheduled data fetching from Massive API
 * 4. Data correction and aggregation tasks
 *
 * Architecture:
 * - AlpacaWebSocketService: Real-time IEX streaming for watchlist symbols
 * - MassiveWebSocketService: SIP data streaming to correct IEX data
 * - MassiveScheduler: Periodic batch data fetching
 * - InfluxDBWriter: Time-series data storage
 * - NewsService: News metadata + S3 content storage
 */

import 'dotenv/config';
import { AlpacaWebSocketService } from './services/alpaca-websocket.js';
import { MassiveWebSocketService } from './services/massive-websocket.js';
import { MassiveScheduler } from './services/massive-scheduler.js';
import { InfluxDBWriter } from './services/timestream-writer.js';
import { CONFIG } from './config.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('Main');

// ============================================================================
// Health Check Server (for Fargate)
// ============================================================================

async function startHealthCheckServer(
    alpacaWs: AlpacaWebSocketService,
    massiveWs: MassiveWebSocketService,
    massiveScheduler: MassiveScheduler
): Promise<void> {
    const http = await import('http');

    const server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
            const status = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                services: {
                    alpacaWebSocket: {
                        status: alpacaWs.isConnected() ? 'connected' : 'disconnected',
                        subscriptions: alpacaWs.getSubscriptions(),
                    },
                    massiveWebSocket: {
                        status: massiveWs.isConnected() ? 'connected' : 'disconnected',
                        subscriptions: massiveWs.getSubscriptions(),
                    },
                    scheduler: {
                        status: massiveScheduler.isRunning() ? 'running' : 'stopped',
                        watchlist: massiveScheduler.getWatchlist(),
                    },
                },
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status, null, 2));
        } else if (req.url === '/subscriptions' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ subscriptions: alpacaWs.getSubscriptions() }));
        } else if (req.url === '/subscribe' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { symbols } = JSON.parse(body);
                    if (Array.isArray(symbols)) {
                        await alpacaWs.subscribe(symbols);
                        massiveWs.subscribe(symbols);
                        massiveScheduler.addToWatchlist(symbols);
                        // Stage 1 Backfill (async)
                        massiveScheduler.backfillHistory(symbols).catch(console.error);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, subscriptions: alpacaWs.getSubscriptions() }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'symbols must be an array' }));
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
        } else if (req.url === '/unsubscribe' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { symbols } = JSON.parse(body);
                    if (Array.isArray(symbols)) {
                        alpacaWs.unsubscribe(symbols);
                        massiveWs.unsubscribe(symbols);
                        massiveScheduler.removeFromWatchlist(symbols);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, subscriptions: alpacaWs.getSubscriptions() }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'symbols must be an array' }));
                    }
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
            });
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(CONFIG.HEALTH_CHECK_PORT, () => {
        logger.info(`Health check server listening on port ${CONFIG.HEALTH_CHECK_PORT}`);
    });
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
    logger.info('Starting WavePilotAI Data Worker...');
    logger.info('Configuration loaded', { config: CONFIG });

    // Initialize InfluxDB writer
    const influxWriter = new InfluxDBWriter();

    // Initialize services (before health check so they can report status)
    const alpacaWs = new AlpacaWebSocketService(influxWriter);
    const massiveWs = new MassiveWebSocketService(influxWriter);
    const massiveScheduler = new MassiveScheduler(influxWriter);

    // Start health check server FIRST to pass Fargate health checks
    await startHealthCheckServer(alpacaWs, massiveWs, massiveScheduler);
    logger.info('Health check server started, proceeding with initialization...');

    // Now initialize InfluxDB (may take time or fail)
    try {
        await influxWriter.initialize();
    } catch (err) {
        logger.error('Failed to initialize InfluxDB, continuing without it', err as Error);
    }

    // Set initial watchlist
    massiveScheduler.updateWatchlist(CONFIG.DEFAULT_WATCHLIST);

    // Start real-time WebSocket connections
    if (CONFIG.ENABLE_REALTIME) {
        try {
            // Alpaca WS for real-time IEX data
            await alpacaWs.connect();
            await alpacaWs.subscribe(CONFIG.DEFAULT_WATCHLIST);

            // Massive WS for SIP data correction (15m delayed)
            await massiveWs.connect();
            massiveWs.subscribe(CONFIG.DEFAULT_WATCHLIST);
        } catch (err) {
            logger.error('Failed to connect WebSocket, will retry', err as Error);
        }
    } else {
        logger.info('Real-time WebSocket disabled by configuration.');
    }

    // Start scheduled tasks
    if (CONFIG.ENABLE_SCHEDULER) {
        massiveScheduler.start();
    } else {
        logger.info('Scheduler disabled by configuration.');
    }

    logger.info('Worker started successfully');
    logger.info('Watching symbols', { symbols: CONFIG.DEFAULT_WATCHLIST });

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
        logger.info('Shutting down gracefully', { signal });

        // Stop WebSocket connections
        alpacaWs.disconnect();
        massiveWs.disconnect();
        massiveScheduler.stop();

        // Close database connection
        await influxWriter.close();

        logger.info('Shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', error);
        shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled rejection', reason as Error, { promise: String(promise) });
    });
}

// Run the worker
main().catch((err) => {
    logger.error('Fatal error', err);
    process.exit(1);
});
