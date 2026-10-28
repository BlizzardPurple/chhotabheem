import test from "node:test";
import assert from "node:assert/strict";
import { createJiraToMr, jiraText } from "../src/tools/jira-to-mr.js";

const params = { jira_key: "DEMO-1", project: "team/demo" };
function setup(overrides = {}) {
  const calls = [];
  let timestamp = Date.parse("2026-10-28T12:00:00Z");
  let issue = { key: "DEMO-1", fields: { summary: "Improve reporting", description: "Ship reliable reports" } };
  let project = { id: 7, path_with_namespace: "team/demo", default_branch: "develop" };
  let seq = 0;
  const gitlab = {
    getProject: async () => project,
    listMRs: async () => [],
    getBranch: async (_, branch) => ({ name: branch }),
    createBranch: async (_, branch) => { calls.push("createBranch"); return { name: branch }; },
    compareBranches: async () => ({ commits: [{ id: "sha" }], diffs: [{ new_path: "app.js", diff: "+report" }] }),
    createMR: async (pid, branch, target, title, description) => {
      calls.push("createMR"); return { iid: 42, web_url: "https://gitlab.example/team/demo/-/merge_requests/42", source_branch: branch, target_branch: target, title, description };
    },
    ...overrides.gitlab,
  };
  const jira = { viewIssue: async () => issue, moveIssue: async () => assert.fail("Jira status must never be changed"), ...overrides.jira };
  const tool = createJiraToMr({ gitlab, jira, now: () => timestamp, tokenFactory: () => `token-${++seq}`, jiraUrl: "https://jira.example" });
  return { ...tool, calls, setIssue: value => { issue = value; }, setProject: value => { project = value; }, advance: value => { timestamp += value; } };
}
const notFound = () => Object.assign(new Error("not found"), { status: 404 });

test("preview gives exact plan without writes; explicit approval creates one draft MR", async () => {
  const tool = setup();
  const preview = await tool.preview(params);
  assert.equal(preview.status, "awaiting_approval");
  assert.equal(preview.proposal.branch, "DEMO-1_improve-reporting");
  assert.equal(preview.proposal.target_branch, "develop");
  assert.equal(preview.proposal.title, "Draft: DEMO-1 Improve reporting");
  assert.match(preview.proposal.description, /https:\/\/jira.example\/browse\/DEMO-1/);
  assert.deepEqual(tool.calls, []);
  await assert.rejects(tool.execute({ approval_token: preview.approval_token }), /Explicit approval/);
  const result = await tool.execute({ approval_token: preview.approval_token, approved: true });
  assert.equal(result.status, "mr_created");
  assert.deepEqual(tool.calls, ["createMR"]);
  const replay = await tool.execute({ approval_token: preview.approval_token, approved: true });
  assert.equal(replay.replayed, true);
  assert.equal(replay.mr.iid, 42);
  assert.deepEqual(tool.calls, ["createMR"]);
});

test("missing requirements return questions, including when only one answer is supplied", async () => {
  const tool = setup();
  tool.setIssue({ key: "DEMO-1", fields: {} });
  assert.equal((await tool.preview(params)).questions.length, 2);
  const partial = await tool.preview({ ...params, answers: { q1: "A good title" } });
  assert.deepEqual(partial.questions.map(item => item.id), ["q2"]);
  const ready = await tool.preview({ ...params, answers: { q1: "A good title", q2: "Acceptance criteria" } });
  assert.equal(ready.status, "awaiting_approval");
  assert.deepEqual(tool.calls, []);
});

test("Jira ADF is flattened into readable requirements", async () => {
  const description = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ship " }, { type: "text", text: "reports" }] }, { type: "paragraph", content: [{ type: "text", text: "Validate results" }] }] };
  assert.equal(jiraText(description).trim(), "Ship reports\nValidate results");
  const tool = setup();
  tool.setIssue({ key: "DEMO-1", fields: { summary: "Reporting", description } });
  assert.match((await tool.preview(params)).proposal.description, /Ship reports\nValidate results/);
});

test("changed issue or default target invalidates the approved plan before writes", async () => {
  for (const change of [tool => tool.setIssue({ key: "DEMO-1", fields: { summary: "Changed", description: "Ship reliable reports" } }),
    tool => tool.setProject({ id: 7, path_with_namespace: "team/demo", default_branch: "main" })]) {
    const tool = setup();
    const { approval_token } = await tool.preview(params);
    change(tool);
    await assert.rejects(tool.execute({ approval_token, approved: true }), /changed since preview/);
    assert.deepEqual(tool.calls, []);
  }
});

test("expired approvals and mismatched Jira keys fail without writes", async () => {
  const tool = setup();
  const { approval_token } = await tool.preview(params);
  tool.advance(5 * 60_000);
  await assert.rejects(tool.execute({ approval_token, approved: true }), /expired/);
  tool.setIssue({ key: "OTHER-1", fields: {} });
  await assert.rejects(tool.preview(params), /different issue key/);
  assert.deepEqual(tool.calls, []);
});

test("only a 404 creates a branch; an empty diff prepares work without claiming an MR exists", async () => {
  const tool = setup({ gitlab: { getBranch: async () => { throw notFound(); }, compareBranches: async () => ({ commits: [], diffs: [], compare_same_ref: true }) } });
  const { approval_token } = await tool.preview(params);
  const result = await tool.execute({ approval_token, approved: true });
  assert.equal(result.status, "branch_prepared");
  assert.equal(result.branch_created, true);
  assert.match(result.message, /Push your changes/);
  assert.deepEqual(tool.calls, ["createBranch"]);
});

test("authorization errors are not mistaken for missing branches", async () => {
  const tool = setup({ gitlab: { getBranch: async () => { throw Object.assign(new Error("GitLab access forbidden"), { status: 403 }); } } });
  const { approval_token } = await tool.preview(params);
  await assert.rejects(tool.execute({ approval_token, approved: true }), /forbidden/);
  assert.deepEqual(tool.calls, []);
});

test("matching open MR is reused without new branches or writes", async () => {
  const tool = setup({ gitlab: { listMRs: async () => [{ iid: 17, source_branch: "DEMO-1_improve-reporting", target_branch: "develop", state: "opened" }], getBranch: async () => assert.fail("Do not inspect branch after finding existing MR") } });
  const { approval_token } = await tool.preview(params);
  const result = await tool.execute({ approval_token, approved: true });
  assert.equal(result.status, "mr_exists"); assert.equal(result.mr.iid, 17);
  assert.deepEqual(tool.calls, []);
});

test("an uncertain mutation outcome blocks token replay", async () => {
  let writes = 0;
  const tool = setup({ gitlab: { createMR: async () => { writes++; throw new Error("Request timed out"); } } });
  const { approval_token } = await tool.preview(params);
  await assert.rejects(tool.execute({ approval_token, approved: true }), /write was attempted.*blocked/);
  await assert.rejects(tool.execute({ approval_token, approved: true }), /cannot be retried/);
  assert.equal(writes, 1);
});

test("concurrent executions cannot duplicate a write", async () => {
  let release;
  let writes = 0;
  const tool = setup({ gitlab: { createMR: async () => {
    writes++;
    await new Promise(resolve => { release = resolve; });
    return { iid: 42, web_url: "https://gitlab.example/mr/42" };
  } } });
  const { approval_token } = await tool.preview(params);
  const first = tool.execute({ approval_token, approved: true });
  await assert.rejects(tool.execute({ approval_token, approved: true }), /already being executed/);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release();
  assert.equal((await first).status, "mr_created");
  assert.equal(writes, 1);
});

test("editing a returned proposal does not modify server-side approved intent", async () => {
  const tool = setup();
  const preview = await tool.preview(params);
  preview.proposal.target_branch = "dangerous-other-target";
  const result = await tool.execute({ approval_token: preview.approval_token, approved: true });
  assert.equal(result.mr.target_branch, "develop");
});

test("comparison failures after branch creation report partial work rather than no diff", async () => {
  const tool = setup({ gitlab: { getBranch: async () => { throw notFound(); }, compareBranches: async () => { throw new Error("GitLab unavailable"); } } });
  const { approval_token } = await tool.preview(params);
  await assert.rejects(tool.execute({ approval_token, approved: true }), /GitLab unavailable.*branch was created/);
  assert.deepEqual(tool.calls, ["createBranch"]);
  await assert.rejects(tool.execute({ approval_token, approved: true }), /cannot be retried/);
});
