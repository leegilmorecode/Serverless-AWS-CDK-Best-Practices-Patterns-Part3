import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as certificateManager from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudFront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as nodeLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as path from 'path';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as synthetics from '@aws-cdk/aws-synthetics-alpha';

import { Aspects, CustomResource, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  CachePolicy,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';

import { AwsSolutionsChecks } from 'cdk-nag';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { Stage } from '../../pipeline/pipeline-types/pipeline-types';

export interface StatelessStackProps extends cdk.StackProps {
  env: {
    account: string;
    region: string;
  };
  table: dynamodb.Table;
  bucket: s3.Bucket;
  assetsBucket: s3.Bucket;
  stageName: string;
  lambdaMemorySize: number;
  domainName: string;
  canaryNotificationEmail: string;
  domainCertArn: string;
}

export class StatelessStack extends cdk.Stack {
  public readonly apiEndpointUrl: cdk.CfnOutput;
  public readonly healthCheckUrl: cdk.CfnOutput;
  private readonly ordersApi: apigw.RestApi;

  constructor(scope: Construct, id: string, props: StatelessStackProps) {
    super(scope, id, props);

    const { table, bucket } = props;
    const apiSubDomain =
      `api-${props.stageName}.${props.domainName}`.toLowerCase();
    const websiteSubDomain =
      `https://${props.stageName}.${props.domainName}`.toLowerCase();

    // create the rest api
    this.ordersApi = new apigw.RestApi(this, 'Api', {
      description: `Serverless Pro API ${props.stageName}`,
      deploy: true,
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowCredentials: true,
        allowMethods: ['OPTIONS', 'POST', 'GET'],
        allowHeaders: ['*'],
      },
      endpointTypes: [apigw.EndpointType.REGIONAL],
      cloudWatchRole: true,
      deployOptions: {
        stageName: props.stageName,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
      },
    });

    // create the rest api resources
    const orders: apigw.Resource = this.ordersApi.root.addResource('orders');
    const healthCheck: apigw.Resource =
      this.ordersApi.root.addResource('health-checks');

    const order: apigw.Resource = orders.addResource('{id}');

    const cloudFrontDistribution = new cloudFront.Distribution(
      this,
      'Distribution',
      {
        comment: `${props.stageName} api web distribution`,
        priceClass: cloudFront.PriceClass.PRICE_CLASS_100,
        enabled: true,
        httpVersion: cloudFront.HttpVersion.HTTP3,
        defaultBehavior: {
          origin: new origins.RestApiOrigin(this.ordersApi),
          allowedMethods: cloudFront.AllowedMethods.ALLOW_ALL,
          compress: true,
          cachePolicy: new CachePolicy(this, 'CachePolicy', {
            comment: 'Policy with caching disabled',
            enableAcceptEncodingGzip: false,
            enableAcceptEncodingBrotli: false,
            defaultTtl: Duration.seconds(0),
            maxTtl: Duration.seconds(0),
            minTtl: Duration.seconds(0),
          }),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          originRequestPolicy: new OriginRequestPolicy(this, 'RequestPolicy', {
            comment: 'Policy to forward all query parameters but no headers',
            headerBehavior: cloudFront.OriginRequestHeaderBehavior.none(),
            queryStringBehavior:
              cloudFront.OriginRequestQueryStringBehavior.all(),
          }),
        },
        domainNames: [apiSubDomain],
        sslSupportMethod: cloudFront.SSLMethod.SNI,
        minimumProtocolVersion: cloudFront.SecurityPolicyProtocol.TLS_V1_2_2021,
        certificate: certificateManager.Certificate.fromCertificateArn(
          this,
          'Certificate',
          props.domainCertArn
        ),
      }
    );

    cloudFrontDistribution.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // get the hosted zone based on domain name lookup
    const zone: route53.IHostedZone = route53.HostedZone.fromLookup(
      this,
      'HostedZone',
      {
        domainName: `${props.domainName}`,
      }
    );

    // create the alias record for the api for this particular stage
    // e.g. api-featuredev.your-domain.co.uk/orders/
    const subDomainRecord: route53.ARecord = new route53.ARecord(
      this,
      'Alias',
      {
        zone,
        recordName: `api-${props.stageName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(cloudFrontDistribution)
        ),
      }
    );
    subDomainRecord.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // create the lambdas
    const createOrderLambda: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'CreateOrderLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          'src/handlers/create-order/create-order.ts'
        ),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: bucket.bucketName,
        },
      });

    const getOrderLambda: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'GetOrderLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(__dirname, 'src/handlers/get-order/get-order.ts'),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: table.tableName,
        },
      });

    const listOrdersLambda: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'ListOrdersLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(__dirname, 'src/handlers/list-orders/list-orders.ts'),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
        environment: {
          TABLE_NAME: table.tableName,
        },
      });

    const healthCheckLambda: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'HealthCheckLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          'src/handlers/health-check/health-check.ts'
        ),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
      });

    const populateOrdersHandler: nodeLambda.NodejsFunction =
      new nodeLambda.NodejsFunction(this, 'PopulateTableLambda', {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: path.join(
          __dirname,
          'src/handlers/populate-table-cr/populate-table-cr.ts'
        ),
        memorySize: props.lambdaMemorySize, // this is from props per env
        handler: 'handler',
        bundling: {
          minify: true,
          externalModules: ['aws-sdk'],
        },
      });

    // hook up the lambda functions to the api
    orders.addMethod(
      'POST',
      new apigw.LambdaIntegration(createOrderLambda, {
        proxy: true,
      })
    );

    orders.addMethod(
      'GET',
      new apigw.LambdaIntegration(listOrdersLambda, {
        proxy: true,
      })
    );

    order.addMethod(
      'GET',
      new apigw.LambdaIntegration(getOrderLambda, {
        proxy: true,
      })
    );

    healthCheck.addMethod(
      'GET',
      new apigw.LambdaIntegration(healthCheckLambda, {
        proxy: true,
      })
    );

    const provider: cr.Provider = new cr.Provider(
      this,
      'PopulateTableConfigCustomResource',
      {
        onEventHandler: populateOrdersHandler, // this lambda will be called on cfn deploy
        logRetention: logs.RetentionDays.ONE_DAY,
        providerFunctionName: `populate-orders-${props.stageName}-cr-lambda`,
      }
    );

    // use the custom resource provider
    new CustomResource(this, 'DbTableConfigCustomResource', {
      serviceToken: provider.serviceToken,
      properties: {
        tableName: props.table.tableName,
      },
    });

    // grant the relevant lambdas access to our dynamodb database
    table.grantReadData(getOrderLambda);
    table.grantReadWriteData(createOrderLambda);
    table.grantWriteData(populateOrdersHandler);
    table.grantReadData(listOrdersLambda);

    // grant the create order lambda access to the s3 bucket
    bucket.grantWrite(createOrderLambda);

    // we only use synthetics in the staging (gamma) or prod stages
    // https://pipelines.devops.aws.dev/application-pipeline/index.html
    if (props.stageName === Stage.staging || props.stageName === Stage.prod) {
      const apiTopic: sns.Topic = new sns.Topic(this, 'CanaryAPITopic', {
        displayName: `${props.stageName} API Canary Topic`,
        topicName: `${props.stageName}ApiCanaryTopic`,
      });
      apiTopic.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const visualTopic: sns.Topic = new sns.Topic(this, 'CanaryVisualTopic', {
        displayName: `${props.stageName} Visual Canary Topic`,
        topicName: `${props.stageName}VisualCanaryTopic`,
      });
      visualTopic.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const apiTopicSubscription = apiTopic.addSubscription(
        new subscriptions.EmailSubscription(props.canaryNotificationEmail)
      );
      const visualTopicSubscription = visualTopic.addSubscription(
        new subscriptions.EmailSubscription(props.canaryNotificationEmail)
      );

      apiTopicSubscription.applyRemovalPolicy(RemovalPolicy.DESTROY);
      visualTopicSubscription.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const canaryRole: iam.Role = new iam.Role(this, 'CanaryIamRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        description: `Canary IAM Role for ${props.stageName}`,
      });

      canaryRole.addToPolicy(
        new iam.PolicyStatement({
          resources: ['*'],
          actions: ['s3:ListAllMyBuckets'],
          effect: iam.Effect.ALLOW,
        })
      );

      canaryRole.addToPolicy(
        new iam.PolicyStatement({
          resources: [`${props.assetsBucket.bucketArn}/*`],
          actions: ['kms:GenerateDataKey'],
          effect: iam.Effect.ALLOW,
        })
      );

      canaryRole.addToPolicy(
        new iam.PolicyStatement({
          resources: [`${props.assetsBucket.bucketArn}/*`],
          actions: ['s3:*'],
          effect: iam.Effect.ALLOW,
        })
      );

      canaryRole.addToPolicy(
        new iam.PolicyStatement({
          resources: ['*'],
          actions: ['cloudwatch:PutMetricData'],
          effect: iam.Effect.ALLOW,
          conditions: {
            StringEquals: {
              'cloudwatch:namespace': 'CloudWatchSynthetics',
            },
          },
        })
      );

      canaryRole.addToPolicy(
        new iam.PolicyStatement({
          resources: ['arn:aws:logs:::*'],
          actions: [
            'logs:CreateLogStream',
            'logs:CreateLogGroup',
            'logs:PutLogEvents',
          ],
          effect: iam.Effect.ALLOW,
        })
      );

      const apiCanary: synthetics.Canary = new synthetics.Canary(
        this,
        'APICanary',
        {
          canaryName: `${props.stageName}-api-canary`,
          role: canaryRole,
          schedule: synthetics.Schedule.rate(cdk.Duration.minutes(5)),
          artifactsBucketLocation: {
            bucket: props.assetsBucket,
          },
          test: synthetics.Test.custom({
            code: synthetics.Code.fromAsset(
              path.join(__dirname, './src/canaries/api-canary')
            ),
            handler: 'index.handler',
          }),
          runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_3_9,
          environmentVariables: {
            APP_API_HOST: props.domainName,
            STAGE: props.stageName,
          },
        }
      );
      apiCanary.applyRemovalPolicy(RemovalPolicy.DESTROY);

      const visualCanary: synthetics.Canary = new synthetics.Canary(
        this,
        'VisualCanary',
        {
          canaryName: `${props.stageName}-visual-canary`,
          role: canaryRole,
          schedule: synthetics.Schedule.rate(cdk.Duration.minutes(5)),
          artifactsBucketLocation: {
            bucket: props.assetsBucket,
          },
          test: synthetics.Test.custom({
            code: synthetics.Code.fromAsset(
              path.join(__dirname, './src/canaries/visual-canary')
            ),
            handler: 'index.handler',
          }),
          runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_3_9,
          environmentVariables: {
            STAGE: props.stageName,
            WEBSITE_URL: websiteSubDomain,
          },
        }
      );
      visualCanary.applyRemovalPolicy(RemovalPolicy.DESTROY);

      // add alarms
      const apiAlarm: cloudwatch.Alarm = new cloudwatch.Alarm(
        this,
        'APICanaryAlarm',
        {
          metric: apiCanary.metricSuccessPercent(), // percentage of successful canary runs over a given time
          evaluationPeriods: 1,
          threshold: 90,
          actionsEnabled: true,
          alarmDescription: `${props.stageName} API Canary CloudWatch Alarm`,
          alarmName: `${props.stageName}ApiCanaryAlarm`,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        }
      );

      const visualAlarm: cloudwatch.Alarm = new cloudwatch.Alarm(
        this,
        'VisualCanaryAlarm',
        {
          metric: visualCanary.metricSuccessPercent(), // percentage of successful canary runs over a given time
          evaluationPeriods: 1,
          threshold: 60,
          datapointsToAlarm: 1,
          actionsEnabled: true,
          alarmDescription: `${props.stageName} Visual Canary CloudWatch Alarm`,
          alarmName: `${props.stageName}VisualCanaryAlarm`,
          comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        }
      );

      apiAlarm.addAlarmAction(new actions.SnsAction(apiTopic));
      visualAlarm.addAlarmAction(new actions.SnsAction(visualTopic));

      visualAlarm.applyRemovalPolicy(RemovalPolicy.DESTROY);
      apiAlarm.applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    // add our outputs
    const apiEndpoint = `api-${props.stageName}.${props.domainName}`;
    this.apiEndpointUrl = new cdk.CfnOutput(this, 'ApiEndpointOutput', {
      value: apiEndpoint,
      exportName: `api-endpoint-${props.stageName}`,
    });

    this.healthCheckUrl = new cdk.CfnOutput(this, 'healthCheckUrlOutput', {
      value: `${apiEndpoint}/health-checks`,
      exportName: `healthcheck-endpoint-${props.stageName}`,
    });

    // cdk nag check and suppressions
    Aspects.of(this).add(new AwsSolutionsChecks({ verbose: false }));
    NagSuppressions.addStackSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-COG4',
          reason: `Rule suppression for 'The REST API stage is not associated with AWS WAFv2 web ACL'`,
        },
        {
          id: 'AwsSolutions-APIG3',
          reason: `Rule suppression for 'The REST API stage is not associated with AWS WAFv2 web ACL'`,
        },
        {
          id: 'AwsSolutions-APIG2',
          reason: `Rule suppression for 'The REST API does not have request validation enabled'`,
        },
        {
          id: 'AwsSolutions-IAM4',
          reason: `Rule suppression for 'The IAM user, role, or group uses AWS managed policies'`,
        },
        {
          id: 'AwsSolutions-APIG4',
          reason: `Rule suppression for 'The API does not implement authorization.'`,
        },
        {
          id: 'AwsSolutions-APIG1',
          reason: `Rule suppression for 'The API does not have access logging enabled'`,
        },
        {
          id: 'AwsSolutions-L1',
          reason: `Rule suppression for 'The non-container Lambda function is not configured to use the latest runtime version'`,
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: `Rule suppression for 'The IAM entity contains wildcard permissions and does not have a cdk-nag rule suppression with evidence for those permission'`,
        },
        {
          id: 'AwsSolutions-CFR3',
          reason: `Rule suppression for 'The CloudFront distribution does not have access logging enabled'`,
        },
        {
          id: 'AwsSolutions-SNS2',
          reason: `Rule supression for 'The SNS Topic does not have server-side encryption enabled'`,
        },
        {
          id: 'AwsSolutions-SNS3',
          reason: `Rule supression for 'The SNS Topic does not require publishers to use SSL.'`,
        },
      ],
      true
    );
  }
}
