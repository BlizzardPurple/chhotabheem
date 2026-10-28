import * as defaultJira from "../clients/jira.js";
import * as defaultGitlab from "../clients/gitlab.js";
import * as defaultDrive from "../clients/gdrive.js";

const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/** Build a reviewable plan. Constructing a plan NEVER writes to a provider. */
export async function reconcile(m, { jira = defaultJira, gitlab = defaultGitlab, gdrive = defaultDrive } = {}) {
  const d = m.details;
  const base = { mismatch_id: m.id, needs_approval: true, warning: "Review the evidence and your team's workflow before approving." };
  switch (m.rule) {
    case "MR merged, ticket still open": {
      const target = process.env.JIRA_DONE_STATUS || "Done";
      return { ...base, action: "jira_transition", description: `Transition ${d.jira_key} to ${target}`,
        warning: "A merge is not proof of deployment or acceptance. Confirm all work and your team's definition of Done.",
        payload: { issue: d.jira_key, from: d.jira_status, to: target, evidence: d.mr_url },
        execute: async () => {
          if (defaultJira.isDone(await jira.viewIssue(d.jira_key))) return { message: `${d.jira_key} is already complete.`, changed: false };
          await jira.moveIssue(d.jira_key, target, `Approved in ProjectSync. Evidence: ${d.mr_url}`);
          return { message: `${d.jira_key} transitioned to ${target}.`, changed: true };
        } };
    }
    case "Pipeline failed, no bug ticket": {
      const project = d.jira_project || process.env.JIRA_PROJECT;
      if (!project) throw new Error("Set JIRA_PROJECT before creating an issue.");
      const summary = `Pipeline #${d.pipeline_id} failed — ${d.failed_job}`;
      const body = `Pipeline: ${d.pipeline_url}\nFailed job: ${d.failed_job}\n\nLog excerpt (evidence, not a root-cause diagnosis):\n${d.log_excerpt || "Unavailable"}\n\nProjectSync reference: ${d.project_path || ""}/pipeline/${d.pipeline_id}`;
      return { ...base, action: "jira_create", description: `Create a Bug in ${project} for pipeline #${d.pipeline_id}`,
        payload: { project, type: "Bug", summary, body },
        execute: async () => {
          const existing = await jira.findPipelineIssues(project, d.pipeline_url, d.pipeline_id);
          if (existing.length) return { message: `A pipeline reference already exists (${existing.map(i => i.key).join(", ")}); no ticket created.`, changed: false };
          const key = await jira.createIssue(project, "Bug", summary, body);
          return { message: `Created ${key}.`, changed: true, issue: key };
        } };
    }
    case "Review pending too long":
      return { ...base, action: "review_summary", needs_approval: false,
        description: `Prepare a review summary for MR !${d.mr_iid}`,
        payload: { text: `${d.title}\nOpen ${d.days_open} days. Reviewers: ${d.reviewers}.\n${d.mr_url}` },
        execute: async () => ({ message: `Review summary prepared for MR !${d.mr_iid}. No notification was sent; the finding remains open.`, changed: false }) };
    case "No release notes": {
      const title = d.release_notes_prefix || `${d.project_path || d.project_id} — Release Notes`;
      const html = `<h1>${escapeHtml(title)}</h1><p>Merge summaries; deployment status has not been verified.</p><ul>${String(d.mr_summaries || "").split("\n").map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
      return { ...base, action: "gdrive_create", description: `Create Google Doc: ${title}`,
        payload: { title, html }, execute: async () => {
          const doc = await gdrive.createDoc(title, html);
          return { message: `Created release notes: ${doc.url}`, changed: true, url: doc.url };
        } };
    }
    case "Branch with no MR": {
      const title = `Draft: ${d.last_commit || d.branch}`;
      const description = `Review work on ${d.branch}. Created after approval in ProjectSync.`;
      return { ...base, action: "gitlab_create_mr", description: `Create draft MR from ${d.branch} to ${d.default_branch}`,
        payload: { project: d.project_id, source: d.branch, target: d.default_branch, expected_source_sha: d.branch_sha, title, description },
        execute: async () => {
          const existing = await gitlab.listMRs(d.project_id, { state: "opened", source_branch: d.branch });
          if (existing.length) return { message: `MR !${existing[0].iid} already exists.`, changed: false, url: existing[0].web_url };
          const mr = await gitlab.createMR(d.project_id, d.branch, d.default_branch, title, description);
          return { message: `Created draft MR !${mr.iid}.`, changed: true, url: mr.web_url };
        } };
    }
    default: throw new Error(`Unsupported finding: ${m.rule}`);
  }
}
