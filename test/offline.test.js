import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the delivered CLI actually starts when reached through a symlink or macOS temporary-directory alias", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "projectsync-launch-alias-"));
  try {
    const alias = join(temporary, "checkout");
    await symlink(fileURLToPath(new URL("../", import.meta.url)), alias, "dir");
    const { stdout } = await promisify(execFile)(process.execPath, [join(alias, "scripts/hackathon.mjs"), "--check"], { cwd: temporary, timeout: 10_000 });
    assert.match(stdout, /PASS: assets, health, five findings/);
    assert.match(stdout, /No external providers were contacted/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("explicit sample mode remains runnable despite incomplete live provider credentials", async () => {
  const code = `import {createRuntime} from './src/runtime.js'; const app=await createRuntime({mode:'demo'}); const report=await app.workflow.scan(app.project); console.log(JSON.stringify({count:report.mismatches.length,complete:report.complete}));`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, GITLAB_HOST: "not a valid host", JIRA_TRANSPORT: "rest", JIRA_URL: "", JIRA_EMAIL: "", JIRA_API_TOKEN: "incomplete-placeholder", JIRA_TOKEN: "" },
  });
  assert.deepEqual(JSON.parse(stdout), { count: 5, complete: true });
});
