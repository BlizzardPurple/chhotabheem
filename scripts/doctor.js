import "../src/load-env.js";
import { execFile } from "node:child_process";
const checks = [];
function status(name, ok, detail) { checks.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "CHECK"} ${name}: ${detail}`); }
const cli = (cmd, args) => new Promise(resolve => execFile(cmd, args, { timeout: 10_000 }, error => resolve(!error)));
status("Node", Number(process.versions.node.split(".")[0]) >= 20, process.versions.node);
const [glab, jira] = await Promise.all([cli("glab", ["--version"]), cli("jira", ["version"])]);
status("GitLab authentication path", Boolean(process.env.GITLAB_TOKEN) || glab, process.env.GITLAB_TOKEN ? "API token configured (value hidden)" : glab ? "glab installed; scan will verify authentication" : "Set GITLAB_TOKEN or install/authenticate glab");
const jiraRest = process.env.JIRA_TRANSPORT === "rest" || (process.env.JIRA_TRANSPORT !== "cli" && Boolean(process.env.JIRA_TOKEN || (process.env.JIRA_API_TOKEN && process.env.JIRA_EMAIL && process.env.JIRA_URL)));
status("Jira authentication path", jiraRest || jira,
  jiraRest ? "REST mode selected (credential values hidden)" : jira ? "jira CLI installed; scan will verify authentication" : "Configure Jira REST credentials or install/authenticate jira-cli");
const project = process.env.GITLAB_PROJECT;
status("Project configuration", Boolean(project && !project.includes("YOUR_") && process.env.JIRA_PROJECT), "Set GITLAB_PROJECT and JIRA_PROJECT in .env; use a demo sandbox");
if (project && !project.includes("YOUR_")) {
  try {
    const { scanDetailed } = await import("../src/tools/scan.js");
    const report = await scanDetailed(project);
    status("GitLab read access", true, `Project resolved; ${report.mismatches.length} findings`);
    for (const check of report.checks) status(check.rule, check.status === "complete", check.message || "Read check completed");
    // A healthy pipeline can skip Jira search, so independently verify its project access.
    const jiraClient = await import("../src/clients/jira.js");
    await jiraClient.listIssues(process.env.JIRA_PROJECT, `project = "${process.env.JIRA_PROJECT}" ORDER BY updated DESC`);
    status("Jira read access", true, "Configured project query succeeded");
  } catch (error) { status("Live read check", false, error.message); }
}
console.log("\nRead-only preflight. This does not verify write permissions or Jira workflow validators. Drive is optional; missing Drive must remain visible as partial coverage.");
process.exitCode = checks.some(c => !c.ok) ? 1 : 0;
