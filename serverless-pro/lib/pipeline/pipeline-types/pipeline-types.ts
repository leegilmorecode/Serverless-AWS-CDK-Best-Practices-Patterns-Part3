export interface EnvironmentConfig {
  env: {
    account: string;
    region: string;
  };
  stageName: string;
  stateful: {
    bucketName: string;
    assetsBucketName: string;
  };
  stateless: {
    lambdaMemorySize: number;
    canaryNotificationEmail: string;
  };
  client: {
    bucketName: string;
  };
  shared: {
    domainName: string;
    domainCertificateArn: string;
  };
}

export const enum Region {
  dublin = 'eu-west-1',
  london = 'eu-west-2',
  frankfurt = 'eu-central-1',
}

export const enum Stage {
  featureDev = 'featureDev',
  staging = 'staging',
  prod = 'prod',
  develop = 'develop',
}
