import { GITLAB_HOST, GITLAB_TOKEN } from "../config.js";
import { tryRun } from "../exec.js";
import { execFile } from "child_process";

let _token = null;

async function token() {
  if (!_token) {
    if (GITLAB_TOKEN) {
      _token = GITLAB_TOKEN;
    } else {
      // glab outputs auth info to stderr; capture both streams
      _token = await new Promise((resolve) => {
        execFile("glab", ["auth", "status", "-t"], { timeout: 10000 }, (err, stdout, stderr) => {
          const combined = (stdout || "") + (stderr || "");
          const match = combined.match(/Token.*:\s*(\S+)/);
          resolve(match ? match[1] : null);
        });
      });
    }
    if (!_token) throw new Error("No GitLab token. Set GITLAB_TOKEN or run `glab auth login`.");
  }
  return _token;
}

async function api(path, init) {
  const t = await token();
  const res = await fetch(`${GITLAB_HOST}/api/v4/${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${t}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitLab ${res.status}: ${path} — ${body.slice(0, 200)}`);
  }
  // trace endpoint returns text, not JSON
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function qs(params) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) s.set(k, String(v)); });
  return s.toString();
}

// --- Projects ---
export const getProject = (idOrPath) =>
  api(`projects/${typeof idOrPath === "string" ? encodeURIComponent(idOrPath) : idOrPath}`);

// --- Merge Requests ---
export const listMRs = (pid, params = {}) =>
  api(`projects/${pid}/merge_requests?${qs({ per_page: 20, ...params })}`);

export const getMR = (pid, iid) =>
  api(`projects/${pid}/merge_requests/${iid}`);

export const getMRChanges = (pid, iid) =>
  api(`projects/${pid}/merge_requests/${iid}/changes`);

export const createMR = (pid, source, target, title, description) =>
  api(`projects/${pid}/merge_requests`, {
    method: "POST",
    body: JSON.stringify({ source_branch: source, target_branch: target, title, description }),
  });

// --- Pipelines ---
export const listPipelines = (pid, params = {}) =>
  api(`projects/${pid}/pipelines?${qs({ per_page: 10, ...params })}`);

export const getPipelineJobs = (pid, pipeId) =>
  api(`projects/${pid}/pipelines/${pipeId}/jobs`);

export const getJobLog = async (pid, jobId) => {
  const t = await token();
  const res = await fetch(`${GITLAB_HOST}/api/v4/projects/${pid}/jobs/${jobId}/trace`, {
    headers: { "Authorization": `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(`GitLab ${res.status}: job ${jobId} trace`);
  const text = await res.text();
  return text.length > 3000 ? "...\n" + text.slice(-3000) : text;
};

// --- Branches ---
export const listBranches = (pid, params = {}) =>
  api(`projects/${pid}/repository/branches?${qs({ per_page: 100, ...params })}`);

// --- Discussions (unresolved threads) ---
export const listMRDiscussions = (pid, iid) =>
  api(`projects/${pid}/merge_requests/${iid}/discussions`);
