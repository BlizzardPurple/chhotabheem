import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRuntime } from "../src/runtime.js";
import { createHttpApp } from "../src/http-app.js";
import { startServer } from "../src/http-server.js";

// Exercise the actual HTTP boundary on a temporary port. No provider adapter is used.
const report = { product: "ProjectSync", mode: "synthetic", started_at: new Date().toISOString(),
  node: process.version, external_writes: false, steps: [],
  limitations: ["Synthetic providers only; live authentication, permissions, and organization workflows require a separate sandbox rehearsal."] };
const root = new URL("../", import.meta.url);
const app = createHttpApp({ runtimeFactory: () => createRuntime({ mode: "demo" }), publicDemo: false });
let running;
try {
  running = await startServer({ port: 0, host: "127.0.0.1", handler: app });
  const api = async (path, body) => {
    const response = await fetch(`${running.url}${path}`, { signal: AbortSignal.timeout(10_000),
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json", Origin: running.url }, body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, `${path} failed (${response.status}): ${await response.clone().text()}`);
    return response.json();
  };
  const step = async (name, work) => {
    const started = performance.now();
    await work();
    report.steps.push({ name, status: "passed", elapsed_ms: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  };
  let project, current;
  await step("Application starts with synthetic data and no credentials", async () => {
    assert.equal((await api("/health")).status, "ok");
    const config = await api("/api/config");
    assert.equal(config.mode, "demo"); assert.equal(config.readOnly, false); project = config.project;
  });
  await step("Console and five-slide presentation are served", async () => {
    for (const path of ["/", "/app.js", "/styles.css", "/pitch", "/pitch.css", "/pitch.js"]) {
      const response = await fetch(`${running.url}${path}`);
      assert.equal(response.status, 200, path); assert.ok((await response.text()).length > 0);
    }
  });
  await step("Initial scan returns five evidence-backed findings", async () => {
    current = await api("/api/scan", { project });
    assert.equal(current.complete, true); assert.equal(current.mismatches.length, 5);
    assert.ok(current.mismatches.every(f => f.evidence.length));
  });
  const actions = [
    ["MR merged, ticket still open", 4], ["Pipeline failed, no bug ticket", 3],
    ["No release notes", 2], ["Branch with no MR", 1], ["Review pending too long", 1],
  ];
  for (const [rule, remaining] of actions) await step(`${rule}: preview → approval → verification`, async () => {
    const finding = current.mismatches.find(f => f.rule === rule);
    assert.ok(finding, rule);
    const preview = await api("/api/preview", { project, mismatch_id: finding.id });
    assert.ok(preview.payload); assert.ok(preview.approval_token);
    const denied = await fetch(`${running.url}/api/execute`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, approval_token: preview.approval_token, approved: false }) });
    assert.equal(denied.status, 400);
    const args = { project, approval_token: preview.approval_token, approved: true };
    const result = await api("/api/execute", args);
    assert.equal(result.changed, rule !== "Review pending too long");
    assert.equal((await api("/api/execute", args)).replayed, true);
    current = await api("/api/scan", { project });
    assert.equal(current.mismatches.length, remaining); assert.equal(current.complete, true);
  });
  await step("History records five actions, and reset restores the starting scenario", async () => {
    const events = await api(`/api/events?project=${encodeURIComponent(project)}`);
    assert.equal(events.filter(e => e.type === "action_completed").length, 5);
    await api("/api/reset", {});
    assert.equal((await api("/api/scan", { project })).mismatches.length, 5);
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = error.message; process.exitCode = 1;
  console.error(`FAIL ${error.message}`);
} finally {
  if (running) { running.server.closeIdleConnections(); await new Promise(resolve => running.server.close(resolve)); }
  report.completed_at = new Date().toISOString();
  await mkdir(new URL("dist/", root), { recursive: true });
  const target = new URL("dist/rehearsal.json", root);
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Rehearsal report: ${fileURLToPath(target)}`);
}
