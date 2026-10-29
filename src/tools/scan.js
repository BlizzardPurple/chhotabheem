import * as gitlabClient from "../clients/gitlab.js";
import * as jiraClient from "../clients/jira.js";
import * as gdriveClient from "../clients/gdrive.js";
import { REVIEW_STALE_DAYS } from "../config.js";

const DAY = 86_400_000;
export const RULES = ["MR merged, ticket still open", "Pipeline failed, no bug ticket",
  "Review pending too long", "No release notes", "Branch with no MR"];
const driveLiteral = value => String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Rule execution is deterministic with an injected clock and provider adapters. */
export function createScanner({ gitlab = gitlabClient, jira = jiraClient, gdrive = gdriveClient,
  now = () => Date.now(), reviewStaleDays = REVIEW_STALE_DAYS,
  jiraProject = process.env.JIRA_PROJECT, lookbackDays = 7 } = {}) {
  async function scanDetailed(projectIdOrPath) {
    const timestamp = Number(now());
    const scannedAt = new Date(timestamp).toISOString();
    const since = new Date(timestamp - lookbackDays * DAY).toISOString();
    const project = await gitlab.getProject(projectIdOrPath);
    const pid = project.id;
    const defaultBranch = project.default_branch;
    if (!defaultBranch) throw new Error("Project has no default branch; initialize the repository before scanning.");
    const baseDetails = { project_id: pid, project_path: project.path_with_namespace,
      project_name: project.name || project.path_with_namespace, default_branch: defaultBranch, jira_project: jiraProject };
    const [openResult, mergedResult] = await Promise.allSettled([
      gitlab.listMRs(pid, { state: "opened", per_page: 100, all: true }),
      gitlab.listMRs(pid, { state: "merged", per_page: 100, all: true, updated_after: since, order_by: "updated_at", sort: "desc" }),
    ]);
    function data(result) { if (result.status === "rejected") throw result.reason; return result.value; }
    function recentMerged() {
      return data(mergedResult).filter(mr => Date.parse(mr.merged_at) >= timestamp - lookbackDays * DAY);
    }
    function finding(id, severity, ruleIndex, summary, details, suggestedAction, confidence, evidence) {
      return { id, severity, rule: RULES[ruleIndex], summary, details: { ...baseDetails, ...details },
        suggestedAction, confidence, evidence, observedAt: scannedAt };
    }
    async function checked(ruleIndex, work) {
      const warnings = [];
      const warn = message => warnings.push(message);
      try {
        const mismatches = await work(warn);
        return { mismatches, check: { rule: RULES[ruleIndex], status: warnings.length ? "degraded" : "complete",
          ...(warnings.length ? { message: warnings.join(" ") } : {}) } };
      } catch (error) {
        return { mismatches: [], check: { rule: RULES[ruleIndex], status: "degraded", message: error.message } };
      }
    }
    const results = await Promise.all([
      checked(0, async warn => {
        const mismatches = [];
        const issues = new Map();
        for (const mr of recentMerged()) {
          const key = jiraClient.extractJiraKey(mr.source_branch) || jiraClient.extractJiraKey(mr.title) || jiraClient.extractJiraKey(mr.description);
          if (!key) continue;
          if (jiraProject && !key.startsWith(jiraProject)) continue;
          try {
            if (!issues.has(key)) issues.set(key, await jira.viewIssue(key));
            const issue = issues.get(key);
            const status = jiraClient.jiraStatus(issue);
            if (!status.name) { warn(`Could not read ${key}'s status.`); continue; }
            if (jiraClient.isDone(issue)) continue;
            mismatches.push(finding(`rule1-${mr.iid}-${key}`, "HIGH", 0,
              `MR !${mr.iid} is merged, but ${key} is "${status.name}"`,
              { mr_iid: mr.iid, mr_url: mr.web_url, jira_key: key, jira_status: status.name,
                jira_status_category: status.category || null, merged_at: mr.merged_at,
                status_source: status.category ? "Jira statusCategory.key" : "Exact status-name fallback" },
              `Review ${key}'s release and acceptance criteria before proposing a Done transition`, "high",
              [{ source: "GitLab", url: mr.web_url, fact: `MR !${mr.iid} merged at ${mr.merged_at}` },
                { source: "Jira", key, fact: `Status: ${status.name}; category: ${status.category || "unavailable"}` }]));
          } catch (error) { warn(`${key}: ${error.message}`); }
        }
        return mismatches;
      }),
      checked(1, async warn => {
        // Evaluate current default-branch state, not historical failures superseded by success.
        const pipelines = await gitlab.listPipelines(pid, { ref: defaultBranch, per_page: 1, order_by: "id", sort: "desc" });
        const pipeline = pipelines[0];
        if (!pipeline || pipeline.status !== "failed") return [];
        if (!jiraProject) throw new Error(`Pipeline #${pipeline.id} is failed, but tracking is unknown: configure JIRA_PROJECT to check linked issues.`);
        const matches = await jira.findPipelineIssues(jiraProject, pipeline.web_url, pipeline.id);
        if (!Array.isArray(matches)) throw new Error("Jira pipeline search returned an invalid response.");
        if (matches.length) return [];
        const jobs = await gitlab.getPipelineJobs(pid, pipeline.id);
        const failedJob = jobs.find(job => job.status === "failed" && !job.allow_failure);
        let excerpt = "";
        if (failedJob) {
          try { excerpt = await gitlab.getJobLog(pid, failedJob.id); }
          catch { warn(`Pipeline #${pipeline.id} found, but its failed-job log is unavailable.`); }
        }
        return [finding(`rule2-${pipeline.id}`, "HIGH", 1,
          `Latest pipeline #${pipeline.id} failed on ${defaultBranch}; no reference found in ${jiraProject}`,
          { pipeline_id: pipeline.id, pipeline_url: pipeline.web_url, branch: defaultBranch,
            failed_job: failedJob?.name || "unknown", log_excerpt: redactLog(String(excerpt).slice(-1500)),
            jira_search_scope: `${jiraProject}: visible issues containing pipeline ID ${pipeline.id}`,
            tracking_verified: true },
          "Review failure evidence and propose a linked Jira bug", "medium",
          [{ source: "GitLab", url: pipeline.web_url, fact: "Latest default-branch pipeline is failed" },
            { source: "Jira", fact: `No visible issue matched pipeline ID ${pipeline.id} in project ${jiraProject}; text search can miss unlinked or recently created issues.` }])];
      }),
      checked(2, async warn => {
        const mismatches = [];
        for (const mr of data(openResult)) {
          if (mr.draft || mr.work_in_progress || /^(draft|wip):/i.test(mr.title || "")) continue;
          const age = timestamp - Date.parse(mr.created_at);
          if (!Number.isFinite(age) || age < reviewStaleDays * DAY) continue;
          try {
            const approvals = await gitlab.getMRApprovals(pid, mr.iid);
            // Only claim review is pending when the approval endpoint proves it is incomplete.
            const approved = approvals.approved === true || (approvals.approvals_required > 0 && approvals.approvals_left === 0);
            if (approved) continue;
            if (approvals.approved !== false && !(approvals.approvals_left > 0)) {
              warn(`MR !${mr.iid}: approval requirements unavailable; review status unknown.`); continue;
            }
            const daysOpen = Math.floor(age / DAY);
            const reviewers = (mr.reviewers || []).map(r => r.name || r.username).join(", ") || "no reviewer assigned";
            mismatches.push(finding(`rule3-${mr.iid}`, "MEDIUM", 2,
              `MR !${mr.iid} is ${daysOpen} days old with incomplete approval; reviewers: ${reviewers}`,
              { mr_iid: mr.iid, mr_url: mr.web_url, days_open: daysOpen, reviewers, title: mr.title,
                qualification: "Age is measured from creation, not time waiting for a particular reviewer." },
              "Prepare a review summary for the author to share", "medium",
              [{ source: "GitLab", url: mr.web_url, fact: `Created ${mr.created_at}; approval is incomplete` }]));
          } catch (error) { warn(`MR !${mr.iid}: ${error.message}`); }
        }
        return mismatches;
      }),
      checked(3, async () => {
        const merged = recentMerged();
        if (!merged.length) return [];
        const name = project.path_with_namespace || project.name;
        // The project-qualified title is also used by release-note creation.
        const titlePrefix = `${name} — Release Notes`;
        const query = `trashed = false and name contains '${driveLiteral(titlePrefix)}' and modifiedTime >= '${since}'`;
        const docs = await gdrive.searchDrive(query);
        if (docs.length) return [];
        return [finding("rule4-release-notes", "MEDIUM", 3,
          `${merged.length} MRs merged in ${lookbackDays} days; no matching project release-notes document found`,
          { mr_count: merged.length, release_notes_prefix: titlePrefix,
            mr_summaries: merged.map(mr => `!${mr.iid}: ${mr.title} (${mr.author?.name || "unknown"}, merged ${mr.merged_at?.slice(0, 10)})`).join("\n"),
            drive_query: query },
          "Draft project-scoped release notes for review", "medium",
          [{ source: "GitLab", url: project.web_url, fact: `${merged.length} recently merged MRs (merge does not prove production shipment)` },
            { source: "Google Drive", fact: `No accessible document matched title prefix "${titlePrefix}" since ${since}; differently named documents may exist.` }])];
      }),
      checked(4, async warn => {
        const openMRs = data(openResult);
        const branchesWithMRs = new Set(openMRs.map(mr => mr.source_branch));
        const branches = await gitlab.listBranches(pid);
        const mismatches = [];
        for (const branch of branches) {
          if (branch.name === defaultBranch || branch.default || branch.protected || branch.merged || branchesWithMRs.has(branch.name)) continue;
          const age = timestamp - Date.parse(branch.commit?.created_at);
          if (!Number.isFinite(age) || age > 30 * DAY) continue;
          try {
            const comparison = await gitlab.compareBranches(pid, defaultBranch, branch.name);
            if (comparison.compare_timeout) { warn(`Branch ${branch.name}: comparison timed out.`); continue; }
            if (!Array.isArray(comparison.commits)) { warn(`Branch ${branch.name}: comparison unavailable.`); continue; }
            if (!comparison.commits.length || comparison.compare_same_ref) continue;
            mismatches.push(finding(`rule5-${branch.name}`, "LOW", 4,
              `Branch "${branch.name}" has ${comparison.commits.length} unmerged commits and no open MR`,
              { branch: branch.name, last_commit: branch.commit.title, last_commit_date: branch.commit.created_at,
                commit_count: comparison.commits.length, branch_sha: branch.commit.id },
              "Review the branch and propose a draft MR", "high",
              [{ source: "GitLab", url: branch.web_url || project.web_url,
                fact: `Compared with ${defaultBranch}; no open MR for source branch` }]));
          } catch (error) { warn(`Branch ${branch.name}: ${error.message}`); }
        }
        return mismatches;
      }),
    ]);
    const checks = results.map(result => result.check);
    return { project, scannedAt, mismatches: results.flatMap(result => result.mismatches), checks,
      complete: checks.every(check => check.status === "complete"),
      scope: { lookbackDays, defaultBranch, jiraProject: jiraProject || null,
        note: "Evidence is limited to data visible to the configured accounts. Rules are signals for human review." } };
  }
  return { scanDetailed, scan: async project => (await scanDetailed(project)).mismatches };
}

/** Best-effort redaction; job logs remain untrusted and should be reviewed before sharing. */
export function redactLog(text) {
  return text.replace(/\b(?:glpat-|ghp_|AKIA)[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(\b(?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*)(?:Bearer\s+)?[^\s]+/gi, "$1[REDACTED]");
}

export const { scan, scanDetailed } = createScanner();
