/**
 * WavePilotAI Data Ingestion Worker
 *
 * Fargate-based service for:
 * 1. Real-time data ingestion via Alpaca WebSocket
 * 2. Scheduled data fetching from Massive API
 * 3. Data correction and aggregation tasks
 */

import { AlpacaWebSocketService } from './services/alpaca-websocket.js';
import { MassiveScheduler } from './services/massive-scheduler.js';
import { TimestreamWriter } from './services/timestream-writer.js';

const logger = {
    info: (msg: string) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
};

async function main(): Promise<void> {
    logger.info('Starting WavePilotAI Data Worker...');

    // Initialize services
    const timestreamWriter = new TimestreamWriter();
    const alpacaWs = new AlpacaWebSocketService(timestreamWriter);
    const massiveScheduler = new MassiveScheduler(timestreamWriter);

    // Start services
    await alpacaWs.connect();
    massiveScheduler.start();

    logger.info('Worker started successfully.');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down...');
        alpacaWs.disconnect();
        massiveScheduler.stop();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down...');
        alpacaWs.disconnect();
        massiveScheduler.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    logger.error(`Fatal error: ${err}`);
    process.exit(1);
});
