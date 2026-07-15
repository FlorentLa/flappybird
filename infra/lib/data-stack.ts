import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface DataStackProps extends cdk.StackProps {
  envName: string;
  prefix: string;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // Single-table design:
    //   pk = "SCORE" (partition for leaderboard)
    //   sk = "<score>#<userId>" (descending sort: pad score, allows top-N query)
    //   gsi1pk = "USER#<userId>"  (per-user scores)
    //   gsi1sk = createdAt ISO string
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: props.prefix,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      exportName: `${props.prefix}-TableName`,
    });
  }
}
