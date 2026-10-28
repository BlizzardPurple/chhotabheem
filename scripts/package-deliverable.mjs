#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PREFIX = 'projectsync-hackathon';
const INPUTS = ['src', 'public', 'docs', 'scripts', 'test', 'deploy', 'node_modules',
  '.github/workflows', '.gitlab-ci.yml', '.env.example', 'package.json', 'package-lock.json',
  'README.md', 'SETUP.md', 'START-HERE.md', 'DESIGN.md', 'SCOPE.md', 'TASKS.md', 'Dockerfile', '.dockerignore',
  'dist/rehearsal.json', 'dist/browser-rehearsal.json', 'dist/ProjectSync-pitch.pdf',
  'dist/recording/demo.webm', 'dist/recording/sample-evidence.json'];
const REQUIRED = ['src/http-app.js', 'src/runtime.js', 'scripts/hackathon.mjs', 'public/index.html',
  'node_modules/@modelcontextprotocol/sdk/package.json', 'package.json', 'package-lock.json', 'START-HERE.md', '.env.example'];
const BLOCKED = new Set(['.git', '.aws', '.codex', '.agents', '.local', '.bin', '.npmrc', '.netrc',
  '.DS_Store', '__pycache__', 'credentials', 'credentials.json', 'credentials.yml', 'credentials.yaml']);
const hash = data => createHash('sha256').update(data).digest('hex');
const slash = value => value.split(sep).join('/');

export function allowedPath(path) {
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || BLOCKED.has(part))) return false;
  if (parts.some(part => part === '.env' || part.startsWith('.env.'))) return path === '.env.example';
  return !/\.(?:pem|key|p12|pfx|log|pyc)$/i.test(path);
}

/** Traverse only explicit package inputs. Never follow either file or directory links. */
export async function collectFiles(root) {
  const files = [];
  async function visit(path) {
    const name = slash(relative(root, path));
    if (!allowedPath(name)) return;
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry));
    } else if (stat.isFile()) {
      if (name.endsWith('.node')) throw new Error(`Native dependency found at ${name}; this bundle promises portable JavaScript dependencies.`);
      files.push({ path: name, data: await readFile(path) });
    }
  }
  for (const input of INPUTS) {
    try { await visit(join(root, input)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function putText(header, text, start, size) {
  const bytes = Buffer.from(text);
  if (bytes.length > size) throw new Error(`Archive field too long: ${text}`);
  bytes.copy(header, start);
}
function octal(header, value, start, length) {
  const digits = value.toString(8).padStart(length - 1, '0');
  if (digits.length >= length) throw new Error('Archive value exceeds portable tar limit.');
  putText(header, `${digits}\0`, start, length);
}
function header(path, size) {
  const block = Buffer.alloc(512);
  let name = path, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const splits = [...path.matchAll(/\//g)].map(match => match.index).reverse();
    const split = splits.find(index => Buffer.byteLength(path.slice(0, index)) <= 155 && Buffer.byteLength(path.slice(index + 1)) <= 100);
    if (split === undefined) throw new Error(`Path exceeds portable tar limit: ${path}`);
    prefix = path.slice(0, split); name = path.slice(split + 1);
  }
  putText(block, name, 0, 100);
  octal(block, 0o644, 100, 8);
  octal(block, 0, 108, 8); octal(block, 0, 116, 8);
  octal(block, size, 124, 12); octal(block, 0, 136, 12);
  block.fill(32, 148, 156);
  putText(block, '0', 156, 1);
  putText(block, 'ustar\0', 257, 6); putText(block, '00', 263, 2);
  putText(block, prefix, 345, 155);
  const checksum = block.reduce((total, value) => total + value, 0);
  putText(block, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

/** Stable tar headers and gzip timestamp give repeatable bytes for identical inputs. */
export function createArchive(files) {
  const chunks = [];
  for (const file of files) {
    chunks.push(header(`${PREFIX}/${file.path}`, file.data.length), file.data);
    const padding = (512 - file.data.length % 512) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

export async function packageDeliverable({ root = ROOT, outputDirectory = join(root, 'dist') } = {}) {
  const files = await collectFiles(root);
  const names = new Set(files.map(file => file.path));
  for (const required of REQUIRED) if (!names.has(required)) throw new Error(`Missing ${required}. Finish the application and run npm ci before packaging.`);
  const pkg = JSON.parse(files.find(file => file.path === 'package.json').data.toString('utf8'));
  const manifest = {
    name: pkg.name, version: pkg.version, format: 1,
    runtime: 'Node.js 20.12+; Node.js 22 or 24 recommended. Node runtime is not bundled.',
    launch: 'node scripts/hackathon.mjs', liveLaunch: 'node scripts/hackathon.mjs --live',
    mode: 'Synthetic rehearsal by default. Live mode requires locally configured provider access.',
    verification: 'Manifest verifies packaged bytes; it is not evidence of a live provider rehearsal.',
    fileCount: files.length,
    files: files.map(file => ({ path: file.path, bytes: file.data.length, sha256: hash(file.data) })),
  };
  files.push({ path: 'DELIVERABLE-MANIFEST.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  const archive = createArchive(files);
  const archiveName = `${PREFIX}.tar.gz`;
  const receipt = { archive: archiveName, sha256: hash(archive), bytes: archive.length,
    packagedFiles: files.length, dependencyInstallationRequired: false,
    runtimeBundled: false, credentialPathsExcluded: true };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, archiveName), archive);
  await writeFile(join(outputDirectory, 'projectsync-hackathon.sha256'), `${receipt.sha256}  ${archiveName}\n`);
  await writeFile(join(outputDirectory, 'projectsync-hackathon.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await packageDeliverable(), null, 2)); }
  catch (error) { console.error(`Deliverable packaging failed: ${error.message}`); process.exitCode = 1; }
}
