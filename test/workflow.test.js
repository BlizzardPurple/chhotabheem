import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow } from '../src/workflow.js';
import { createRuntime } from '../src/runtime.js';
import { createScanner } from '../src/tools/scan.js';
import { createDemoClients } from '../src/demo/fixtures.js';

const transitionId = 'rule1-108-SHOP-241';

for (const [rule, shouldResolve] of [
  ['Pipeline failed, no bug ticket', true],
  ['No release notes', true],
  ['Branch with no MR', true],
  ['Review pending too long', false],
]) {
  test(`reconciliation round trip: ${rule}`, async () => {
    const app = await createRuntime({ mode: 'demo' });
    const first = await app.workflow.scan(app.project);
    const finding = first.mismatches.find(m => m.rule === rule);
    const plan = await app.workflow.preview(app.project, finding.id);
    const result = await app.workflow.execute(app.project, plan.approval_token, true);
    assert.equal(result.changed, shouldResolve);
    const next = await app.workflow.scan(app.project);
    assert.equal(next.mismatches.some(m => m.id === finding.id), !shouldResolve);
    assert.equal((await app.workflow.execute(app.project, plan.approval_token, true)).replayed, true);
    assert.equal(app.workflow.getEvents(app.project).filter(e => e.type === 'action_completed').length, 1);
  });
}

function harness({ notebook, scanner: injectedScanner } = {}) {
  const fixture = createDemoClients();
  let clock = fixture.now();
  const scanner = injectedScanner || createScanner({ ...fixture.clients, now: fixture.now, jiraProject: 'SHOP' });
  const workflow = createWorkflow({ scanner, clients: fixture.clients, notebook, now: () => clock });
  return { ...fixture, workflow, scanner, advance: milliseconds => { clock += milliseconds; } };
}

function notebookStub(onAppend = async () => {}) {
  return {
    getProjectDirByPath: async () => ({ dir: 'in-memory-test' }),
    readLastScan: async () => null,
    appendSyncLog: async (_, entry) => onAppend(JSON.parse(entry)),
    saveLastScan: async () => {},
    markSession: async () => {},
  };
}

test('sample workflow finds five issues, previews without writes, requires approval and verifies resolution', async () => {
  const app = await createRuntime({ mode: 'demo' });
  const first = await app.workflow.scan(app.project);
  assert.equal(first.complete, true);
  assert.equal(first.mismatches.length, 5);
  const preview = await app.workflow.preview(app.project, transitionId);
  assert.equal(preview.action, 'jira_transition');
  assert.equal(preview.execute, undefined, 'execution closures must never cross the API boundary');
  assert.equal((await app.clients.jira.viewIssue('SHOP-241')).fields.status.name, 'In Progress');
  await assert.rejects(app.workflow.execute(app.project, preview.approval_token, false), /approval is required/i);
  await assert.rejects(app.workflow.execute(app.project, 'invented-token', true), /unknown approval token/i);
  const result = await app.workflow.execute(app.project, preview.approval_token, true);
  assert.equal(result.changed, true);
  assert.equal((await app.clients.jira.viewIssue('SHOP-241')).fields.status.name, preview.payload.to);
  const next = await app.workflow.scan(app.project);
  assert.equal(next.mismatches.length, 4);
  assert.deepEqual(next.diff.resolved, [transitionId]);
  const replay = await app.workflow.execute(app.project, preview.approval_token, true);
  assert.equal(replay.replayed, true);
  assert.equal(app.workflow.getEvents(app.project).filter(e => e.type === 'action_completed').length, 1);
});

test('every sample action can be previewed without changing provider state', async () => {
  const h = harness();
  const report = await h.workflow.scan(h.project);
  for (const finding of report.mismatches) {
    const preview = await h.workflow.preview(h.project, finding.id);
    assert.ok(preview.payload);
    assert.ok(preview.approval_token);
  }
  assert.equal((await h.scanner.scanDetailed(h.project)).mismatches.length, 5);
  assert.equal(h.workflow.getEvents(h.project).filter(e => e.type.startsWith('action_')).length, 0);
});

test('approval tokens cannot be used for another project or after expiry', async () => {
  const h = harness();
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  await assert.rejects(h.workflow.execute('different/project', preview.approval_token, true), /unknown approval token/i);
  h.advance(5 * 60_000 + 1);
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /expired/i);
  assert.equal((await h.clients.jira.viewIssue('SHOP-241')).fields.status.name, 'In Progress');
});

test('rescanning invalidates an unexecuted approval', async () => {
  const h = harness();
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  await h.workflow.scan(h.project);
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /scan changed/i);
});

test('provider evidence that changes the planned transition invalidates approval', async () => {
  const h = harness();
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  const view = h.clients.jira.viewIssue;
  h.clients.jira.viewIssue = async key => {
    const issue = await view(key);
    issue.fields.status.name = 'In Review';
    return issue;
  };
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /changed/i);
  assert.equal((await view('SHOP-241')).fields.status.name, 'In Progress');
});

test('new branch commits require a fresh preview even when MR title is unchanged', async () => {
  const h = harness();
  const report = await h.workflow.scan(h.project);
  const finding = report.mismatches.find(m => m.rule === 'Branch with no MR');
  const preview = await h.workflow.preview(h.project, finding.id);
  const listBranches = h.clients.gitlab.listBranches;
  h.clients.gitlab.listBranches = async (...args) => (await listBranches(...args)).map(branch =>
    branch.name === finding.details.branch ? { ...branch, commit: { ...branch.commit, id: 'different-commit-sha' } } : branch);
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /changed/i);
  assert.equal((await h.clients.gitlab.listMRs(42, { state: 'opened', source_branch: finding.details.branch })).length, 0);
});

test('concurrent execution cannot duplicate a provider write', async () => {
  const h = harness();
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const move = h.clients.jira.moveIssue;
  let writes = 0;
  h.clients.jira.moveIssue = async (...args) => { writes += 1; started(); await gate; return move(...args); };
  const running = h.workflow.execute(h.project, preview.approval_token, true);
  await entered;
  try {
    await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /running|uncertain/i);
  } finally { release(); }
  assert.equal((await running).changed, true);
  assert.equal(writes, 1);
});

test('failure to persist action intent blocks the provider mutation', async () => {
  const h = harness({ notebook: notebookStub(async event => {
    if (event.type === 'action_intent') throw new Error('Notebook unavailable');
  }) });
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /Notebook unavailable/);
  assert.equal((await h.clients.jira.viewIssue('SHOP-241')).fields.status.name, 'In Progress');
});

test('failure to persist completion reports success with a warning and prevents repeat writes', async () => {
  const h = harness({ notebook: notebookStub(async event => {
    if (event.type === 'action_completed') throw new Error('Notebook unavailable');
  }) });
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  const result = await h.workflow.execute(h.project, preview.approval_token, true);
  assert.equal(result.changed, true);
  assert.match(result.persistence_warning, /completed.*audit storage failed/i);
  const replay = await h.workflow.execute(h.project, preview.approval_token, true);
  assert.equal(replay.replayed, true);
  assert.equal(h.workflow.getEvents(h.project).filter(e => e.type === 'action_intent').length, 1);
});

test('uncertain provider outcomes cannot be retried with the same token', async () => {
  const h = harness();
  await h.workflow.scan(h.project);
  const preview = await h.workflow.preview(h.project, transitionId);
  let attempts = 0;
  h.clients.jira.moveIssue = async () => { attempts += 1; throw new Error('Provider connection lost'); };
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /connection lost/i);
  await assert.rejects(h.workflow.execute(h.project, preview.approval_token, true), /uncertain/i);
  assert.equal(attempts, 1);
});

test('outages never report a missing finding as resolved and keep it until verification recovers', async () => {
  const fixture = createDemoClients();
  const scanner = createScanner({ ...fixture.clients, now: fixture.now, jiraProject: 'SHOP' });
  const full = await scanner.scanDetailed(fixture.project);
  let report = full;
  const h = harness({ scanner: { scanDetailed: async () => structuredClone(report) } });
  await h.workflow.scan(h.project);
  report = { ...full, complete: false, mismatches: full.mismatches.filter(m => m.id !== transitionId) };
  const outage = await h.workflow.scan(h.project);
  assert.deepEqual(outage.diff.resolved, []);
  assert.deepEqual(outage.diff.unverified, [transitionId]);
  report = { ...report, complete: true };
  const recovered = await h.workflow.scan(h.project);
  assert.deepEqual(recovered.diff.resolved, [transitionId], 'unverified evidence must survive the outage baseline');
});
