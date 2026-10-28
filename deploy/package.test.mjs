import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('deployment package is reproducible and excludes credentials and external symlinks', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'projectsync-package-'));
  try {
    for (const directory of ['scripts', 'src', 'public', 'deploy', 'node_modules/example', '.aws']) {
      await mkdir(join(fixture, directory), { recursive: true });
    }
    await copyFile(new URL('../scripts/aws.py', import.meta.url), join(fixture, 'scripts/aws.py'));
    for (const [name, contents] of Object.entries({
      'src/http-app.js': 'export const handleRequest = () => new Response("demo");',
      'deploy/lambda.mjs': 'export const handler = () => {};',
      'public/index.html': '<main>Demo</main>',
      'package.json': '{"type":"module"}',
      'package-lock.json': '{}',
      'node_modules/example/index.js': 'export const version = 1;',
      '.env': 'PRIVATE=must-not-upload',
      'src/.env.local': 'PRIVATE=must-not-upload-either',
      '.aws/credentials': 'PRIVATE=never-upload',
    })) await writeFile(join(fixture, name), contents);
    await symlink(join(fixture, '.aws/credentials'), join(fixture, 'src/credential-link'));
    const run = () => JSON.parse(execFileSync('python3', ['scripts/aws.py', 'package'], { cwd: fixture, encoding: 'utf8' }));
    const first = run();
    const firstBytes = await readFile(join(fixture, first.archive));
    const second = run();
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(await readFile(join(fixture, second.archive)), firstBytes);
    const names = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', first.archive], { cwd: fixture, encoding: 'utf8' }));
    assert.ok(names.includes('public/index.html'));
    assert.ok(names.includes('node_modules/example/index.js'));
    assert.ok(names.every(name => !name.includes('.env') && !name.includes('.aws') && !name.includes('credential-link')));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
