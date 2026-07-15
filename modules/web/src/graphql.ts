import { getIdToken } from './auth';

let _graphqlUrl = '';

export function setGraphqlUrl(url: string) {
  _graphqlUrl = url;
}

export async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(_graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data as T;
}
