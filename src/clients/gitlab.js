import { GITLAB_HOST, GITLAB_TOKEN } from "../config.js";
import { execFile } from "node:child_process";

/** Parse supported glab versions without treating masked auth status as a credential. */
export function parseGitlabAuthToken(output) {
  const plain = String(output || "").replace(/\u001b\[[0-9;]*m/g, "");
  const candidate = plain.match(/\bToken(?: found)?:[ \t]*(\S+)/i)?.[1];
  if (!candidate || /[*•…<>]|\.{2,}/.test(candidate) || /(?:redacted|masked|hidden)/i.test(candidate) || /^(?:glpat-)?x{4,}$/i.test(candidate)) return null;
  return candidate;
}

// Scope credentials to the configured host and never include auth output in errors.
async function cliToken(host) {
  return new Promise((resolve, reject) => {
    execFile("glab", ["auth", "status", "--hostname", new URL(host).hostname, "--show-token"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const credential = parseGitlabAuthToken(`${stdout || ""}\n${stderr || ""}`);
        if (error || !credential) reject(new Error("GitLab authentication unavailable. Set GITLAB_TOKEN or run glab auth login for the configured host."));
        else resolve(credential);
      });
  });
}

/** Adapter boundary: inject fetch/auth in tests without contacting a provider. */
export function createGitlabClient({ host = GITLAB_HOST, token = GITLAB_TOKEN,
  fetchImpl = globalThis.fetch, getToken = cliToken, timeoutMs = 15_000, maxPages = 20 } = {}) {
  const base = new URL(host.includes("://") ? host : `https://${host}`);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
    throw new Error("GITLAB_HOST must use HTTPS (except localhost).");
  }
  if (base.username || base.password || base.search || base.hash) throw new Error("Invalid GITLAB_HOST.");
  const root = base.href.replace(/\/$/, "");
  let cachedToken = token;
  const id = value => encodeURIComponent(String(value));

  async function request(path, init = {}) {
    cachedToken ||= await getToken(root);
    const response = await fetchImpl(`${root}/api/v4/${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${cachedToken}`, "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const error = new Error(`GitLab request failed (${response.status}). Check access and retry.`);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  async function api(path, init) {
    const response = await request(path, init);
    if (response.status === 204) return null;
    return response.json();
  }
  async function list(path, params = {}) {
    const { all = false, ...query } = params;
    let page = Number(query.page || 1);
    const items = [];
    for (let count = 0; count < maxPages; count++) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries({ per_page: 100, ...query, page })) {
        if (value !== undefined) search.set(key, String(value));
      }
      const response = await request(`${path}?${search}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Unexpected GitLab list response.");
      items.push(...data);
      const next = response.headers.get("x-next-page");
      if (!all || !next) return items;
      const nextPage = Number(next);
      if (!Number.isInteger(nextPage) || nextPage <= page) throw new Error("Invalid GitLab pagination response.");
      page = nextPage;
    }
    throw new Error(`GitLab scan exceeded ${maxPages} pages; narrow the project scope. Results are incomplete.`);
  }
  return {
    getProject: project => api(`projects/${id(project)}`),
    listMRs: (pid, params = {}) => list(`projects/${id(pid)}/merge_requests`, { per_page: 20, ...params }),
    getMR: (pid, iid) => api(`projects/${id(pid)}/merge_requests/${id(iid)}`),
    getMRChanges: (pid, iid) => api(`projects/${id(pid)}/merge_requests/${id(iid)}/changes`),
    getMRApprovals: (pid, iid) => api(`projects/${id(pid)}/merge_requests/${id(iid)}/approvals`),
    createMR: (pid, source, target, title, description) => api(`projects/${id(pid)}/merge_requests`, {
      method: "POST", body: JSON.stringify({ source_branch: source, target_branch: target, title, description }),
    }),
    listPipelines: (pid, params = {}) => list(`projects/${id(pid)}/pipelines`, { per_page: 10, ...params }),
    getPipelineJobs: (pid, pipeline) => list(`projects/${id(pid)}/pipelines/${id(pipeline)}/jobs`, { all: true }),
    getJobLog: async (pid, job) => {
      const response = await request(`projects/${id(pid)}/jobs/${id(job)}/trace`);
      const text = await response.text();
      return text.length > 3000 ? `...\n${text.slice(-3000)}` : text;
    },
    listBranches: (pid, params = {}) => list(`projects/${id(pid)}/repository/branches`, { all: true, ...params }),
    getBranch: (pid, branch) => api(`projects/${id(pid)}/repository/branches/${id(branch)}`),
    createBranch: (pid, branch, ref) => api(`projects/${id(pid)}/repository/branches`, {
      method: "POST", body: JSON.stringify({ branch, ref }),
    }),
    compareBranches: (pid, from, to) => api(`projects/${id(pid)}/repository/compare?${new URLSearchParams({ from, to })}`),
    listMRDiscussions: (pid, iid) => list(`projects/${id(pid)}/merge_requests/${id(iid)}/discussions`, { all: true }),
  };
}

// Construct live clients only when used: a broken live configuration must not
// prevent the explicitly selected offline rehearsal from starting.
let defaultClient;
const use = method => (...args) => (defaultClient ||= createGitlabClient())[method](...args);
export const getProject = use("getProject"), listMRs = use("listMRs"), getMR = use("getMR"),
  getMRChanges = use("getMRChanges"), getMRApprovals = use("getMRApprovals"), createMR = use("createMR"),
  listPipelines = use("listPipelines"), getPipelineJobs = use("getPipelineJobs"), getJobLog = use("getJobLog"),
  listBranches = use("listBranches"), getBranch = use("getBranch"), createBranch = use("createBranch"),
  compareBranches = use("compareBranches"), listMRDiscussions = use("listMRDiscussions");
