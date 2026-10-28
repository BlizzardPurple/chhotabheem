import test from "node:test";
import assert from "node:assert/strict";
import { createScanner, redactLog } from "../src/tools/scan.js";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const project = { id: 7, name: "Demo", path_with_namespace: "team/demo", default_branch: "develop", web_url: "https://gitlab.example/team/demo" };
const merged = { iid: 41, source_branch: "DEMO-41-fix", title: "Fix reporting", merged_at: "2026-10-27T10:00:00Z", web_url: `${project.web_url}/-/merge_requests/41` };
const open = { iid: 42, source_branch: "DEMO-42-review", title: "Review reporting", created_at: "2026-10-20T10:00:00Z", reviewers: [{ name: "Alex" }] };
const branch = { name: "DEMO-43-draft", commit: { created_at: "2026-10-27T10:00:00Z", title: "Reporting change", id: "sha" } };
function setup(overrides = {}) {
  const calls = [];
  const gitlab = {
    getProject: async () => project,
    listMRs: async (_, params) => { calls.push(["listMRs", params]); return params.state === "merged" ? [merged] : [open]; },
    listPipelines: async (_, params) => { calls.push(["listPipelines", params]); return [{ id: 500, status: "failed", web_url: `${project.web_url}/-/pipelines/500` }]; },
    getPipelineJobs: async () => [{ id: 501, name: "unit", status: "failed" }],
    getJobLog: async () => "ERROR assert failed; TOKEN=secret-token",
    getMRApprovals: async () => ({ approved: false }),
    listBranches: async () => [branch],
    compareBranches: async () => ({ commits: [{ id: "sha" }] }),
    ...overrides.gitlab,
  };
  const jira = {
    viewIssue: async () => ({ fields: { status: { name: "In Progress", statusCategory: { key: "indeterminate" } } } }),
    findPipelineIssues: async () => [], ...overrides.jira,
  };
  const gdrive = { searchDrive: async query => { calls.push(["searchDrive", query]); return []; }, ...overrides.gdrive };
  const scanner = createScanner({ gitlab, jira, gdrive, now: () => NOW, jiraProject: "DEMO", ...overrides.options });
  return { ...scanner, calls };
}

test("five rules produce evidence-backed deterministic findings and retain array compatibility", async () => {
  const scanner = setup();
  const report = await scanner.scanDetailed("team/demo");
  assert.equal(report.complete, true);
  assert.equal(report.mismatches.length, 5);
  assert.equal(report.scannedAt, "2026-10-28T12:00:00.000Z");
  for (const item of report.mismatches) {
    assert.ok(item.evidence.length);
    assert.equal(item.details.project_id, 7);
    assert.equal(item.details.default_branch, "develop");
  }
  assert.match(report.mismatches[1].details.log_excerpt, /TOKEN=\[REDACTED\]/);
  assert.equal((await scanner.scan("team/demo")).length, 5);
  const mrCalls = scanner.calls.filter(call => call[0] === "listMRs");
  assert.ok(mrCalls.every(call => call[1].all));
});

test("Jira done category is authoritative even for a custom status name", async () => {
  const { scanDetailed } = setup({ jira: { viewIssue: async () => ({ fields: { status: { name: "Released to customers", statusCategory: { key: "done" } } } }) } });
  assert.ok(!(await scanDetailed("demo")).mismatches.some(item => item.id.startsWith("rule1")));
});

test("unknown Jira status and failed requests degrade coverage instead of claiming synchronization", async () => {
  for (const viewIssue of [async () => "unparseable", async () => { throw new Error("Jira unavailable"); }]) {
    const report = await setup({ jira: { viewIssue } }).scanDetailed("demo");
    assert.equal(report.complete, false);
    assert.equal(report.checks[0].status, "degraded");
    assert.ok(!report.mismatches.some(item => item.id.startsWith("rule1")));
    assert.ok(report.mismatches.some(item => item.id.startsWith("rule5")));
  }
});

test("successful latest pipeline does not resurrect historical failures", async () => {
  const scanner = setup({ gitlab: { listPipelines: async (_, params) => {
    assert.equal(params.status, undefined);
    assert.equal(params.ref, "develop");
    return [{ id: 501, status: "success" }];
  } }, jira: { findPipelineIssues: async () => { assert.fail("No Jira lookup for a healthy pipeline"); } } });
  assert.ok(!(await scanner.scanDetailed("demo")).mismatches.some(item => item.id.startsWith("rule2")));
});

test("existing tracking or inaccessible Jira never produces a no-ticket claim", async () => {
  const tracked = await setup({ jira: { findPipelineIssues: async () => [{ key: "DEMO-99" }] } }).scanDetailed("demo");
  assert.ok(!tracked.mismatches.some(item => item.id.startsWith("rule2")));
  const unknown = await setup({ jira: { findPipelineIssues: async () => { throw new Error("Forbidden"); } } }).scanDetailed("demo");
  assert.ok(!unknown.mismatches.some(item => item.id.startsWith("rule2")));
  assert.equal(unknown.checks[1].status, "degraded");
});

test("failed pipeline without configured Jira project is visibly unverified", async () => {
  const report = await setup({ options: { jiraProject: null } }).scanDetailed("demo");
  assert.equal(report.checks[1].status, "degraded");
  assert.match(report.checks[1].message, /Pipeline #500.*tracking is unknown/);
});

test("approved MRs and drafts are not flagged as waiting for review", async () => {
  const report = await setup({ gitlab: { getMRApprovals: async () => ({ approved: true }) } }).scanDetailed("demo");
  assert.ok(!report.mismatches.some(item => item.id.startsWith("rule3")));
});

test("Drive queries are project scoped and unavailable Drive is not reported as clean", async () => {
  const scanner = setup();
  await scanner.scanDetailed("demo");
  const query = scanner.calls.find(call => call[0] === "searchDrive")[1];
  assert.match(query, /team\/demo — Release Notes/);
  assert.match(query, /trashed = false/);
  const report = await setup({ gdrive: { searchDrive: async () => { throw new Error("Drive unavailable"); } } }).scanDetailed("demo");
  assert.equal(report.checks[3].status, "degraded");
  assert.ok(!report.mismatches.some(item => item.id.startsWith("rule4")));
});

test("branches at default HEAD and protected/default branches are not orphan work", async () => {
  const report = await setup({ gitlab: {
    listBranches: async () => [branch, { ...branch, name: "develop" }, { ...branch, name: "release", protected: true }],
    compareBranches: async (_, from, to) => {
      assert.equal(from, "develop"); assert.equal(to, branch.name);
      return { commits: [] };
    },
  } }).scanDetailed("demo");
  assert.ok(!report.mismatches.some(item => item.id.startsWith("rule5")));
});

test("unavailable MR listing leaves pipeline rule usable and marks dependent rules degraded", async () => {
  const report = await setup({ gitlab: { listMRs: async () => { throw new Error("GitLab timeout"); } } }).scanDetailed("demo");
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].id, "rule2-500");
  assert.equal(report.checks.filter(check => check.status === "degraded").length, 4);
});

test("old merged MRs do not create release-note or ticket drift claims", async () => {
  const report = await setup({ gitlab: { listMRs: async (_, params) => params.state === "merged" ? [{ ...merged, merged_at: "2026-08-01T10:00:00Z" }] : [] } }).scanDetailed("demo");
  assert.ok(!report.mismatches.some(item => /^rule[134]/.test(item.id)));
});

test("known secret patterns are redacted from excerpts", () => {
  assert.equal(redactLog("authorization: Bearer hidden\npassword=secret\nglpat-abcdef"), "authorization: [REDACTED]\npassword=[REDACTED]\n[REDACTED]");
});
