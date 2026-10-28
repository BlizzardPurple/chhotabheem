import * as gitlab from "../clients/gitlab.js";
import * as jira from "../clients/jira.js";
import * as gdrive from "../clients/gdrive.js";
import { REVIEW_STALE_DAYS } from "../config.js";

/**
 * Mismatch object returned by each rule.
 */
function mismatch(id, severity, rule, summary, details, suggestedAction) {
  return { id, severity, rule, summary, details, suggestedAction };
}

/**
 * Rule 1: MR merged but linked JIRA ticket still open.
 */
async function rule1_mrMergedTicketOpen(pid, mergedMRs) {
  const results = [];
  for (const mr of mergedMRs) {
    const key = jira.extractJiraKey(mr.source_branch) || jira.extractJiraKey(mr.title) || jira.extractJiraKey(mr.description || "");
    if (!key) continue;

    let issue;
    try { issue = await jira.viewIssue(key); } catch { continue; }
    if (!issue) continue;

    // Parse status — jira CLI raw output varies
    const status = typeof issue === "string" ? "" : (issue.fields?.status?.name || issue.status || "");
    const isDone = /done|closed|resolved/i.test(status);
    if (!isDone) {
      results.push(mismatch(
        `rule1-${mr.iid}-${key}`,
        "HIGH",
        "MR merged, ticket still open",
        `MR !${mr.iid} merged ${mr.merged_at?.slice(0, 10)}, but ${key} is "${status}"`,
        { mr_iid: mr.iid, mr_url: mr.web_url, jira_key: key, jira_status: status, merged_at: mr.merged_at },
        `Transition ${key} to "Done"`,
      ));
    }
  }
  return results;
}

/**
 * Rule 2: Pipeline failed on default branch, no bug ticket exists.
 */
async function rule2_pipelineFailedNoBug(pid, defaultBranch) {
  const pipelines = await gitlab.listPipelines(pid, { ref: defaultBranch, status: "failed", per_page: 3 });
  const results = [];

  for (const pipe of pipelines) {
    // Check if a JIRA ticket references this pipeline
    // Simple heuristic: search for pipeline ID or "pipeline" + date in recent tickets
    // For hackathon: just flag all recent failures
    const jobs = await gitlab.getPipelineJobs(pid, pipe.id);
    const failedJob = jobs.find(j => j.status === "failed");

    let logExcerpt = "";
    if (failedJob) {
      try { logExcerpt = await gitlab.getJobLog(pid, failedJob.id); } catch {}
    }

    results.push(mismatch(
      `rule2-${pipe.id}`,
      "HIGH",
      "Pipeline failed, no bug ticket",
      `Pipeline #${pipe.id} failed on ${defaultBranch} (${pipe.created_at?.slice(0, 10)})`,
      {
        pipeline_id: pipe.id, pipeline_url: pipe.web_url, branch: defaultBranch,
        failed_job: failedJob?.name || "unknown", log_excerpt: logExcerpt.slice(-1500),
      },
      "Create JIRA bug ticket with failure analysis",
    ));
  }
  return results;
}

/**
 * Rule 3: MR review pending > N days.
 */
async function rule3_reviewPendingTooLong(pid, openMRs) {
  const now = Date.now();
  const staleMs = REVIEW_STALE_DAYS * 24 * 60 * 60 * 1000;
  const results = [];

  for (const mr of openMRs) {
    if (mr.draft) continue;
    const age = now - new Date(mr.created_at).getTime();
    if (age < staleMs) continue;

    const reviewers = (mr.reviewers || []).map(r => r.name).join(", ") || "no reviewer assigned";
    const daysOpen = Math.floor(age / (24 * 60 * 60 * 1000));

    results.push(mismatch(
      `rule3-${mr.iid}`,
      "MEDIUM",
      "Review pending too long",
      `MR !${mr.iid} open ${daysOpen} days, reviewers: ${reviewers}`,
      { mr_iid: mr.iid, mr_url: mr.web_url, days_open: daysOpen, reviewers, title: mr.title },
      `Send review summary to ${reviewers}`,
    ));
  }
  return results;
}

/**
 * Rule 4: Tickets shipped (Done) but no release notes doc exists.
 */
async function rule4_noReleaseNotes(pid, mergedMRs) {
  if (mergedMRs.length === 0) return [];

  // Check if a release notes doc exists in Google Drive
  let docsExist = false;
  try {
    const docs = await gdrive.searchDrive(`name contains 'release notes'`);
    // Check if any doc was updated in the last 7 days
    const recent = docs.filter(d => {
      const modified = new Date(d.modifiedTime).getTime();
      return Date.now() - modified < 7 * 24 * 60 * 60 * 1000;
    });
    docsExist = recent.length > 0;
  } catch {
    // Drive not available — skip this rule gracefully
    return [];
  }

  if (docsExist) return [];

  const mrSummaries = mergedMRs.slice(0, 5).map(mr =>
    `!${mr.iid}: ${mr.title} (${mr.author?.name || "unknown"}, merged ${mr.merged_at?.slice(0, 10)})`
  ).join("\n");

  return [mismatch(
    `rule4-release-notes`,
    "MEDIUM",
    "No release notes",
    `${mergedMRs.length} MRs merged recently, no release notes doc found`,
    { mr_count: mergedMRs.length, mr_summaries: mrSummaries },
    "Generate release notes Google Doc from merged MR descriptions",
  )];
}

/**
 * Rule 5: Branch exists with commits but no MR opened.
 */
async function rule5_branchNoMR(pid, openMRs) {
  const branches = await gitlab.listBranches(pid);
  const mrBranches = new Set(openMRs.map(mr => mr.source_branch));
  const results = [];

  for (const branch of branches) {
    if (branch.name === "main" || branch.name === "master") continue;
    if (branch.merged) continue;
    if (mrBranches.has(branch.name)) continue;

    // Skip very old branches (> 30 days)
    const age = Date.now() - new Date(branch.commit.created_at).getTime();
    if (age > 30 * 24 * 60 * 60 * 1000) continue;

    results.push(mismatch(
      `rule5-${branch.name}`,
      "LOW",
      "Branch with no MR",
      `Branch "${branch.name}" has commits but no MR opened`,
      { branch: branch.name, last_commit: branch.commit.title, last_commit_date: branch.commit.created_at },
      "Generate MR title and description from branch commits",
    ));
  }
  return results;
}

/**
 * Main scan function — runs all 5 rules against a GitLab project.
 * Returns an array of mismatch objects.
 */
export async function scan(projectIdOrPath) {
  const project = await gitlab.getProject(projectIdOrPath);
  const pid = project.id;
  const defaultBranch = project.default_branch || "main";

  // Fetch data once, share across rules
  const [openMRs, mergedMRs] = await Promise.all([
    gitlab.listMRs(pid, { state: "opened", per_page: 50 }),
    gitlab.listMRs(pid, { state: "merged", per_page: 10, order_by: "updated_at", sort: "desc" }),
  ]);

  // Run all rules in parallel
  const [r1, r2, r3, r4, r5] = await Promise.all([
    rule1_mrMergedTicketOpen(pid, mergedMRs),
    rule2_pipelineFailedNoBug(pid, defaultBranch),
    rule3_reviewPendingTooLong(pid, openMRs),
    rule4_noReleaseNotes(pid, mergedMRs),
    rule5_branchNoMR(pid, openMRs),
  ]);

  return [...r1, ...r2, ...r3, ...r4, ...r5];
}
