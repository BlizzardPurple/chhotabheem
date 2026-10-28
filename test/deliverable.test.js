import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { allowedPath, collectFiles, packageDeliverable } from '../scripts/package-deliverable.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const textField = (bytes, start, length) => bytes.subarray(start, start + length).toString('utf8').split('\0')[0];
function unpack(buffer) {
  const tar = gunzipSync(buffer), files = new Map();
  for (let at = 0; at + 512 <= tar.length; ) {
    const block = tar.subarray(at, at + 512);
    if (block.every(byte => byte === 0)) break;
    const storedSum = parseInt(textField(block, 148, 8).trim(), 8);
    const actualSum = block.reduce((sum, byte, offset) => sum + (offset >= 148 && offset < 156 ? 32 : byte), 0);
    assert.equal(storedSum, actualSum, 'tar header checksum');
    const name = [textField(block, 345, 155), textField(block, 0, 100)].filter(Boolean).join('/');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    const size = parseInt(textField(block, 124, 12), 8);
    assert.equal(textField(block, 156, 1), '0', 'only ordinary files may be included');
    files.set(name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'projectsync-deliverable-'));
  const contents = {
    'src/http-app.js': 'export const handleRequest = () => new Response("ok");',
    'src/runtime.js': 'export const mode = "demo";',
    'public/index.html': '<main>ProjectSync</main>',
    'scripts/hackathon.mjs': 'console.log("synthetic");',
    'node_modules/@modelcontextprotocol/sdk/package.json': '{"name":"@modelcontextprotocol/sdk"}',
    'node_modules/example/index.js': 'export const demo = true;',
    'package.json': '{"name":"project-sync","version":"0.2.0","type":"module"}',
    'package-lock.json': '{}',
    '.env.example': 'GITLAB_PROJECT=YOUR_GROUP/YOUR_PROJECT',
    'START-HERE.md': 'Run node scripts/hackathon.mjs',
    '.env': 'SECRET=must-not-export',
    '.env.production': 'SECRET=must-not-export-production',
    'src/.env.local': 'SECRET=must-not-export-nested',
    'src/private.key': 'must-not-export-key',
    'src/credentials.json': '{"secret":"must-not-export-json"}',
    '.aws/credentials': 'must-not-export-aws',
    '.local/notebook.json': 'must-not-export-notebook',
    'node_modules/.npmrc': '//registry/:_authToken=must-not-export-npm',
  };
  for (const [name, content] of Object.entries(contents)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

test('deliverable is deterministic, self-contained and excludes credential paths and all symlinks', async () => {
  const root = await fixture();
  try {
    await symlink(join(root, '.aws/credentials'), join(root, 'src/private-link'));
    await symlink(join(root, '.aws'), join(root, 'src/external-directory'));
    const first = await packageDeliverable({ root });
    const bytes = await readFile(join(root, 'dist', first.archive));
    const second = await packageDeliverable({ root });
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.sha256, checksum(bytes));
    assert.deepEqual(bytes, await readFile(join(root, 'dist', second.archive)));
    const entries = unpack(bytes);
    assert.ok(entries.has('projectsync-hackathon/node_modules/example/index.js'));
    assert.ok(entries.has('projectsync-hackathon/.env.example'));
    assert.ok(!Buffer.concat([...entries.values()]).toString('utf8').includes('must-not-export'));
    assert.ok([...entries.keys()].every(name => !name.includes('private-link') && !name.includes('external-directory')));
    const manifest = JSON.parse(entries.get('projectsync-hackathon/DELIVERABLE-MANIFEST.json'));
    assert.equal(manifest.fileCount + 1, entries.size);
    for (const file of manifest.files) {
      const data = entries.get(`projectsync-hackathon/${file.path}`);
      assert.equal(file.bytes, data.length);
      assert.equal(file.sha256, checksum(data));
      assert.ok(!file.path.includes(root), 'manifest must never contain workstation paths');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('portable delivery refuses native dependencies and missing runtime inputs', async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, 'node_modules/example/addon.node'), 'not-portable');
    await assert.rejects(collectFiles(root), /Native dependency/);
    await rm(join(root, 'node_modules/example/addon.node'));
    await rm(join(root, 'scripts/hackathon.mjs'));
    await assert.rejects(packageDeliverable({ root }), /Missing scripts\/hackathon.mjs/);
    assert.equal(allowedPath('../outside'), false);
    assert.equal(allowedPath('src/.env.example'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('extracted real bundle runs the full synthetic HTTP approval flow without package install or network', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'projectsync-offline-'));
  try {
    const receipt = await packageDeliverable({ root: ROOT, outputDirectory: destination });
    const files = unpack(await readFile(join(destination, receipt.archive)));
    for (const [name, data] of files) {
      const path = join(destination, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }
    const program = `
      globalThis.fetch = () => { throw new Error('An offline rehearsal must not contact providers'); };
      const { handleRequest } = await import('./src/http-app.js');
      const call = async (path, body) => {
        const response = await handleRequest(new Request('http://127.0.0.1:3031' + path, body ? {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        } : {}));
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      };
      const config = await call('/api/config');
      if (config.mode !== 'demo') throw new Error('Must default to synthetic mode');
      const project = config.project;
      const before = await call('/api/scan', { project });
      const plan = await call('/api/preview', { project, mismatch_id: before.mismatches[0].id });
      const action = await call('/api/execute', { project, approval_token: plan.approval_token, approved: true });
      const after = await call('/api/scan', { project });
      console.log(JSON.stringify({ before: before.mismatches.length, changed: action.changed, after: after.mismatches.length }));
    `;
    const env = { PATH: process.env.PATH || '', PROJECTSYNC_MODE: 'demo' };
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: join(destination, 'projectsync-hackathon'), env, encoding: 'utf8', timeout: 15_000,
    });
    assert.deepEqual(JSON.parse(output), { before: 5, changed: true, after: 4 });
  } finally { await rm(destination, { recursive: true, force: true }); }
});
