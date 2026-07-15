// GUARDRAIL: USER_POOL default authorization. No API_KEY.
// GUARDRAIL #3: No Lambda Function URL anywhere.
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  readonly envName: string;
  readonly prefix: string;
  readonly userPool: cognito.IUserPool;
  readonly table: dynamodb.ITable;
}

interface ResolverWiring {
  readonly typeName: string;
  readonly fieldName: string;
  readonly source: 'ddb' | 'lambda';
}

export class ApiStack extends Stack {
  public readonly graphqlApi: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.graphqlApi = new appsync.GraphqlApi(this, 'GraphqlApi', {
      name: `${props.prefix}-api`,
      definition: appsync.Definition.fromSchema(
        appsync.SchemaFile.fromAsset(
          path.join(__dirname, '..', '..', 'modules', 'api', 'schema.graphql'),
        ),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool: props.userPool },
        },
      },
      xrayEnabled: true,
    });

    const ddbSource = this.graphqlApi.addDynamoDbDataSource('DdbSource', props.table);

    const fileHelper = new NodejsFunction(this, 'FileHelperFn', {
      functionName: `${props.prefix}-file-helper`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(
        __dirname, '..', '..', 'modules', 'api', 'src', 'lambdas', 'file-helper', 'index.ts',
      ),
      environment: {
        TABLE_NAME: props.table.tableName,
        ENV_NAME: props.envName,
      },
      bundling: {
        externalModules: ['@aws-sdk/*'],
        format: OutputFormat.ESM,
        minify: true,
      },
    });

    props.table.grantReadWriteData(fileHelper);
    const lambdaSource = this.graphqlApi.addLambdaDataSource('LambdaSource', fileHelper);

    // Flappy Bird leaderboard resolvers:
    // - Query.health — liveness check
    // - Query.getTopScores — top-10 leaderboard (sorted desc)
    // - Mutation.submitScore — post a new score (signed-in only)
    const wiring: ResolverWiring[] = [
      { typeName: 'Query', fieldName: 'health', source: 'ddb' },
      { typeName: 'Query', fieldName: 'getTopScores', source: 'ddb' },
      { typeName: 'Mutation', fieldName: 'submitScore', source: 'lambda' },
    ];

    for (const { typeName, fieldName, source } of wiring) {
      const dataSource = source === 'ddb' ? ddbSource : lambdaSource;
      dataSource.createResolver(`${typeName}${fieldName}Resolver`, {
        typeName,
        fieldName,
        runtime: appsync.FunctionRuntime.JS_1_0_0,
        code: appsync.Code.fromAsset(
          path.join(
            __dirname, '..', '..', 'modules', 'api', 'src', 'resolvers', `${fieldName}.js`,
          ),
        ),
      });
    }

    new CfnOutput(this, 'GraphqlUrl', {
      value: this.graphqlApi.graphqlUrl,
      exportName: `${this.stackName}-GraphqlUrl`,
    });
    new CfnOutput(this, 'GraphqlApiId', {
      value: this.graphqlApi.apiId,
      exportName: `${this.stackName}-GraphqlApiId`,
    });
  }
}
