#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 3031;
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const USAGE = `ProjectSync hackathon deliverable

  node scripts/hackathon.mjs                 Start the synthetic local demo
  node scripts/hackathon.mjs --live          Use configured GitLab/Jira access
  node scripts/hackathon.mjs --port 4040      Use an explicit local port
  node scripts/hackathon.mjs --check         Verify the synthetic workflow, then exit

Sample mode never contacts providers. Live mode never falls back to sample data.
The default port is 3031; a busy default tries the next nine ports.
An explicit --port or PORT value is never changed automatically.
`;

export function checkNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 12)) {
    throw new Error(`Node.js 20.12 or newer is required (found ${version}). Install Node.js 22 or 24, then run this command again.`);
  }
}

export function parseArguments(args, env = process.env) {
  const options = { mode: 'demo', check: false, help: false, port: undefined, explicitPort: false };
  let modeSelected = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--live' || value === '--demo') {
      if (modeSelected) throw new Error('Choose --live or --demo once.');
      options.mode = value === '--live' ? 'live' : 'demo';
      modeSelected = true;
    } else if (value === '--check') options.check = true;
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--port') {
      if (options.explicitPort) throw new Error('Provide --port only once.');
      options.port = args[++index];
      options.explicitPort = true;
    } else throw new Error(`Unknown argument: ${value}. Use --help for usage.`);
  }
  if (!options.explicitPort && env.PORT) {
    options.port = env.PORT;
    options.explicitPort = true;
  }
  if (options.port === undefined && !options.explicitPort) options.port = DEFAULT_PORT;
  if (!/^\d+$/.test(String(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) {
    throw new Error('--port / PORT must be an integer between 1 and 65535.');
  }
  options.port = Number(options.port);
  return options;
}

/** Sample mode is reproducible even on a machine carrying stale provider credentials. */
export function selectMode(mode, env = process.env) {
  env.PROJECTSYNC_MODE = mode;
  // This launcher is always local; public hosting has its own entry point.
  env.PROJECTSYNC_PUBLIC_DEMO = 'false';
  if (mode === 'demo') {
    env.GITLAB_HOST = 'https://gitlab.com';
    env.JIRA_TRANSPORT = 'cli';
    env.REVIEW_STALE_DAYS = '3';
    delete env.JIRA_DONE_STATUS;
    for (const name of ['GITLAB_TOKEN', 'JIRA_TOKEN', 'JIRA_API_TOKEN', 'JIRA_EMAIL', 'GOOGLE_ACCESS_TOKEN']) delete env[name];
  }
}

export async function startWithAvailablePort(options, start, log = console.log) {
  const attempts = options.explicitPort ? 1 : 10;
  for (let offset = 0; offset < attempts; offset++) {
    const port = options.port + offset;
    if (port > 65535) break;
    try { return await start({ port, host: '127.0.0.1' }); }
    catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      if (options.explicitPort) throw new Error(`Port ${port} is already in use. Choose another --port value; the existing process was left untouched.`);
      log(`Port ${port} is in use; trying the next local port.`);
    }
  }
  throw new Error(`No free port found from ${options.port} through ${Math.min(65535, options.port + attempts - 1)}. Choose --port explicitly.`);
}

async function checkApplication(options, handleRequest) {
  const origin = 'http://127.0.0.1';
  const get = path => handleRequest(new Request(`${origin}${path}`));
  const post = (path, body) => handleRequest(new Request(`${origin}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  for (const path of ['/', '/app.js', '/styles.css', '/health']) {
    const response = await get(path);
    if (!response.ok) throw new Error(`Application check failed at ${path} (${response.status}).`);
  }
  const response = await get('/api/config');
  const config = await response.json();
  if (!response.ok || config.mode !== options.mode) throw new Error(config.error || 'Application initialized in an unexpected mode.');
  if (options.mode === 'live') {
    console.log('PASS: live application initialized. No provider calls or writes were made. Run npm run doctor to verify access.');
    return;
  }
  const scan = await (await post('/api/scan', { project: config.project })).json();
  if (!scan.complete || scan.mismatches?.length !== 5) throw new Error('Synthetic scenario did not produce five complete findings.');
  const finding = scan.mismatches.find(item => item.id === 'rule1-108-SHOP-241');
  const preview = await (await post('/api/preview', { project: config.project, mismatch_id: finding.id })).json();
  if (!preview.approval_token) throw new Error('Synthetic action preview failed.');
  const action = await (await post('/api/execute', { project: config.project, approval_token: preview.approval_token, approved: true })).json();
  if (action.changed !== true) throw new Error('Synthetic approved action failed.');
  const verified = await (await post('/api/scan', { project: config.project })).json();
  if (verified.mismatches?.length !== 4 || !verified.diff?.resolved?.includes(finding.id)) throw new Error('Synthetic action could not be verified.');
  console.log('PASS: assets, health, five findings, exact preview, simulated approval, and verified five-to-four result.');
  console.log('No external providers were contacted.');
}

export async function main(args = process.argv.slice(2)) {
  checkNodeVersion();
  process.chdir(ROOT);
  await import('../src/load-env.js');
  const options = parseArguments(args);
  if (options.help) { console.log(USAGE); return; }
  selectMode(options.mode);
  const { handleRequest } = await import('../src/http-app.js');
  // Eager initialization catches bad live configuration before printing a ready URL.
  const ready = await handleRequest(new Request('http://127.0.0.1/api/config'));
  if (!ready.ok) throw new Error((await ready.json()).error || 'Application initialization failed.');
  if (options.check) return checkApplication(options, handleRequest);
  const { startServer, attachShutdown } = await import('../src/http-server.js');
  const started = await startWithAvailablePort(options, params => startServer({ ...params, handler: handleRequest }));
  attachShutdown(started.server);
  console.log(`\nProjectSync is running: ${started.url}`);
  console.log(options.mode === 'demo'
    ? 'Mode: SYNTHETIC SAMPLE — offline rehearsal; no external writes.'
    : 'Mode: LIVE INTEGRATIONS — scans use your accounts; provider writes require explicit approval.');
  console.log('Open the URL in your browser. Stop with Ctrl+C.');
  return started;
}

const isDirect = process.argv[1] && existsSync(process.argv[1]) && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
if (isDirect) {
  try { await main(); }
  catch (error) {
    console.error(error.code === 'ERR_MODULE_NOT_FOUND'
      ? 'ProjectSync dependencies or files are missing. In a source checkout run npm ci; otherwise extract the complete deliverable archive.'
      : `ProjectSync could not start: ${error.message}`);
    process.exitCode = 1;
  }
}
