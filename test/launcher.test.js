import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkNodeVersion, parseArguments, selectMode, startWithAvailablePort } from '../scripts/hackathon.mjs';
import { startServer, attachShutdown } from '../src/http-server.js';

const exec = promisify(execFile);
const launcher = fileURLToPath(new URL('../scripts/hackathon.mjs', import.meta.url));

test('launcher selects synthetic by default and requires explicit live mode', () => {
  assert.equal(parseArguments([], { PROJECTSYNC_MODE: 'live' }).mode, 'demo');
  assert.equal(parseArguments(['--live'], {}).mode, 'live');
  assert.equal(parseArguments(['--check'], {}).check, true);
  assert.throws(() => parseArguments(['--live', '--demo'], {}), /Choose/);
  assert.throws(() => parseArguments(['--unknown'], {}), /Unknown argument/);
});

test('explicit port or PORT is never silently replaced and invalid inputs are rejected', () => {
  assert.deepEqual(parseArguments(['--port', '4040'], { PORT: '5000' }), { mode: 'demo', check: false, help: false, port: 4040, explicitPort: true });
  assert.equal(parseArguments([], { PORT: '5050' }).port, 5050);
  assert.equal(parseArguments([], {}).explicitPort, false);
  for (const port of ['0', '65536', '1.5', '-1', 'invalid', '']) {
    assert.throws(() => parseArguments(['--port', port], {}), /integer/);
  }
  assert.throws(() => parseArguments(['--port'], {}), /integer/);
});

test('launcher rejects Node releases missing the required built-in dotenv loader', () => {
  assert.throws(() => checkNodeVersion('18.20.0'), /20.12/);
  assert.throws(() => checkNodeVersion('20.11.9'), /20.12/);
  checkNodeVersion('20.12.0');
  checkNodeVersion('22.0.0');
});

test('sample selection is independent of broken provider configuration; live keeps credentials', () => {
  const live = { GITLAB_TOKEN: 'sentinel', JIRA_TRANSPORT: 'rest', PROJECTSYNC_MODE: 'demo', PROJECTSYNC_PUBLIC_DEMO: 'true' };
  selectMode('live', live);
  assert.equal(live.GITLAB_TOKEN, 'sentinel');
  assert.equal(live.PROJECTSYNC_MODE, 'live');
  assert.equal(live.PROJECTSYNC_PUBLIC_DEMO, 'false');
  const demo = { ...live, GITLAB_HOST: 'not a url', JIRA_TOKEN: 'sentinel', REVIEW_STALE_DAYS: 'invalid', JIRA_DONE_STATUS: 'Custom Done' };
  selectMode('demo', demo);
  assert.equal(demo.GITLAB_HOST, 'https://gitlab.com');
  assert.equal(demo.GITLAB_TOKEN, undefined);
  assert.equal(demo.JIRA_TOKEN, undefined);
  assert.equal(demo.JIRA_TRANSPORT, 'cli');
  assert.equal(demo.REVIEW_STALE_DAYS, '3');
  assert.equal(demo.JIRA_DONE_STATUS, undefined);
});

test('busy default port falls forward without disturbing other processes', async () => {
  const attempts = [], messages = [];
  const started = await startWithAvailablePort({ port: 3031, explicitPort: false }, async options => {
    attempts.push(options);
    if (options.port < 3033) throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
    return { port: options.port };
  }, message => messages.push(message));
  assert.equal(started.port, 3033);
  assert.deepEqual(attempts.map(a => a.port), [3031, 3032, 3033]);
  assert.ok(attempts.every(a => a.host === '127.0.0.1'));
  assert.equal(messages.length, 2);
});

test('explicit conflicts and permission failures never cause fallback', async () => {
  let calls = 0;
  await assert.rejects(startWithAvailablePort({ port: 3031, explicitPort: true }, async () => {
    calls++;
    throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
  }), /existing process was left untouched/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(startWithAvailablePort({ port: 3031, explicitPort: false }, async () => {
    calls++;
    throw Object.assign(new Error('permission denied'), { code: 'EPERM' });
  }), /permission denied/);
  assert.equal(calls, 1);
});

test('default-port fallback is bounded', async () => {
  let calls = 0;
  await assert.rejects(startWithAvailablePort({ port: 3031, explicitPort: false }, async () => {
    calls++;
    throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
  }, () => {}), /3031 through 3040/);
  assert.equal(calls, 10);
});

test('programmatic server reports actual ephemeral port and removes startup listeners', async () => {
  class FakeServer extends EventEmitter {
    listen(port, host) { this.requested = { port, host }; queueMicrotask(() => this.emit('listening')); }
    address() { return { port: 49823 }; }
  }
  const fake = new FakeServer();
  const started = await startServer({ port: 0, host: '127.0.0.1', handler: async () => new Response('ok'), serverFactory: () => fake });
  assert.equal(started.url, 'http://127.0.0.1:49823');
  assert.deepEqual(fake.requested, { port: 0, host: '127.0.0.1' });
  assert.equal(fake.listenerCount('error'), 0);
  assert.equal(fake.listenerCount('listening'), 0);
});

test('server startup propagates bind errors rather than reporting a ready URL', async () => {
  class FakeServer extends EventEmitter {
    listen() { queueMicrotask(() => this.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }))); }
  }
  const fake = new FakeServer();
  await assert.rejects(startServer({ port: 3031, handler: async () => new Response('ok'), serverFactory: () => fake }), { code: 'EADDRINUSE' });
  assert.equal(fake.listenerCount('listening'), 0);
});

test('shutdown drains once and detaches signal listeners after closing', async () => {
  const processLike = new EventEmitter();
  let closes = 0, idleCloses = 0, complete;
  const server = { close(callback) { closes++; complete = callback; }, closeIdleConnections() { idleCloses++; } };
  attachShutdown(server, { processLike });
  processLike.emit('SIGTERM');
  processLike.emit('SIGINT');
  assert.equal(closes, 1);
  assert.equal(idleCloses, 1);
  complete();
  assert.equal(processLike.exitCode, 0);
  assert.equal(processLike.listenerCount('SIGTERM'), 0);
  assert.equal(processLike.listenerCount('SIGINT'), 0);
});

test('executable launcher resolves its checkout from another cwd and rehearses without provider access', async () => {
  const { stdout, stderr } = await exec(process.execPath, [launcher, '--check'], {
    cwd: tmpdir(), timeout: 15_000,
    env: { ...process.env, PORT: '', PROJECTSYNC_MODE: 'live', GITLAB_HOST: 'malformed-host',
      JIRA_TRANSPORT: 'rest', JIRA_TOKEN: 'test-do-not-print', REVIEW_STALE_DAYS: 'invalid' },
  });
  assert.match(stdout, /PASS: assets, health, five findings/);
  assert.match(stdout, /No external providers were contacted/);
  assert.doesNotMatch(stdout + stderr, /test-do-not-print/);
});
