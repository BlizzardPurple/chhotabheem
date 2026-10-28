/** Synthetic scenario: no network access or company data. Fresh state per runtime. */
export function createDemoClients() {
  const anchor = new Date("2026-10-28T10:00:00Z").getTime();
  const daysAgo = days => new Date(anchor - days * 86_400_000).toISOString();
  const project = { id: 42, name: "Checkout Service", path_with_namespace: "demo/checkout-service", default_branch: "main", web_url: "https://gitlab.example.com/demo/checkout-service" };
  const mrUrl = id => `${project.web_url}/-/merge_requests/${id}`;
  const merged = [{ iid: 108, title: "SHOP-241 Fix checkout rounding", source_branch: "SHOP-241-rounding", state: "merged", merged_at: daysAgo(1), created_at: daysAgo(5), web_url: mrUrl(108), author: { name: "Asha" } }];
  const opened = [{ iid: 112, title: "SHOP-244 Add retry policy", source_branch: "SHOP-244-retries", created_at: daysAgo(5), web_url: mrUrl(112), reviewers: [{ name: "Ravi" }], author: { name: "Asha" } }];
  const pipeline = { id: 8801, status: "failed", ref: "main", created_at: daysAgo(0.1), web_url: `${project.web_url}/-/pipelines/8801` };
  const issues = new Map([["SHOP-241", { key: "SHOP-241", fields: { summary: "Fix checkout rounding", description: "Round currency totals consistently. Acceptance: totals match across currencies.", status: { name: "In Progress", statusCategory: { key: "indeterminate" } }, issuetype: { name: "Task" } } }]]);
  const branches = [{ name: "main", default: true, commit: { created_at: daysAgo(0) } }, { name: "SHOP-250-timeout", commit: { id: "abc123", title: "Add payment timeout handling", created_at: daysAgo(2) }, web_url: `${project.web_url}/-/tree/SHOP-250-timeout` }];
  const createdIssues = [], docs = [];
  const clients = {
    gitlab: {
      getProject: async () => structuredClone(project),
      listMRs: async (_, params = {}) => structuredClone((params.state === "merged" ? merged : opened).filter(m => !params.source_branch || m.source_branch === params.source_branch)),
      getMR: async (_, iid) => structuredClone([...merged, ...opened].find(m => m.iid === iid)),
      getMRApprovals: async () => ({ approved: false }),
      listPipelines: async () => [structuredClone(pipeline)],
      getPipelineJobs: async () => [{ id: 9901, name: "checkout-contract-test", status: "failed" }],
      getJobLog: async () => "FAIL checkout contract\nExpected response status 200, received 504\npayment-provider timeout after 3000ms\n1 failed, 42 passed",
      listBranches: async () => structuredClone(branches),
      compareBranches: async (_, from, to) => {
        const changed = to === "SHOP-250-timeout" && to !== from;
        return { commits: changed ? [{ id: "abc123", title: "Add payment timeout handling" }] : [],
          diffs: changed ? [{ new_path: "checkout.js", diff: "+ timeout handling" }] : [], compare_same_ref: !changed };
      },
      getBranch: async (_, name) => { const branch = branches.find(b => b.name === name); if (!branch) { const e = new Error("Branch missing"); e.status = 404; throw e; } return structuredClone(branch); },
      createBranch: async (_, name) => { const branch = { name, commit: { created_at: daysAgo(0), id: "new123" } }; branches.push(branch); return branch; },
      createMR: async (_, source, target, title, description) => { const mr = { iid: 200 + opened.length, title, description, source_branch: source, target_branch: target, draft: true, created_at: daysAgo(0), web_url: mrUrl(200 + opened.length) }; opened.push(mr); return structuredClone(mr); },
    },
    jira: {
      viewIssue: async key => { if (!issues.has(key)) throw new Error("Synthetic ticket not found. Use SHOP-241."); return structuredClone(issues.get(key)); },
      findPipelineIssues: async () => structuredClone(createdIssues),
      listIssues: async () => [...issues.values()].map(i => structuredClone(i)),
      moveIssue: async (key, status) => { issues.get(key).fields.status = { name: status, statusCategory: { key: "done" } }; return key; },
      createIssue: async (_, type, summary, body) => { const key = `SHOP-${300 + createdIssues.length}`; createdIssues.push({ key, fields: { summary, description: body } }); return key; },
    },
    gdrive: {
      searchDrive: async query => {
        const nameMatch = String(query).match(/name contains '((?:\\.|[^'])*)'/);
        const sinceMatch = String(query).match(/modifiedTime >= '([^']+)'/);
        const prefix = nameMatch?.[1].replace(/\\(.)/g, "$1");
        return structuredClone(docs.filter(doc => (!prefix || doc.name.includes(prefix)) &&
          (!sinceMatch || Date.parse(doc.modifiedTime) >= Date.parse(sinceMatch[1]))));
      },
      createDoc: async name => {
        const doc = { name, url: "https://docs.example.com/release-notes", id: "demo-notes", modifiedTime: new Date(anchor).toISOString() };
        docs.push(doc);
        return structuredClone(doc);
      },
    },
  };
  return { clients, project: project.path_with_namespace, now: () => anchor };
}
