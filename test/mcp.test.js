import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

test("real stdio MCP handshake exposes six tools and completes the reviewed fixture workflow", async () => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../src/server.js", import.meta.url))],
    env: { ...process.env, PROJECTSYNC_MODE: "demo" }, stderr: "pipe" });
  const client = new Client({ name: "projectsync-regression", version: "1.0" });
  let stderr = "";
  transport.stderr?.on("data", data => { stderr += data; });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ["scan", "reconcile", "repo_status", "get_sync_log", "session_diff", "jira_to_mr"].sort());
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return JSON.parse(response.content[0].text);
    };
    const project = "demo/checkout-service";
    assert.equal((await call("scan", { project })).mismatches.length, 5);
    const invalid = await client.callTool({ name: "reconcile", arguments: { project, mismatch_number: 1.5 } });
    assert.equal(invalid.isError, true);
    const plan = await call("reconcile", { project, mismatch_number: 1 });
    assert.equal(plan.action, "jira_transition");
    const result = await call("reconcile", { project, approved: true, approval_token: plan.approval_token });
    assert.equal(result.changed, true);
    assert.equal((await call("session_diff", { project })).mismatches.length, 4);
    assert.ok((await call("get_sync_log", { project })).events.some(e => e.type === "action_completed"));
    const branchPlan = await call("jira_to_mr", { project, jira_key: "SHOP-241" });
    assert.equal(branchPlan.status, "awaiting_approval");
    const branch = await call("jira_to_mr", { approved: true, approval_token: branchPlan.approval_token });
    assert.equal(branch.status, "branch_prepared");
  } finally { await client.close(); }
  assert.doesNotMatch(stderr, /SyntaxError|UnhandledPromiseRejection/);
});
