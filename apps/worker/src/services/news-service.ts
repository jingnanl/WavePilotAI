/**
 * News Service
 *
 * Handles news data storage:
 * - InfluxDB: metadata for time-series queries
 * - S3: full article content for Agent analysis
 *
 * S3 Object Structure:
 * - Body: Full article content (JSON with metadata + fetched content)
 * - Metadata: Key news attributes for quick access without downloading body
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { InfluxDBWriter } from './timestream-writer';
import type { NewsRecord, NewsContent } from '@wavepilot/shared';

const DATA_BUCKET = process.env.DATA_BUCKET || '';
const FETCH_CONTENT = process.env.FETCH_NEWS_CONTENT === 'true';

export class NewsService {
    private s3Client: S3Client;
    private influxWriter: InfluxDBWriter;

    constructor(influxWriter: InfluxDBWriter) {
        this.s3Client = new S3Client({});
        this.influxWriter = influxWriter;
        console.log('[NewsService] Created.');
    }

    /**
     * Sanitize string for S3 metadata (ASCII only, max 2KB)
     */
    private sanitizeForMetadata(value: string): string {
        // Remove non-ASCII characters and limit length
        return value.replace(/[^\x20-\x7E]/g, '').substring(0, 200);
    }

    /**
     * Fetch article content from URL
     * Returns HTML content or null if fetch fails
     */
    private async fetchArticleContent(url: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; WavePilotAI/1.0; +https://wavepilot.ai)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            });

            clearTimeout(timeout);

            if (!response.ok) {
                console.warn(`[NewsService] Failed to fetch ${url}: ${response.status}`);
                return null;
            }

            const content = await response.text();
            // Limit content size to 500KB
            return content.length > 500000 ? content.substring(0, 500000) : content;
        } catch (error) {
            console.warn(`[NewsService] Error fetching ${url}:`, error);
            return null;
        }
    }

    /**
     * Save news to S3 (full content) and InfluxDB (metadata)
     *
     * @param newsItems - Array of news records from Massive API
     * @param fetchContent - Whether to fetch full article content (default: from env)
     */
    async saveNews(newsItems: NewsRecord[], fetchContent: boolean = FETCH_CONTENT): Promise<void> {
        if (newsItems.length === 0) return;

        console.log(`[NewsService] Processing ${newsItems.length} news items (fetchContent: ${fetchContent})...`);

        const influxRecords: NewsRecord[] = [];

        for (const item of newsItems) {
            try {
                // Generate S3 Key
                // Format: raw/news/${ticker}/${date}/${id}.json
                const dateStr = item.time.toISOString().split('T')[0];
                const s3Key = `raw/news/${item.ticker}/${dateStr}/${item.id}.json`;

                // Prepare S3 content
                const s3Content: NewsContent = {
                    id: item.id,
                    ticker: item.ticker,
                    tickers: item.tickers || [item.ticker],
                    title: item.title,
                    source: item.source,
                    url: item.url,
                    publishedAt: item.time.toISOString(),
                    author: item.author,
                    description: item.description,
                    imageUrl: item.imageUrl,
                    keywords: item.keywords,
                    insights: item.sentiment ? [{
                        ticker: item.ticker,
                        sentiment: item.sentiment,
                        sentimentReasoning: item.sentimentReasoning || '',
                    }] : undefined,
                };

                // Optionally fetch full article content
                if (fetchContent) {
                    const content = await this.fetchArticleContent(item.url);
                    if (content) {
                        s3Content.content = content;
                        s3Content.fetchedAt = new Date().toISOString();
                    }
                }

                // Upload to S3 with metadata in object tags
                // Note: S3 metadata only supports ASCII, so we sanitize values
                await this.s3Client.send(new PutObjectCommand({
                    Bucket: DATA_BUCKET,
                    Key: s3Key,
                    Body: JSON.stringify(s3Content, null, 2),
                    ContentType: 'application/json',
                    // Store key metadata in S3 object metadata for quick access
                    // Title is excluded as it may contain non-ASCII characters
                    Metadata: {
                        'news-id': item.id,
                        'ticker': item.ticker,
                        'source': this.sanitizeForMetadata(item.source),
                        'published-at': item.time.toISOString(),
                        'sentiment': item.sentiment || 'unknown',
                        'has-content': fetchContent && s3Content.content ? 'true' : 'false',
                    },
                }));

                // Prepare InfluxDB Record with S3 path
                influxRecords.push({
                    ...item,
                    s3Path: s3Key,
                });

            } catch (error) {
                console.error(`[NewsService] Failed to process news ${item.id}:`, error);
                // Continue to next item even if one fails
            }
        }

        // Batch write to InfluxDB
        if (influxRecords.length > 0) {
            await this.influxWriter.writeNews(influxRecords);
            console.log(`[NewsService] Saved ${influxRecords.length} news items to InfluxDB and S3.`);
        }
    }

    /**
     * Save news from Massive API response directly
     * Transforms Massive format to NewsRecord
     */
    async saveNewsFromMassive(
        items: Array<{
            id: string;
            publisher?: { name?: string };
            title: string;
            author?: string;
            published_utc: string;
            article_url: string;
            tickers?: string[];
            image_url?: string;
            description?: string;
            keywords?: string[];
            insights?: Array<{
                ticker: string;
                sentiment: string;
                sentiment_reasoning?: string;
            }>;
        }>,
        primaryTicker: string,
        market: 'US' | 'CN' | 'HK' = 'US',
        fetchContent: boolean = FETCH_CONTENT
    ): Promise<void> {
        const { transformMassiveNewsToRecord } = await import('../utils/transformers');

        const records = items.map(item =>
            transformMassiveNewsToRecord(item, primaryTicker, market)
        );

        await this.saveNews(records, fetchContent);
    }
}
