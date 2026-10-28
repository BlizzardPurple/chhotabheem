import { createHash, randomBytes } from "node:crypto";
import * as gitlabClient from "../clients/gitlab.js";
import * as jiraClient from "../clients/jira.js";

const APPROVAL_TTL = 5 * 60_000;

/** Flatten Jira Cloud's Atlassian Document Format without rendering arbitrary HTML. */
export function jiraText(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  if (value.type === "text") return typeof value.text === "string" ? value.text : "";
  if (value.type === "hardBreak") return "\n";
  if (value.type === "mention") return value.attrs?.text || "";
  const text = Array.isArray(value.content) ? value.content.map(jiraText).join("") : "";
  return ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(value.type) ? `${text}\n` : text;
}
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Two-phase workflow: inspect exact intent, then execute one short-lived approval. */
export function createJiraToMr({ gitlab = gitlabClient, jira = jiraClient, now = () => Date.now(),
  tokenFactory = () => randomBytes(24).toString("hex"), jiraUrl = process.env.JIRA_URL } = {}) {
  const approvals = new Map();

  async function prepare(params) {
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(params?.jira_key || "")) throw new Error("Invalid Jira issue key.");
    if (typeof params.project !== "string" || !params.project.trim()) throw new Error("A GitLab project is required.");
    const [issue, project] = await Promise.all([jira.viewIssue(params.jira_key), gitlab.getProject(params.project)]);
    if (!issue || typeof issue !== "object") throw new Error("Jira issue is unavailable or malformed.");
    if (issue.key && issue.key !== params.jira_key) throw new Error("Jira returned a different issue key; refresh the preview.");
    const originalSummary = jiraText(issue.fields?.summary ?? issue.summary).trim();
    const originalDescription = jiraText(issue.fields?.description ?? issue.description).trim();
    const summary = jiraText(params.answers?.q1 || originalSummary).trim();
    const description = jiraText(params.answers?.q2 || originalDescription).trim();
    const questions = [];
    if (!summary || summary === params.jira_key) questions.push({ id: "q1", question: "What should the MR title describe? The Jira summary is missing." });
    if (!description) questions.push({ id: "q2", question: "What should this change accomplish? Add requirements or acceptance criteria." });
    if (questions.length) return { questions };
    const target = params.target_branch || project.default_branch;
    if (!target || typeof target !== "string") throw new Error("This repository has no default branch. Specify a target branch.");
    const slug = summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "work";
    const branch = `${params.jira_key}_${slug}`;
    if (branch === target) throw new Error("The source and target branches must be different.");
    const ticket = jiraUrl ? `${jiraUrl.replace(/\/$/, "")}/browse/${params.jira_key}` : params.jira_key;
    const proposal = { project_id: project.id, project_path: project.path_with_namespace || params.project,
      jira_key: params.jira_key, branch, target_branch: target, title: `Draft: ${params.jira_key} ${summary}`,
      description: [`## ${params.jira_key}: ${summary}`, `Jira: ${ticket}`, "### Requirements", description,
        "Prepared by ProjectSync. Creating this draft does not change Jira status."].join("\n\n") };
    return { proposal, evidenceHash: fingerprint({ originalSummary, originalDescription, issueKey: issue.key || params.jira_key, proposal }) };
  }

  async function preview(params) {
    // Copy caller input; a mutated answers object must never change an approved plan.
    const input = structuredClone(params);
    const prepared = await prepare(input);
    if (prepared.questions) return { status: "needs_input", questions: prepared.questions };
    for (const [key, value] of approvals) if (value.expiresAt <= Number(now())) approvals.delete(key);
    if (approvals.size >= 1000) throw new Error("Too many pending approvals. Wait for old previews to expire.");
    const token = tokenFactory();
    const expiresAt = Number(now()) + APPROVAL_TTL;
    approvals.set(token, { ...prepared, input, expiresAt, state: "pending" });
    return { status: "awaiting_approval", approval_token: token, expires_at: new Date(expiresAt).toISOString(),
      proposal: structuredClone(prepared.proposal),
      note: "Approve this exact branch and draft-MR plan. A branch without file changes will be prepared for your commits. Jira status stays under your control." };
  }

  async function execute({ approval_token, approved } = {}) {
    if (approved !== true) throw new Error("Explicit approval is required. Review the preview and pass approved: true with its approval_token.");
    const record = approvals.get(approval_token);
    if (!record) throw new Error("Unknown approval token. Request a new preview.");
    if (record.state === "completed") return { ...structuredClone(record.result), replayed: true };
    if (record.state === "blocked") throw new Error("This action has a possibly partial or unknown outcome. Inspect GitLab before requesting a new preview; this token cannot be retried.");
    if (record.state === "executing") throw new Error("This approval is already being executed. Wait for its result.");
    if (record.expiresAt <= Number(now())) throw new Error("Approval expired. Request a new preview.");
    record.state = "executing";
    let mutationAttempted = false;
    let branchCreated = false;
    try {
      const refreshed = await prepare(record.input);
      if (refreshed.questions || refreshed.evidenceHash !== record.evidenceHash) {
        record.state = "blocked";
        throw new Error("Jira requirements or GitLab target changed since preview. Request a fresh preview before making changes.");
      }
      const proposal = record.proposal;
      const openMRs = await gitlab.listMRs(proposal.project_id, { state: "opened", source_branch: proposal.branch,
        target_branch: proposal.target_branch, all: true });
      if (!Array.isArray(openMRs)) throw new Error("GitLab returned an invalid MR listing.");
      const matching = openMRs.filter(mr => mr.source_branch === proposal.branch && mr.target_branch === proposal.target_branch && (!mr.state || mr.state === "opened"));
      if (matching.length > 1) throw new Error("Multiple matching MRs found. Inspect the repository before creating another.");
      let result;
      if (matching.length === 1) {
        result = { status: "mr_exists", proposal, mr: matching[0], message: "An open MR already exists for these branches. Reused it without changing Jira." };
      } else {
        try { await gitlab.getBranch(proposal.project_id, proposal.branch); }
        catch (error) {
          if (error.status !== 404) throw error;
          mutationAttempted = true;
          await gitlab.createBranch(proposal.project_id, proposal.branch, proposal.target_branch);
          branchCreated = true;
        }
        const comparison = await gitlab.compareBranches(proposal.project_id, proposal.target_branch, proposal.branch);
        if (comparison.compare_timeout) throw new Error("GitLab branch comparison timed out. Inspect the branch and request a new preview.");
        if (!Array.isArray(comparison.commits) || !Array.isArray(comparison.diffs)) throw new Error("GitLab branch comparison is incomplete; cannot safely decide whether to open an MR.");
        if (comparison.compare_same_ref || !comparison.commits.length || !comparison.diffs.length) {
          result = { status: "branch_prepared", proposal, branch_created: branchCreated,
            message: `Branch ${proposal.branch} is available but has no file changes against ${proposal.target_branch}. Push your changes, then request a new preview to open the draft MR.` };
        } else {
          mutationAttempted = true;
          const mr = await gitlab.createMR(proposal.project_id, proposal.branch, proposal.target_branch, proposal.title, proposal.description);
          if (!mr?.iid || !mr.web_url) throw new Error("GitLab creation response was incomplete. Inspect open MRs before retrying.");
          result = { status: "mr_created", proposal, branch_created: branchCreated, mr,
            message: "Draft MR created with Jira requirements. Jira status was not changed." };
        }
      }
      record.state = "completed";
      record.result = structuredClone(result);
      return result;
    } catch (error) {
      if (record.state !== "blocked") record.state = mutationAttempted ? "blocked" : "pending";
      if (mutationAttempted) {
        throw new Error(`${error.message} ${branchCreated ? "The branch was created." : "A GitLab write was attempted."} Inspect GitLab before a new preview; this approval token is blocked to prevent duplicate writes.`);
      }
      throw error;
    }
  }
  return { preview, execute };
}
