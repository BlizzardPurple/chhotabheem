import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpApp } from '../src/http-app.js';
import { createRuntime } from '../src/runtime.js';

const project = 'demo/checkout-service';
const mismatchId = 'rule1-108-SHOP-241';
const localOrigin = 'http://127.0.0.1:3021';
const makeApp = (options = {}) => createHttpApp({ runtimeFactory: () => createRuntime({ mode: 'demo' }), ...options });
const post = (path, body, { origin = localOrigin, headers = {}, raw = false } = {}) => new Request(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw ? body : JSON.stringify(body),
});

test('HTTP config describes the local synthetic runtime and includes security headers', async () => {
  const app = makeApp();
  const response = await app(new Request(`${localOrigin}/api/config`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mode: 'demo', project, readOnly: false });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('demo assets are served with explicit content types and health does not contact providers', async () => {
  const app = createHttpApp({ runtimeFactory: () => { throw new Error('Provider initialization must not run for assets or health'); } });
  for (const [path, contentType] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css'], ['/pitch', 'text/html'], ['/pitch.js', 'text/javascript'], ['/pitch.css', 'text/css']]) {
    const response = await app(new Request(`${localOrigin}${path}`));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(contentType));
    assert.ok((await response.text()).length > 0);
  }
  for (const path of ['/health', '/healthz']) {
    const response = await app(new Request(`${localOrigin}${path}`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'ok');
  }
});

test('local HTTP denies non-loopback hosts and cross-origin mutations', async () => {
  const app = makeApp();
  assert.equal((await app(new Request('https://attacker.example/api/config'))).status, 403);
  assert.equal((await app(post('/api/scan', { project }, { headers: { origin: 'https://attacker.example' } }))).status, 403);
  assert.equal((await app(post('/api/scan', { project }, { headers: { origin: localOrigin } }))).status, 200);
});

test('HTTP rejects oversized bodies, wrong media types, malformed JSON and invalid projects', async () => {
  const app = makeApp();
  const cases = [
    [post('/api/scan', 'x'.repeat(16_385), { raw: true }), 413],
    [post('/api/scan', { project }, { headers: { 'content-type': 'text/plain' } }), 415],
    [post('/api/scan', '{invalid', { raw: true }), 400],
    [post('/api/scan', null), 400],
    [post('/api/scan', []), 400],
    [post('/api/scan', { project: '' }), 400],
    [post('/api/scan', { project: '\u0000secret' }), 400],
    [post('/api/scan', { project: 'x'.repeat(301) }), 400],
  ];
  for (const [request, expected] of cases) assert.equal((await app(request)).status, expected);
});

test('local HTTP completes scan, preview, explicit approval, execution and verified rescan', async () => {
  const app = makeApp();
  assert.equal((await (await app(post('/api/scan', { project }))).json()).mismatches.length, 5);
  const preview = await (await app(post('/api/preview', { project, mismatch_id: mismatchId }))).json();
  assert.ok(preview.approval_token);
  assert.equal((await app(post('/api/execute', { project, approval_token: preview.approval_token }))).status, 400);
  const executed = await app(post('/api/execute', { project, approval_token: preview.approval_token, approved: true }));
  assert.equal(executed.status, 200);
  assert.equal((await executed.json()).changed, true);
  const rescanned = await (await app(post('/api/scan', { project }))).json();
  assert.equal(rescanned.mismatches.length, 4);
  assert.deepEqual(rescanned.diff.resolved, [mismatchId]);
});

test('local reset starts a fresh isolated synthetic scenario', async () => {
  const app = makeApp();
  await app(post('/api/scan', { project }));
  const preview = await (await app(post('/api/preview', { project, mismatch_id: mismatchId }))).json();
  await app(post('/api/execute', { project, approval_token: preview.approval_token, approved: true }));
  assert.equal((await app(post('/api/reset', {}))).status, 200);
  assert.equal((await (await app(post('/api/scan', { project }))).json()).mismatches.length, 5);
});

test('public demo supports scan and fresh-instance preview but blocks execution and reset', async () => {
  const app = makeApp({ publicDemo: true });
  const origin = 'https://demo.example';
  const config = await (await app(new Request(`${origin}/api/config`))).json();
  assert.equal(config.readOnly, true);
  // Preview works on a new Lambda instance without relying on an earlier scan request.
  const preview = await app(post('/api/preview', { project, mismatch_id: mismatchId }, { origin }));
  assert.equal(preview.status, 200);
  const action = await preview.json();
  assert.ok(action.approval_token);
  assert.equal((await app(post('/api/execute', { project, approval_token: action.approval_token, approved: true }, { origin }))).status, 403);
  assert.equal((await app(post('/api/reset', {}, { origin }))).status, 403);
  const scan = await (await app(post('/api/scan', { project }, { origin }))).json();
  assert.equal(scan.mismatches.length, 5);
});

test('public hosting refuses a live runtime before accessing live workflow methods', async () => {
  const app = createHttpApp({ publicDemo: true, runtimeFactory: async () => ({ mode: 'live', workflow: new Proxy({}, { get() { throw new Error('Live workflow must never be accessed'); } }) }) });
  const response = await app(new Request('https://demo.example/api/config'));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /synthetic/i);
});

test('unknown HTTP routes and methods return 404', async () => {
  const app = makeApp();
  assert.equal((await app(new Request(`${localOrigin}/does-not-exist`))).status, 404);
  assert.equal((await app(new Request(`${localOrigin}/api/scan`, { method: 'DELETE' }))).status, 404);
  assert.equal((await app(post('/api/missing', { project }))).status, 404);
});
