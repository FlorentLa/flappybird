// GUARDRAIL #1 — Cognito self-signup is DISABLED and must stay that way.
import { Stack, StackProps, CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface AuthStackProps extends StackProps {
  readonly envName: string;
  readonly prefix: string;
}

export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.prefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: `${props.prefix}-spa`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: `${this.stackName}-UserPoolId`,
    });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: `${this.stackName}-UserPoolClientId`,
    });
  }
}
