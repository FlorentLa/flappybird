import { graphql } from './graphql';

export interface ScoreEntry {
  userId: string;
  username: string;
  score: number;
  createdAt: string;
}

const GET_TOP_SCORES = /* GraphQL */ `
  query GetTopScores($limit: Int) {
    getTopScores(limit: $limit) {
      items { userId username score createdAt }
    }
  }
`;

const SUBMIT_SCORE = /* GraphQL */ `
  mutation SubmitScore($input: SubmitScoreInput!) {
    submitScore(input: $input) {
      userId username score createdAt
    }
  }
`;

export async function getTopScores(limit = 10): Promise<ScoreEntry[]> {
  const data = await graphql<{ getTopScores: { items: ScoreEntry[] } }>(GET_TOP_SCORES, { limit });
  const items = data.getTopScores?.items ?? [];
  // Sort by score descending client-side (APPSYNC_JS can't sort via callbacks)
  return [...items].sort((a, b) => b.score - a.score);
}

export async function submitScore(score: number, username: string): Promise<ScoreEntry> {
  const data = await graphql<{ submitScore: ScoreEntry }>(SUBMIT_SCORE, {
    input: { score, username },
  });
  return data.submitScore;
}
