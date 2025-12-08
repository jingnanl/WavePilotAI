import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { dataFetcher } from './functions/data-fetcher/resource';

/**
 * WavePilotAI Backend Configuration
 *
 * Amplify Gen 2 backend with custom CDK resources:
 * - S3: Document and file storage
 * - DynamoDB: Trades, analysis, and time-series storage
 * - Secrets Manager: API keys
 * - CloudWatch: Logging
 *
 * TODO: Add Timestream once account is enrolled for LiveAnalytics service
 */

// Define backend with auth, data, and functions
const backend = defineBackend({
  auth,
  data,
  dataFetcher,
});

// Create custom CDK stack for data resources
const dataStack = backend.createStack('DataResources');

// ========================================================================
// S3 Bucket
// ========================================================================

const dataBucket = new s3.Bucket(dataStack, 'DataBucket', {
  bucketName: `wavepilot-data-${dataStack.account}`,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  versioned: true,
  lifecycleRules: [
    {
      id: 'raw-data-lifecycle',
      prefix: 'raw/',
      transitions: [
        { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(90) },
        { storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(365) },
      ],
    },
  ],
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

// ========================================================================
// DynamoDB Tables
// ========================================================================

// Trades table
const tradesTable = new dynamodb.Table(dataStack, 'TradesTable', {
  tableName: 'wavepilot-trades',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'tradeId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

tradesTable.addGlobalSecondaryIndex({
  indexName: 'TimestampIndex',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.ALL,
});

// Analysis table
const analysisTable = new dynamodb.Table(dataStack, 'AnalysisTable', {
  tableName: 'wavepilot-analysis',
  partitionKey: { name: 'analysisId', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

analysisTable.addGlobalSecondaryIndex({
  indexName: 'TickerIndex',
  partitionKey: { name: 'ticker', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.ALL,
});

// Stock quotes table (temporary replacement for Timestream)
const stockQuotesTable = new dynamodb.Table(dataStack, 'StockQuotesTable', {
  tableName: 'wavepilot-stock-quotes',
  partitionKey: { name: 'ticker', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',  // Auto-delete old data
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

stockQuotesTable.addGlobalSecondaryIndex({
  indexName: 'MarketTimeIndex',
  partitionKey: { name: 'market', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
  projectionType: dynamodb.ProjectionType.ALL,
});

// ========================================================================
// Secrets Manager
// ========================================================================

const apiKeysSecret = new secretsmanager.Secret(dataStack, 'ApiKeysSecret', {
  secretName: 'wavepilot/api-keys',
  description: 'API keys for external services (Alpaca, Massive)',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({
      ALPACA_API_KEY: '',
      ALPACA_API_SECRET: '',
      MASSIVE_API_KEY: '',
    }),
    generateStringKey: 'placeholder',
  },
});

// ========================================================================
// CloudWatch Log Groups
// ========================================================================

const dataFetcherLogGroup = new logs.LogGroup(dataStack, 'DataFetcherLogGroup', {
  logGroupName: '/aws/lambda/wavepilot-data-fetcher',
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const agentLogGroup = new logs.LogGroup(dataStack, 'AgentLogGroup', {
  logGroupName: '/aws/bedrock/wavepilot-agents',
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// ========================================================================
// Lambda Permissions
// ========================================================================

// Grant S3 access
dataBucket.grantReadWrite(backend.dataFetcher.resources.lambda);

// Grant Secrets access
apiKeysSecret.grantRead(backend.dataFetcher.resources.lambda);

// Grant DynamoDB access
tradesTable.grantReadWriteData(backend.dataFetcher.resources.lambda);
analysisTable.grantReadWriteData(backend.dataFetcher.resources.lambda);
stockQuotesTable.grantReadWriteData(backend.dataFetcher.resources.lambda);

// ========================================================================
// Lambda Environment Variables
// ========================================================================

backend.dataFetcher.addEnvironment('DATA_BUCKET', dataBucket.bucketName);
backend.dataFetcher.addEnvironment('TRADES_TABLE', tradesTable.tableName);
backend.dataFetcher.addEnvironment('ANALYSIS_TABLE', analysisTable.tableName);
backend.dataFetcher.addEnvironment('STOCK_QUOTES_TABLE', stockQuotesTable.tableName);
backend.dataFetcher.addEnvironment('API_KEYS_SECRET_ARN', apiKeysSecret.secretArn);

// ========================================================================
// Custom Outputs
// ========================================================================

backend.addOutput({
  custom: {
    dataBucket: dataBucket.bucketName,
    tradesTable: tradesTable.tableName,
    analysisTable: analysisTable.tableName,
    stockQuotesTable: stockQuotesTable.tableName,
    apiKeysSecretArn: apiKeysSecret.secretArn,
  },
});
