import * as dotenv from 'dotenv';

import {
  EnvironmentConfig,
  Region,
  Stage,
} from '../pipeline-types/pipeline-types';

dotenv.config();

export const environments: Record<Stage, EnvironmentConfig> = {
  // allow developers to spin up a quick branch for a given PR they are working on e.g. pr-124
  // this is done with a npm run develop, not through the pipeline, and uses the values in .env
  [Stage.develop]: {
    env: {
      account:
        process.env.ACCOUNT || (process.env.CDK_DEFAULT_ACCOUNT as string),
      region: process.env.REGION || (process.env.CDK_DEFAULT_REGION as string),
    },
    stateful: {
      bucketName:
        `serverless-pro-lg-${process.env.PR_NUMBER}-bucket`.toLowerCase(),
      assetsBucketName:
        `serverless-pro-lg-${process.env.PR_NUMBER}-canary-bucket`.toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: parseInt(process.env.LAMBDA_MEM_SIZE || '128'),
      canaryNotificationEmail: process.env.NOTIFICATION_EMAIL as string,
    },
    client: {
      bucketName:
        `serverless-pro-client-${process.env.PR_NUMBER}-bucket`.toLowerCase(),
    },
    shared: {
      domainName: process.env.DOMAIN_NAME as string,
      domainCertificateArn: process.env.DOMAIN_CERT_ARN as string,
    },
    stageName: process.env.PR_NUMBER || Stage.develop,
  },
  [Stage.featureDev]: {
    env: {
      account: '111111111111',
      region: Region.dublin,
    },
    stateful: {
      bucketName: 'serverless-pro-lg-feature-dev-bucket',
      assetsBucketName:
        `serverless-pro-lg-feature-dev-canary-bucket`.toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: 128,
      canaryNotificationEmail: 'your.email@gmail.com',
    },
    client: {
      bucketName: 'serverless-pro-client-feature-dev-bucket',
    },
    shared: {
      domainName: 'your-domain.co.uk',
      domainCertificateArn:
        'arn:aws:acm:us-east-1:111111111111:certificate/3c0a6045-5e85-45c1-8749-74e87b1e6017',
    },
    stageName: Stage.featureDev,
  },
  [Stage.staging]: {
    env: {
      account: '222222222222',
      region: Region.dublin,
    },
    stateful: {
      bucketName: 'serverless-pro-lg-staging-bucket',
      assetsBucketName: `serverless-pro-lg-staging-canary-bucket`.toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: 1024,
      canaryNotificationEmail: 'your.email@gmail.com',
    },
    client: {
      bucketName: 'serverless-pro-client-staging-bucket',
    },
    shared: {
      domainName: 'your-domain.co.uk',
      domainCertificateArn:
        'arn:aws:acm:us-east-1:111111111111:certificate/3c0a6045-5e85-45c1-8749-74e87b1e6017',
    },
    stageName: Stage.staging,
  },
  [Stage.prod]: {
    env: {
      account: '333333333333',
      region: Region.dublin,
    },
    stateful: {
      bucketName: 'serverless-pro-lg-prod-bucket',
      assetsBucketName: `serverless-pro-lg-prod-canary-bucket`.toLowerCase(),
    },
    stateless: {
      lambdaMemorySize: 1024,
      canaryNotificationEmail: 'your.email@gmail.com',
    },
    client: {
      bucketName: 'serverless-pro-client-prod-bucket',
    },
    shared: {
      domainName: 'your-domain.co.uk',
      domainCertificateArn:
        'arn:aws:acm:us-east-1:111111111111:certificate/3c0a6045-5e85-45c1-8749-74e87b1e6017',
    },
    stageName: Stage.prod,
  },
};
