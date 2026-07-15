// APPSYNC_JS resolver for Query.health
// No array callbacks, no for-loops, no ++/--
export function request(ctx) {
  return { operation: 'GetItem', key: { pk: { S: 'HEALTH' }, sk: { S: 'health' } } };
}

export function response(ctx) {
  return { ok: true };
}
