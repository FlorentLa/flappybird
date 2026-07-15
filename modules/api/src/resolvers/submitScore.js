// APPSYNC_JS resolver for Mutation.submitScore — Lambda data source pass-through
// The actual write logic lives in the Lambda (full Node.js runtime)
export function request(ctx) {
  return {
    operation: 'Invoke',
    payload: {
      field: 'submitScore',
      arguments: ctx.args,
      identity: ctx.identity
    }
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
