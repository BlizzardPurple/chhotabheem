import test from "node:test";
import assert from "node:assert/strict";
import { createGitlabClient, parseGitlabAuthToken } from "../src/clients/gitlab.js";
import { createJiraClient, extractJiraKey, isDone } from "../src/clients/jira.js";
import { createDriveClient } from "../src/clients/gdrive.js";
const json = (data, headers = {}) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json", ...headers } });

test("glab authentication parser supports both token labels and rejects masked output", () => {
  assert.equal(parseGitlabAuthToken("✓ Token: test-credential"), "test-credential");
  assert.equal(parseGitlabAuthToken("\u001b[32m✓ Token found: test-credential\u001b[0m"), "test-credential");
  for (const value of ["********", "glpat-abc***", "glpat-abc…", "glpat-abc...", "[REDACTED]", "<hidden>", "xxxxxxxx", "glpat-xxxxxxxx"]) {
    assert.equal(parseGitlabAuthToken(`Token found: ${value}`), null);
  }
  assert.equal(parseGitlabAuthToken("Token found:\nNo credential available"), null);
  assert.equal(parseGitlabAuthToken("Logged in without token information"), null);
});

test("Jira auto transport preserves existing CLI JIRA_API_TOKEN configuration", async () => {
  const previous = process.env.JIRA_API_TOKEN;
  process.env.JIRA_API_TOKEN = "existing-cli-token";
  try {
    let calls = 0;
    const client = createJiraClient({ transport: "auto", token: "", email: "", url: "", runCommand: async (command, args) => {
      calls++; assert.equal(command, "jira"); assert.equal(args[1], "view");
      return JSON.stringify({ key: "DEMO-1" });
    }, fetchImpl: async () => assert.fail("Incomplete REST credentials must preserve CLI transport") });
    assert.equal((await client.viewIssue("DEMO-1")).key, "DEMO-1");
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.JIRA_API_TOKEN;
    else process.env.JIRA_API_TOKEN = previous;
  }
});

test("explicit Jira CLI transport takes precedence over REST credentials", async () => {
  const client = createJiraClient({ transport: "cli", token: "bearer-token", apiToken: "api-token", email: "demo@example.com", url: "https://jira.example",
    runCommand: async () => JSON.stringify({ key: "DEMO-1" }), fetchImpl: async () => assert.fail("Explicit CLI mode must not issue HTTP requests") });
  assert.equal((await client.viewIssue("DEMO-1")).key, "DEMO-1");
});

test("explicit Jira REST transport validates incomplete Basic configuration", () => {
  assert.throws(() => createJiraClient({ transport: "rest", token: "", apiToken: "api-token", email: "", url: "https://jira.example" }), /JIRA_EMAIL/);
  assert.throws(() => createJiraClient({ transport: "rest", token: "", apiToken: "", email: "", url: "https://jira.example" }), /Jira REST authentication/);
  assert.throws(() => createJiraClient({ transport: "invalid" }), /JIRA_TRANSPORT/);
});

test("explicit Jira bearer token wins over an unrelated existing CLI API token", async () => {
  const client = createJiraClient({ transport: "auto", token: "bearer-token", apiToken: "cli-token", email: "", url: "https://jira.example",
    runCommand: async () => assert.fail("Bearer credentials select REST"), fetchImpl: async (_, init) => {
      assert.equal(init.headers.Authorization, "Bearer bearer-token");
      return json({ key: "DEMO-1" });
    } });
  assert.equal((await client.viewIssue("DEMO-1")).key, "DEMO-1");
});

test("GitLab encodes project and branch identifiers, scopes auth, and follows pagination", async () => {
  const calls = [];
  const client = createGitlabClient({ host: "https://gitlab.example", token: "test-token", fetchImpl: async (url, init) => {
    calls.push([url, init]);
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
    return url.includes("page=2") ? json([{ name: "second" }]) : json([{ name: "first" }], { "x-next-page": "2" });
  } });
  const branches = await client.listBranches("group/project");
  assert.equal(branches.length, 2);
  assert.match(calls[0][0], /projects\/group%2Fproject/);
  await client.getBranch(1, "feature/a");
  assert.match(calls[2][0], /branches\/feature%2Fa/);
});

test("GitLab refuses to silently truncate a required full listing", async () => {
  const client = createGitlabClient({ token: "test", maxPages: 1, fetchImpl: async () => json([], { "x-next-page": "2" }) });
  await assert.rejects(client.listBranches(1), /incomplete/);
});

test("provider errors do not reflect response bodies or secrets", async () => {
  const client = createGitlabClient({ token: "secret", fetchImpl: async () => new Response("secret internal server content", { status: 403 }) });
  await assert.rejects(client.getProject(1), error => error.status === 403 && !error.message.includes("secret"));
});

test("Jira CLI failures and malformed output are not empty result sets", async () => {
  for (const runCommand of [async () => { throw new Error("credential leak"); }, async () => "not json"]) {
    const client = createJiraClient({ transport: "cli", runCommand, token: "", apiToken: "" });
    await assert.rejects(client.listIssues("DEMO"));
    await assert.rejects(client.viewIssue("DEMO-1"));
  }
});

test("Jira Cloud searches use enhanced search with pagination and Basic credentials", async () => {
  const calls = [];
  const client = createJiraClient({ transport: "rest", url: "https://example.atlassian.net", email: "demo@example.com", apiToken: "test", token: "", fetchImpl: async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from("demo@example.com:test").toString("base64")}`);
    assert.equal(init.redirect, "error"); assert.ok(init.signal);
    return calls.length === 1 ? json({ issues: [{ key: "DEMO-1" }], nextPageToken: "next", isLast: false }) : json({ issues: [{ key: "DEMO-2" }], isLast: true });
  } });
  const issues = await client.findPipelineIssues("DEMO", "https://gitlab.example/pipelines/123", 123);
  assert.equal(issues.length, 2);
  assert.match(calls[0][0], /rest\/api\/2\/search\/jql$/);
  assert.equal(calls[1][1].nextPageToken, "next");
  assert.match(calls[0][1].jql, /project = "DEMO" AND text ~ "123"/);
  assert.ok(!calls[0][1].jql.includes("status"));
});

test("Jira transitions resolve target state to ID and send comment in the same request", async () => {
  const calls = [];
  const client = createJiraClient({ transport: "rest", url: "https://jira.example", token: "test", apiToken: "", fetchImpl: async (url, init) => {
    calls.push([url, init]);
    if (!init.method) return json({ transitions: [{ id: "31", name: "Complete task", to: { name: "Done" } }] });
    return new Response(null, { status: 204 });
  } });
  await client.moveIssue("DEMO-1", "Done", "Confirmed in demo");
  assert.deepEqual(JSON.parse(calls[1][1].body), { transition: { id: "31" }, update: { comment: [{ add: { body: "Confirmed in demo" } }] } });
});

test("Jira ambiguous transitions are rejected before a write", async () => {
  let count = 0;
  const client = createJiraClient({ transport: "rest", url: "https://jira.example", token: "test", apiToken: "", fetchImpl: async () => {
    count++; return json({ transitions: [{ id: "1", to: { name: "Done" } }, { id: "2", to: { name: "Done" } }] });
  } });
  await assert.rejects(client.moveIssue("DEMO-1", "Done"), /No unique/);
  assert.equal(count, 1);
});

test("Jira create uses configured project, returns key, and validates JQL inputs", async () => {
  const client = createJiraClient({ transport: "rest", url: "https://jira.example", token: "test", apiToken: "", fetchImpl: async (_, init) => {
    const { fields } = JSON.parse(init.body);
    assert.equal(fields.project.key, "DEMO"); assert.equal(fields.description, "Evidence");
    return json({ key: "DEMO-9" });
  } });
  assert.equal(await client.createIssue("DEMO", "Bug", "Failed", "Evidence"), "DEMO-9");
  assert.throws(() => client.findPipelineIssues('DEMO" OR project=OTHER', "123", 123), /valid Jira/);
});

test("Drive search follows nextPageToken and supplies timeout", async () => {
  const calls = [];
  const client = createDriveClient({ tokenProvider: async () => "test", fetchImpl: async (url, init) => {
    calls.push(url); assert.ok(init.signal); assert.equal(init.redirect, "error");
    return calls.length === 1 ? json({ files: [], nextPageToken: "two" }) : json({ files: [{ id: "doc", name: "Release notes" }] });
  } });
  assert.equal((await client.searchDrive("trashed = false"))[0].id, "doc");
  assert.match(calls[1], /pageToken=two/);
});

test("status fallback uses exact matches and key extraction handles empty input", () => {
  assert.equal(extractJiraKey(undefined), null);
  assert.equal(extractJiraKey("feature/DEMO-12_changes"), "DEMO-12");
  assert.equal(extractJiraKey("A-1"), "A-1");
  assert.equal(isDone({ status: "Not Done" }), false);
  assert.equal(isDone({ status: "Closed" }), true);
});
