import { run } from "../exec.js";

export function extractJiraKey(text) {
  return String(text || "").match(/(?:^|[^A-Z0-9])([A-Z][A-Z0-9]*-\d+)(?!\d)/)?.[1] || null;
}
export function jiraStatus(issue) {
  const status = issue?.fields?.status || issue?.status;
  return { name: typeof status === "string" ? status : status?.name || "",
    category: typeof status === "object" && status ? status.statusCategory?.key : undefined };
}
export function isDone(issue) {
  const { name, category } = jiraStatus(issue);
  return category ? category === "done" : /^(done|closed|resolved)$/i.test(name.trim());
}
function projectKey(project) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(project || "")) throw new Error("Configure JIRA_PROJECT with a valid Jira project key.");
  return project;
}
function issueKey(key) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key || "")) throw new Error("Invalid Jira issue key.");
  return key;
}

/** REST credentials allow headless operation; otherwise use an authenticated jira CLI. */
export function createJiraClient({ runCommand = run, fetchImpl = globalThis.fetch,
  url = process.env.JIRA_URL, email = process.env.JIRA_EMAIL, apiToken = process.env.JIRA_API_TOKEN,
  token = process.env.JIRA_TOKEN, deployment = process.env.JIRA_DEPLOYMENT,
  transport = process.env.JIRA_TRANSPORT || "auto",
  timeoutMs = 15_000, maxPages = 20 } = {}) {
  if (!["auto", "cli", "rest"].includes(transport)) throw new Error("JIRA_TRANSPORT must be auto, cli, or rest.");
  // jira-cli also uses JIRA_API_TOKEN, so that variable alone must not switch transports.
  const rest = transport === "rest" || (transport === "auto" && Boolean(token || (apiToken && email && url)));
  let root, authorization;
  if (rest) {
    if (!token && !apiToken) throw new Error("Set JIRA_TOKEN or JIRA_API_TOKEN for Jira REST authentication.");
    if (!url) throw new Error("Set JIRA_URL with Jira REST credentials.");
    const base = new URL(url);
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
      throw new Error("JIRA_URL must use HTTPS (except localhost).");
    }
    if (base.username || base.password || base.search || base.hash) throw new Error("Invalid JIRA_URL.");
    root = base.href.replace(/\/$/, "");
    const useBasic = !token && Boolean(apiToken);
    if (useBasic && !email) throw new Error("Set JIRA_EMAIL for JIRA_API_TOKEN authentication.");
    authorization = useBasic ? `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}` : `Bearer ${token}`;
    deployment ||= useBasic || base.hostname.endsWith(".atlassian.net") ? "cloud" : "server";
    if (!["cloud", "server"].includes(deployment)) throw new Error("JIRA_DEPLOYMENT must be cloud or server.");
  }
  async function api(path, init = {}) {
    const response = await fetchImpl(`${root}/rest/api/2/${path}`, { ...init,
      redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const error = new Error(`Jira request failed (${response.status}). Check access, required fields, and workflow configuration.`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  async function json(args) {
    let raw;
    try { raw = await runCommand("jira", args); }
    catch { throw new Error("Jira request failed. Configure Jira REST credentials or check jira CLI authentication."); }
    try { return JSON.parse(raw); }
    catch { throw new Error("Jira did not return valid JSON. Use jira-cli with --raw support."); }
  }
  async function listIssues(project, jql) {
    projectKey(project);
    const query = jql || `project = "${project}" AND statusCategory != Done ORDER BY updated DESC`;
    if (!rest) {
      const data = await json(["issue", "list", "-p", project, "-q", query, "--raw"]);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.issues)) return data.issues;
      throw new Error("Unexpected Jira issue list response.");
    }
    const issues = [];
    let nextPageToken;
    for (let page = 0; page < maxPages; page++) {
      const body = { jql: query, fields: ["summary", "status", "description", "issuetype"], maxResults: 100 };
      if (deployment === "cloud") { if (nextPageToken) body.nextPageToken = nextPageToken; }
      else body.startAt = issues.length;
      const data = await api(deployment === "cloud" ? "search/jql" : "search", { method: "POST", body: JSON.stringify(body) });
      if (!Array.isArray(data?.issues)) throw new Error("Unexpected Jira issue list response.");
      issues.push(...data.issues);
      if (deployment === "cloud") {
        if (data.isLast === true || !data.nextPageToken) return issues;
        if (nextPageToken === data.nextPageToken) throw new Error("Invalid Jira pagination response.");
        nextPageToken = data.nextPageToken;
      } else if (issues.length >= data.total || data.issues.length < 100) return issues;
    }
    throw new Error("Jira search exceeded the pagination limit; results are incomplete.");
  }
  return {
    listIssues,
    viewIssue: async key => {
      const issue = rest ? await api(`issue/${issueKey(key)}`) : await json(["issue", "view", issueKey(key), "--raw"]);
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new Error("Unexpected Jira issue response.");
      return issue;
    },
    // Search all visible statuses. A match suppresses duplicate creation conservatively.
    // A zero result means only "no reference found in the configured Jira project".
    findPipelineIssues: (project, pipelineUrl, pipelineId) => {
      projectKey(project);
      const id = pipelineId ?? String(pipelineUrl).match(/(?:pipelines\/)?(\d+)\/?$/)?.[1];
      if (!/^\d+$/.test(String(id))) throw new Error("Invalid pipeline ID.");
      return listIssues(project, `project = "${project}" AND text ~ "${id}" ORDER BY updated DESC`);
    },
    createIssue: async (project, type, summary, body, priority) => {
      projectKey(project);
      if (rest) {
        const fields = { project: { key: project }, issuetype: { name: type }, summary, description: body };
        if (priority) fields.priority = { name: priority };
        const result = await api("issue", { method: "POST", body: JSON.stringify({ fields }) });
        if (!result?.key) throw new Error("Jira create response lacked an issue key; verify Jira before retrying.");
        return result.key;
      }
      const args = ["issue", "create", "-p", project, "-t", type, "-s", summary, "-b", body, "--no-input"];
      if (priority) args.push("-y", priority);
      return runCommand("jira", args);
    },
    moveIssue: async (key, state, comment, resolution) => {
      issueKey(key);
      if (rest) {
        const result = await api(`issue/${key}/transitions`);
        const matches = (result.transitions || []).filter(t => (t.to?.name || "").toLowerCase() === state.toLowerCase());
        if (matches.length !== 1) throw new Error(`No unique available Jira transition to "${state}". Review the project's workflow.`);
        const body = { transition: { id: matches[0].id } };
        if (comment) body.update = { comment: [{ add: { body: comment } }] };
        if (resolution) body.fields = { resolution: { name: resolution } };
        await api(`issue/${key}/transitions`, { method: "POST", body: JSON.stringify(body) });
        return `${key} transitioned to ${state}`;
      }
      const args = ["issue", "move", key, state];
      if (comment) args.push("--comment", comment);
      if (resolution) args.push("-R", resolution);
      return runCommand("jira", args);
    },
    addComment: (key, body) => rest
      ? api(`issue/${issueKey(key)}/comment`, { method: "POST", body: JSON.stringify({ body }) })
      : runCommand("jira", ["issue", "comment", "add", issueKey(key), body]),
  };
}

let defaultClient;
const use = method => (...args) => (defaultClient ||= createJiraClient())[method](...args);
export const listIssues = use("listIssues"), viewIssue = use("viewIssue"), findPipelineIssues = use("findPipelineIssues"),
  createIssue = use("createIssue"), moveIssue = use("moveIssue"), addComment = use("addComment");
