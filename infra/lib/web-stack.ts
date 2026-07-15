// GUARDRAIL #2 — NO public S3.
// GUARDRAIL #4 — NO public load balancer, NO listener on :80.
import * as path from 'path';
import * as fs from 'fs';
import {
  Stack,
  StackProps,
  CfnOutput,
  RemovalPolicy,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

export interface WebDomainConfig {
  readonly fqdn: string;
  readonly hostedZoneId: string;
  readonly zoneName: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEB_DIST = path.join(REPO_ROOT, 'modules', 'web', 'dist');

export interface WebStackProps extends StackProps {
  readonly envName: string;
  readonly prefix: string;
  readonly domain?: WebDomainConfig;
  readonly certificate?: acm.ICertificate;
}

interface WebCertStackProps extends StackProps {
  readonly fqdn: string;
  readonly hostedZoneId: string;
  readonly zoneName: string;
}

export class WebCertStack extends Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: WebCertStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'CertZone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    this.certificate = new acm.Certificate(this, 'WebCertificate', {
      domainName: props.fqdn,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}

export class WebStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    let zone: route53.IHostedZone | undefined;
    const certificate = props.certificate;
    if (props.domain) {
      zone = route53.HostedZone.fromHostedZoneAttributes(this, 'WebZone', {
        hostedZoneId: props.domain.hostedZoneId,
        zoneName: props.domain.zoneName,
      });
    }

    this.bucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket);

    this.distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      comment: `${props.prefix} web distribution`,
      defaultRootObject: 'index.html',
      domainNames: props.domain ? [props.domain.fqdn] : undefined,
      certificate,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enabled: true,
    });

    if (props.domain && zone) {
      const aliasTarget = route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution),
      );
      new route53.ARecord(this, 'WebAliasA', {
        zone,
        recordName: props.domain.fqdn,
        target: aliasTarget,
      });
      new route53.AaaaRecord(this, 'WebAliasAAAA', {
        zone,
        recordName: props.domain.fqdn,
        target: aliasTarget,
      });
    }

    const sources: s3deploy.ISource[] = fs.existsSync(WEB_DIST)
      ? [s3deploy.Source.asset(WEB_DIST)]
      : [
          s3deploy.Source.data(
            'index.html',
            `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FlappyBird (placeholder)</title>
</head>
<body>
  <h1>FlappyBird</h1>
  <p>Flappy Bird HTML5 game with live global leaderboard (Cognito+AppSync+DynamoDB)</p>
  <p>Web bundle not yet deployed. Run <code>npm run build -w modules/web</code> and redeploy.</p>
</body>
</html>
`,
          ),
        ];

    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources,
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: false,
    });

    new CfnOutput(this, 'WebBucketName', {
      value: this.bucket.bucketName,
      exportName: `${this.stackName}-WebBucketName`,
    });
    new CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: `${this.stackName}-DistributionId`,
    });
    new CfnOutput(this, 'SiteUrl', {
      value: props.domain
        ? `https://${props.domain.fqdn}`
        : `https://${this.distribution.distributionDomainName}`,
      exportName: `${this.stackName}-SiteUrl`,
    });
  }
}
