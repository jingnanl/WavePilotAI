import { defineBackend } from '@aws-amplify/backend';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
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

// ========================================================================
// Constants
// ========================================================================

const API_KEYS_SECRET_NAME = 'wavepilot/api-keys';
const DATA_BUCKET_PREFIX = 'wavepilot-data';

// ========================================================================
// Environment Variables Validation
// ========================================================================

const INFLUXDB_ENDPOINT = process.env.INFLUXDB_ENDPOINT || '';
const INFLUXDB_PORT = process.env.INFLUXDB_PORT || '8181';
const INFLUXDB_SECRET_ARN = process.env.INFLUXDB_SECRET_ARN || '';
const INFLUXDB_DATABASE = process.env.INFLUXDB_DATABASE || 'market_data';

// Validate required environment variables at build time
const requiredEnvVars = {
  INFLUXDB_ENDPOINT,
  INFLUXDB_SECRET_ARN,
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.warn(
    `⚠️  Missing required environment variables: ${missingVars.join(', ')}\n` +
    `   Configure them in Amplify Console > Environment Variables before deployment.`
  );
}

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
  bucketName: `${DATA_BUCKET_PREFIX}-${dataStack.account}`,
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
  secretName: API_KEYS_SECRET_NAME,
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
// Lambda Permissions & Environment Variables
// ========================================================================

// dataFetcher reads from InfluxDB (price data) and S3 (news content)
dataBucket.grantRead(backend.dataFetcher.resources.lambda);
backend.dataFetcher.addEnvironment('DATA_BUCKET', dataBucket.bucketName);

// InfluxDB configuration - passed via environment variables
// These must be set in the deployment environment (Amplify Console or .env)
backend.dataFetcher.addEnvironment('INFLUXDB_ENDPOINT', INFLUXDB_ENDPOINT);
backend.dataFetcher.addEnvironment('INFLUXDB_PORT', INFLUXDB_PORT);
backend.dataFetcher.addEnvironment('INFLUXDB_SECRET_ARN', INFLUXDB_SECRET_ARN);
backend.dataFetcher.addEnvironment('INFLUXDB_DATABASE', INFLUXDB_DATABASE);

// Grant InfluxDB secret access to Lambda
if (INFLUXDB_SECRET_ARN) {
  const influxDbSecretForLambda = secretsmanager.Secret.fromSecretCompleteArn(
    dataStack,
    'InfluxDbSecretForLambda',
    INFLUXDB_SECRET_ARN
  );
  influxDbSecretForLambda.grantRead(backend.dataFetcher.resources.lambda);
}

// ========================================================================
// Fargate Worker Stack
// ========================================================================

const workerStack = backend.createStack('WorkerResources');

// VPC for Fargate (use default VPC or create a new one)
const vpc = new ec2.Vpc(workerStack, 'WavePilotWorkerVpc', {
  maxAzs: 2,
  natGateways: 1, // Minimize cost, worker needs outbound internet access
  subnetConfiguration: [
    {
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
    {
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask: 24,
    },
  ],
});

// ECS Cluster
const cluster = new ecs.Cluster(workerStack, 'WorkerCluster', {
  vpc,
  clusterName: 'wavepilot-worker-cluster',
  containerInsights: true,
});

// CloudWatch Log Group for Worker
const workerLogGroup = new logs.LogGroup(workerStack, 'WorkerLogGroup', {
  logGroupName: '/ecs/wavepilot-worker',
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Build Docker image from monorepo root (needed for workspace dependencies)
// Use process.cwd() as Amplify runs from .amplify directory during synthesis
const monorepoRoot = path.resolve(process.cwd(), '../..');
const workerImage = new ecr_assets.DockerImageAsset(workerStack, 'WorkerImage', {
  directory: monorepoRoot,
  file: 'apps/worker/Dockerfile',
  platform: ecr_assets.Platform.LINUX_AMD64,
});

// Task Definition
const taskDefinition = new ecs.FargateTaskDefinition(workerStack, 'WorkerTaskDef', {
  memoryLimitMiB: 1024,
  cpu: 512,
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.X86_64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

// Reference existing secrets (created in DataResources stack or manually)
// InfluxDB secret is created manually via AWS Console when provisioning Timestream for InfluxDB

// Reference API keys secret from DataResources stack
const apiKeysSecretRef = secretsmanager.Secret.fromSecretNameV2(
  workerStack,
  'ApiKeysSecretRef',
  API_KEYS_SECRET_NAME
);

// Grant secrets access to task role
apiKeysSecretRef.grantRead(taskDefinition.taskRole);
if (INFLUXDB_SECRET_ARN) {
  const influxDbSecret = secretsmanager.Secret.fromSecretCompleteArn(
    workerStack,
    'InfluxDbSecret',
    INFLUXDB_SECRET_ARN
  );
  influxDbSecret.grantRead(taskDefinition.taskRole);
}

// Grant S3 access (reference the bucket from DataResources)
const dataBucketRef = s3.Bucket.fromBucketName(
  workerStack,
  'DataBucketRef',
  `${DATA_BUCKET_PREFIX}-${workerStack.account}`
);
dataBucketRef.grantReadWrite(taskDefinition.taskRole);

// Add container to task definition
taskDefinition.addContainer('WorkerContainer', {
  image: ecs.ContainerImage.fromDockerImageAsset(workerImage),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'worker',
    logGroup: workerLogGroup,
  }),
  environment: {
    // Runtime
    NODE_ENV: 'production',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    AWS_REGION: process.env.AWS_REGION || 'us-west-2',
    // InfluxDB
    INFLUXDB_ENDPOINT: INFLUXDB_ENDPOINT,
    INFLUXDB_PORT: INFLUXDB_PORT,
    INFLUXDB_DATABASE: INFLUXDB_DATABASE,
    INFLUXDB_SECRET_ARN: INFLUXDB_SECRET_ARN,
    // S3
    DATA_BUCKET: `${DATA_BUCKET_PREFIX}-${workerStack.account}`,
    FETCH_NEWS_CONTENT: process.env.FETCH_NEWS_CONTENT || 'true',
    // Secrets
    API_KEYS_SECRET_ARN: apiKeysSecretRef.secretArn,
    // Massive API
    MASSIVE_BASE_URL: process.env.MASSIVE_BASE_URL || 'https://api.massive.com',
    MASSIVE_WS_URL: process.env.MASSIVE_WS_URL || 'wss://socket.massive.com/stocks',
    MASSIVE_DELAYED_WS_URL: process.env.MASSIVE_DELAYED_WS_URL || 'wss://delayed.massive.com/stocks',
    // Worker settings
    DEFAULT_WATCHLIST: process.env.DEFAULT_WATCHLIST || 'AAPL,TSLA,NVDA,AMZN,GOOGL',
    HEALTH_CHECK_PORT: process.env.HEALTH_CHECK_PORT || '8080',
    ENABLE_REALTIME: process.env.ENABLE_REALTIME || 'true',
    ENABLE_SCHEDULER: process.env.ENABLE_SCHEDULER || 'true',
  },
  healthCheck: {
    command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1'],
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(10),
    retries: 3,
    startPeriod: cdk.Duration.seconds(60),
  },
});

// Security Group for Fargate tasks
const workerSecurityGroup = new ec2.SecurityGroup(workerStack, 'WorkerSecurityGroup', {
  vpc,
  description: 'Security group for WavePilot Worker',
  allowAllOutbound: true, // Worker needs outbound for WebSocket, APIs
});

// Fargate Service (no load balancer needed for worker)
const workerService = new ecs.FargateService(workerStack, 'WorkerService', {
  cluster,
  taskDefinition,
  desiredCount: 1, // Single instance for data ingestion
  assignPublicIp: false, // Run in private subnet with NAT
  securityGroups: [workerSecurityGroup],
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  circuitBreaker: {
    rollback: true, // Auto rollback on deployment failure
  },
  enableExecuteCommand: true, // Allow ECS Exec for debugging
});

// ========================================================================
// Custom Outputs
// ========================================================================

backend.addOutput({
  custom: {
    // Data Resources
    dataBucket: dataBucket.bucketName,
    apiKeysSecretArn: apiKeysSecret.secretArn,
    // Worker Resources
    workerClusterArn: cluster.clusterArn,
    workerServiceArn: workerService.serviceArn,
    workerLogGroupName: workerLogGroup.logGroupName,
  },
});
