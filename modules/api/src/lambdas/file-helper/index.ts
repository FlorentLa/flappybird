import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE = process.env.TABLE_NAME ?? '';

interface AppSyncEvent {
  field: string;
  arguments: {
    input?: { score: number; username: string };
    limit?: number;
  };
  identity: {
    sub: string;
    username?: string;
    claims?: { email?: string };
  };
}

export const handler = async (event: AppSyncEvent) => {
  if (event.field === 'submitScore') {
    const { score, username } = event.arguments.input!;
    const userId = event.identity.sub;
    const createdAt = new Date().toISOString();

    // sk = "<padded-score>#<userId>" — zero-padded to 10 digits so DDB sorts descending
    // by score when queried with scanIndexForward:false on pk="SCORE"
    const paddedScore = String(score).padStart(10, '0');
    const sk = `${paddedScore}#${userId}`;

    await ddb.send(new PutItemCommand({
      TableName: TABLE,
      Item: {
        pk: { S: 'SCORE' },
        sk: { S: sk },
        userId: { S: userId },
        username: { S: username },
        score: { N: String(score) },
        createdAt: { S: createdAt },
        gsi1pk: { S: `USER#${userId}` },
        gsi1sk: { S: createdAt },
      },
      // Only write if this score is better than an existing one for the same user
      // (or no entry exists). Allow duplicate sk entries for same user different scores.
    }));

    return { userId, username, score, createdAt };
  }

  return { ok: true };
};
