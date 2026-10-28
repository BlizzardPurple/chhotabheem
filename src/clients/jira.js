import { run, tryRun } from "../exec.js";

/** Extract JIRA key from text (branch name, title, commit message). */
export function extractJiraKey(text) {
  const match = text.match(/([A-Z][A-Z0-9]+-\d+)/);
  return match ? match[1] : null;
}

/** List issues by JQL. Returns raw JSON string from CLI. */
export async function listIssues(project, jql) {
  const q = jql || `project=${project} AND status NOT IN (Done, Closed) ORDER BY updated DESC`;
  const raw = await tryRun("jira", ["issue", "list", "-q", q, "--raw"]);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** View a single issue. Returns raw JSON. */
export async function viewIssue(key) {
  const raw = await tryRun("jira", ["issue", "view", key, "--raw"]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Create an issue. Returns CLI output (contains issue key). */
export function createIssue(project, type, summary, body, priority) {
  const args = ["issue", "create", "-p", project, "-t", type, "-s", summary, "-b", body, "--no-input"];
  if (priority) args.push("-y", priority);
  return run("jira", args);
}

/** Transition an issue to a new state. */
export function moveIssue(key, state, comment, resolution) {
  const args = ["issue", "move", key, state];
  if (comment) args.push("--comment", comment);
  if (resolution) args.push("-R", resolution);
  return run("jira", args);
}

/** Add a comment to an issue. */
export function addComment(key, body) {
  return run("jira", ["issue", "comment", "add", key, body]);
}
