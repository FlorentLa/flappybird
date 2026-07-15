// APPSYNC_JS resolver for Query.getTopScores
// Queries the SCORE partition, sorted desc (sk = "XXXXXXXX#<userId>", zero-padded so higher scores sort first in desc order)
// No callbacks, no for, no ++/-- — return ctx.result.items as-is; client sorts if needed.
export function request(ctx) {
  var limit = ctx.args.limit ?? 10;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk',
      expressionValues: { ':pk': { S: 'SCORE' } }
    },
    scanIndexForward: false,
    limit: limit,
    select: 'ALL_ATTRIBUTES'
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return { items: ctx.result.items };
}
