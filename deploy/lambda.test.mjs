import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, handler } from './lambda.mjs';

const event = {
  version: '2.0',
  rawPath: '/api/demo',
  rawQueryString: 'scenario=after&tag=a&tag=b',
  requestContext: { domainName: 'example.execute-api.us-east-1.amazonaws.com', http: { method: 'POST' } },
  headers: { 'content-type': 'application/json' },
  cookies: ['demo=1', 'session=2'],
  body: Buffer.from('{"action":"preview"}').toString('base64'),
  isBase64Encoded: true,
};

test('API Gateway adapter preserves encoded body, query duplicates, cookies and response bytes', async () => {
  const execute = createHandler(async request => {
    assert.equal(request.method, 'POST');
    assert.deepEqual(new URL(request.url).searchParams.getAll('tag'), ['a', 'b']);
    assert.equal(request.headers.get('cookie'), 'demo=1; session=2');
    assert.deepEqual(await request.json(), { action: 'preview' });
    const responseHeaders = new Headers({ 'content-type': 'application/octet-stream' });
    responseHeaders.append('set-cookie', 'a=1; HttpOnly');
    responseHeaders.append('set-cookie', 'b=2; Secure');
    return new Response(new Uint8Array([0, 255, 128, 32]), { status: 201, headers: responseHeaders });
  });
  const response = await execute(event);
  assert.equal(response.statusCode, 201);
  assert.equal(response.isBase64Encoded, true);
  assert.deepEqual([...Buffer.from(response.body, 'base64')], [0, 255, 128, 32]);
  assert.equal(response.cookies.length, 2);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('adapter rejects unsupported events and oversized payloads before application execution', async () => {
  const execute = createHandler(() => { throw new Error('Must not reach the application'); });
  assert.equal((await execute({ version: '1.0' })).statusCode, 400);
  assert.equal((await execute({ ...event, isBase64Encoded: false, body: 'x'.repeat(1024 * 1024 + 1) })).statusCode, 413);
});

test('public handler fails closed when synthetic demo mode is disabled', async () => {
  const original = process.env.PROJECTSYNC_DEMO;
  try {
    process.env.PROJECTSYNC_DEMO = 'false';
    assert.equal((await handler(event)).statusCode, 503);
  } finally {
    if (original === undefined) delete process.env.PROJECTSYNC_DEMO;
    else process.env.PROJECTSYNC_DEMO = original;
  }
});
