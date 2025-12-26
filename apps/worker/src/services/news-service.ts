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
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { createLogger } from '../utils/logger';
import { CONFIG } from '../config';
import type { NewsRecord, NewsContent } from '@wavepilot/shared';
import {
    HTTP_TIMEOUT_MS,
    MIN_ARTICLE_CONTENT_LENGTH,
    MAX_ARTICLE_CONTENT_SIZE,
    MAX_S3_METADATA_LENGTH,
} from '../utils/constants';

const logger = createLogger('NewsService');

const FETCH_CONTENT = process.env.FETCH_NEWS_CONTENT === 'true';

export class NewsService {
    private s3Client: S3Client;
    private influxWriter: InfluxDBWriter;
    private s3Enabled: boolean;

    constructor(influxWriter: InfluxDBWriter) {
        this.s3Client = new S3Client({ region: CONFIG.AWS_REGION });
        this.influxWriter = influxWriter;
        this.s3Enabled = !!CONFIG.DATA_BUCKET;

        if (!this.s3Enabled) {
            logger.warn('DATA_BUCKET not configured, S3 storage disabled.');
        }
        logger.info('Created.');
    }

    /**
     * Sanitize string for S3 metadata (ASCII only, max 2KB)
     */
    private sanitizeForMetadata(value: string): string {
        // Remove non-ASCII characters and limit length
        return value.replace(/[^\x20-\x7E]/g, '').substring(0, MAX_S3_METADATA_LENGTH);
    }

    /**
     * Extract main article content from HTML using Mozilla Readability
     */
    private extractArticleContent(html: string): string {
        try {
            const dom = new JSDOM(html);
            const doc = dom.window.document;

            // Pre-cleaning: remove known garbage elements that Readability might sometimes miss
            const garbageClasses = [
                '.ad', '.advertisement', '.banner', '.promo', '.sponsored',
                '.social-share', '.share-buttons', '.cookie-consent'
            ];
            const garbageSelector = garbageClasses.join(', ');

            doc.querySelectorAll(garbageSelector).forEach(el => el.remove());

            const reader = new Readability(doc);
            const article = reader.parse();

            if (article && article.textContent) {
                // Readability returns clean text with preservation of important structure
                // We do a final trim and cleanup of excessive whitespace
                return article.textContent
                    .replace(/[ \t]+/g, ' ')
                    .replace(/\n[ \t]+/g, '\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
            }
        } catch (error) {
            logger.warn('Readability extraction failed, falling back to simple cleaning:', { error: (error as Error).message });
        }

        // Fallback: simple tag stripping (much simplified from before as it's just a backup)
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Fetch article content from URL
     * Returns extracted plain text content or null if fetch fails
     */
    private async fetchArticleContent(url: string): Promise<string | null> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });

            clearTimeout(timeout);

            if (!response.ok) {
                logger.warn(`Failed to fetch ${url}: ${response.status}`);
                return null;
            }

            const html = await response.text();
            const content = this.extractArticleContent(html);

            // Skip if extracted content is too short (likely failed extraction)
            if (content.length < MIN_ARTICLE_CONTENT_LENGTH) {
                logger.warn(`Extracted content too short for ${url}`);
                return null;
            }

            // Limit content size
            return content.length > MAX_ARTICLE_CONTENT_SIZE
                ? content.substring(0, MAX_ARTICLE_CONTENT_SIZE)
                : content;
        } catch (error) {
            logger.warn(`Error fetching ${url}:`, { error: (error as Error).message });
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

        logger.info(`Processing ${newsItems.length} news items (fetchContent: ${fetchContent}, s3Enabled: ${this.s3Enabled})...`);

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

                // Upload to S3 with metadata in object tags (only if S3 is enabled)
                if (this.s3Enabled) {
                    // Note: S3 metadata only supports ASCII, so we sanitize values
                    await this.s3Client.send(new PutObjectCommand({
                        Bucket: CONFIG.DATA_BUCKET,
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
                }

                // Prepare InfluxDB Record with S3 path
                influxRecords.push({
                    ...item,
                    s3Path: this.s3Enabled ? s3Key : undefined,
                });

            } catch (error) {
                logger.error(`Failed to process news ${item.id}:`, error as Error);
                // Continue to next item even if one fails
            }
        }

        // Batch write to InfluxDB
        if (influxRecords.length > 0) {
            await this.influxWriter.writeNews(influxRecords);
            logger.info(`Saved ${influxRecords.length} news items to InfluxDB${this.s3Enabled ? ' and S3' : ''}.`);
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
