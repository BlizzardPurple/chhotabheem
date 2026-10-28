/** API Gateway HTTP API (payload v2) adapter. The same application runs locally. */
export function createHandler(handleRequest) {
  return async function apiGatewayHandler(event) {
    if (event.version !== '2.0' || !event.requestContext?.http?.method) {
      return { statusCode: 400, body: 'Expected API Gateway HTTP API payload version 2.0.' };
    }
    const method = event.requestContext.http.method;
    const headers = new Headers(event.headers || {});
    if (event.cookies?.length) headers.set('cookie', event.cookies.join('; '));
    const domain = event.requestContext.domainName || 'localhost';
    const url = new URL(event.rawPath || '/', `https://${domain}`);
    url.search = event.rawQueryString || '';
    const body = event.body == null || method === 'GET' || method === 'HEAD'
      ? undefined
      : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    if (body && body.length > 1024 * 1024) {
      return { statusCode: 413, body: 'Request body exceeds 1 MiB.' };
    }
    const response = await handleRequest(new Request(url, { method, headers, body }));
    const outputHeaders = Object.fromEntries(response.headers);
    delete outputHeaders['set-cookie'];
    delete outputHeaders['content-length'];
    const cookies = response.headers.getSetCookie();
    return {
      statusCode: response.status,
      headers: outputHeaders,
      ...(cookies.length ? { cookies } : {}),
      body: Buffer.from(await response.arrayBuffer()).toString('base64'),
      isBase64Encoded: true,
    };
  };
}

export async function handler(event) {
  // This public deployment is deliberately restricted to the synthetic demo.
  if (process.env.PROJECTSYNC_DEMO !== 'true' || process.env.PROJECTSYNC_PUBLIC_DEMO !== 'true') {
    return { statusCode: 503, body: 'Public deployment requires synthetic demo mode.' };
  }
  const { handleRequest } = await import('../src/http-app.js');
  return createHandler(handleRequest)(event);
}
