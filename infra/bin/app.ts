#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { ApiStack } from '../lib/api-stack';
import { WebStack, WebCertStack } from '../lib/web-stack';

const app = new cdk.App();

const env: string = app.node.tryGetContext('env') ?? 'demo';
if (!/^[a-z0-9-]+$/.test(env) || env.length > 16) {
  throw new Error(
    `Invalid env "${env}": must match ^[a-z0-9-]+$ and be <= 16 chars.`,
  );
}

const prefix = env === 'demo' ? 'FlappyBird' : `FlappyBird-${env}`;

const stackEnv: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '519956515742',
  region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
};

interface DomainConfig {
  fqdn: string;
  hostedZoneId: string;
  zoneName: string;
}
const domains = (app.node.tryGetContext('domains') ?? {}) as Record<string, DomainConfig | undefined>;
const rawDomain = domains[env];
const domain =
  rawDomain && !rawDomain.hostedZoneId.startsWith('REPLACE') ? rawDomain : undefined;

const auth = new AuthStack(app, `${prefix}-Auth`, { env: stackEnv, envName: env, prefix });
const data = new DataStack(app, `${prefix}-Data`, { env: stackEnv, envName: env, prefix });
new ApiStack(app, `${prefix}-Api`, {
  env: stackEnv,
  envName: env,
  prefix,
  userPool: auth.userPool,
  table: data.table,
});

const webCert = domain
  ? new WebCertStack(app, `${prefix}-WebCert`, {
      env: { account: stackEnv.account, region: 'us-east-1' },
      crossRegionReferences: true,
      fqdn: domain.fqdn,
      hostedZoneId: domain.hostedZoneId,
      zoneName: domain.zoneName,
    })
  : undefined;

new WebStack(app, `${prefix}-Web`, {
  env: stackEnv,
  crossRegionReferences: true,
  envName: env,
  prefix,
  domain,
  certificate: webCert?.certificate,
});

cdk.Tags.of(app).add('Demo', 'flappybird');
cdk.Tags.of(app).add('Project', 'flappybird');
cdk.Tags.of(app).add('Environment', env);
cdk.Tags.of(app).add('ManagedBy', 'scaffold-aws');
cdk.Tags.of(app).add('Owner', 'FlorentLa');
