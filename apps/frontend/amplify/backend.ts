import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
 * - DynamoDB: Trades and analysis storage (via Amplify Data)
 * - Secrets Manager: API keys
 * - CloudWatch: Logging
 *
 * Note: InfluxDB 3 is created manually via AWS Console.
 * Required environment variables:
 * - INFLUXDB_ENDPOINT: InfluxDB instance endpoint
 * - INFLUXDB_SECRET_ARN: Secrets Manager ARN for InfluxDB credentials
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
        { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(365) },
        { storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(3650) },
      ],
    },
  ],
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
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

// Grant API Keys Secrets access
apiKeysSecret.grantRead(backend.dataFetcher.resources.lambda);

// ========================================================================
// Lambda Environment Variables
// ========================================================================

backend.dataFetcher.addEnvironment('DATA_BUCKET', dataBucket.bucketName);
backend.dataFetcher.addEnvironment('API_KEYS_SECRET_ARN', apiKeysSecret.secretArn);

// InfluxDB configuration - passed via environment variables
// These must be set in the deployment environment (Amplify Console or .env)
backend.dataFetcher.addEnvironment('INFLUXDB_ENDPOINT', process.env.INFLUXDB_ENDPOINT || '');
backend.dataFetcher.addEnvironment('INFLUXDB_SECRET_ARN', process.env.INFLUXDB_SECRET_ARN || '');
backend.dataFetcher.addEnvironment('INFLUXDB_DATABASE', process.env.INFLUXDB_DATABASE || 'market_data');

// ========================================================================
// Custom Outputs
// ========================================================================

backend.addOutput({
  custom: {
    dataBucket: dataBucket.bucketName,
    apiKeysSecretArn: apiKeysSecret.secretArn,
  },
});
