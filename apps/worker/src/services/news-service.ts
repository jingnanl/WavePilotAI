import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { InfluxDBWriter, NewsRecord } from './timestream-writer';

const DATA_BUCKET = process.env.DATA_BUCKET || '';

export interface NewsContent {
    ticker: string;
    title: string;
    source: string;
    url: string;
    time: Date;
    summary?: string;
    content?: string;
    author?: string;
    tags?: string[];
    sentiment?: number;
}

export class NewsService {
    private s3Client: S3Client;
    private influxWriter: InfluxDBWriter;

    constructor(influxWriter: InfluxDBWriter) {
        this.s3Client = new S3Client({});
        this.influxWriter = influxWriter;
        console.log('[NewsService] Created.');
    }

    /**
     * Save news to S3 (full content) and InfluxDB (metadata)
     */
    async saveNews(newsItems: NewsContent[]): Promise<void> {
        if (newsItems.length === 0) return;

        console.log(`[NewsService] Processing ${newsItems.length} news items...`);

        const influxRecords: NewsRecord[] = [];

        for (const item of newsItems) {
            try {
                // 1. Generate S3 Key
                // Format: raw/news/${ticker}/${date}/${ticker}_${timestamp}.json
                const dateStr = item.time.toISOString().split('T')[0]; // YYYY-MM-DD
                const timestamp = item.time.getTime();
                const cleanTicker = item.ticker.replace(/[^a-zA-Z0-9]/g, ''); // Ensure safe filename
                const s3Key = `raw/news/${cleanTicker}/${dateStr}/${cleanTicker}_${timestamp}.json`;

                // 2. Upload to S3
                await this.s3Client.send(new PutObjectCommand({
                    Bucket: DATA_BUCKET,
                    Key: s3Key,
                    Body: JSON.stringify(item),
                    ContentType: 'application/json'
                }));

                // 3. Prepare InfluxDB Record
                influxRecords.push({
                    time: item.time,
                    ticker: item.ticker,
                    market: 'US', // TODO: Make dynamic if needed, defaulting to US for now
                    title: item.title,
                    source: item.source,
                    url: item.url,
                    sentiment: item.sentiment,
                    s3Path: s3Key
                });

            } catch (error) {
                console.error(`[NewsService] Failed to upload news to S3 for ${item.ticker}:`, error);
                // Continue to next item even if one fails
            }
        }

        // 4. Batch write to InfluxDB
        if (influxRecords.length > 0) {
            await this.influxWriter.writeNews(influxRecords);
        }
    }
}
