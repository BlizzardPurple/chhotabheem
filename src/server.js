#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scan } from "./tools/scan.js";
import { reconcile } from "./tools/reconcile.js";
import * as notebook from "./notebook/notebook.js";
import * as gitlab from "./clients/gitlab.js";
import * as jira from "./clients/jira.js";

const server = new McpServer({
  name: "project-sync",
  version: "0.1.0",
});

// In-memory store for the last scan results (keyed by project)
const scanCache = new Map();

// ─── Tool: scan ──────────────────────────────────────────────────────────
server.tool(
  "scan",
  "Scan a GitLab project for cross-tool mismatches (JIRA, GitLab, Google Drive). Returns a list of detected issues with severity, description, and suggested actions.",
  { project: z.string().describe("GitLab project path (e.g. 'nielsen-media/.../enablement-ui') or numeric project ID") },
  async ({ project }) => {
    try {
      const mismatches = await scan(project);

      // Cache results for reconcile
      scanCache.set(project, mismatches);

      // Save to notebook
      const projDir = await notebook.getProjectDirByPath(project);
      if (projDir) {
        const summary = mismatches.length === 0
          ? "No mismatches found. All tools are in sync. ✅"
          : mismatches.map((m, i) =>
              `${i + 1}. [${m.severity}] ${m.summary}\n   Suggested: ${m.suggestedAction}`
            ).join("\n");
        await notebook.appendSyncLog(projDir.dir, `### Mismatches Found: ${mismatches.length}\n${summary}`);
        await notebook.saveLastScan(projDir.dir, mismatches);
        await notebook.markSession(projDir.dir);
      }

      if (mismatches.length === 0) {
        return { content: [{ type: "text", text: "✅ No mismatches found. All tools are in sync." }] };
      }

      const report = mismatches.map((m, i) =>
        `**${i + 1}. [${m.severity}] ${m.rule}**\n${m.summary}\n→ Suggested: ${m.suggestedAction}`
      ).join("\n\n");

      return {
        content: [{
          type: "text",
          text: `⚠ **${mismatches.length} mismatches found:**\n\n${report}\n\nUse the \`reconcile\` tool with the mismatch number to fix an issue.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Scan failed: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: reconcile ─────────────────────────────────────────────────────
server.tool(
  "reconcile",
  "Fix a detected mismatch from the last scan. Some actions run automatically (ticket creation, notifications), others need user approval (JIRA transitions, MR creation).",
  {
    project: z.string().describe("GitLab project path or ID (same as used in scan)"),
    mismatch_number: z.number().describe("Mismatch number from the scan results (1-based)"),
    approved: z.boolean().optional().describe("Set to true to approve actions that need confirmation"),
  },
  async ({ project, mismatch_number, approved }) => {
    try {
      const mismatches = scanCache.get(project);
      if (!mismatches || mismatches.length === 0) {
        return { content: [{ type: "text", text: "No scan results found. Run `scan` first." }] };
      }

      const idx = mismatch_number - 1;
      if (idx < 0 || idx >= mismatches.length) {
        return { content: [{ type: "text", text: `Invalid mismatch number. Choose 1-${mismatches.length}.` }] };
      }

      const m = mismatches[idx];
      const result = await reconcile(m);

      if (result.needs_approval && !approved) {
        return {
          content: [{
            type: "text",
            text: `🔒 **Approval required:**\n${result.description}\n\nCall reconcile again with \`approved: true\` to proceed.`,
          }],
        };
      }

      const output = await result.execute();

      // Log to notebook
      const projDir = await notebook.getProjectDirByPath(project);
      if (projDir) {
        await notebook.appendSyncLog(projDir.dir,
          `### Reconciled: ${m.rule}\n${output}\n`
        );
      }

      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Reconcile failed: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: repo_status ───────────────────────────────────────────────────
server.tool(
  "repo_status",
  "Get a quick overview of a GitLab project: open MRs, latest pipeline status, recent activity.",
  { project: z.string().describe("GitLab project path or ID") },
  async ({ project }) => {
    try {
      const proj = await gitlab.getProject(project);
      const [openMRs, pipelines] = await Promise.all([
        gitlab.listMRs(proj.id, { state: "opened", per_page: 10 }),
        gitlab.listPipelines(proj.id, { ref: proj.default_branch, per_page: 1 }),
      ]);

      const pipe = pipelines[0];
      const pipeStatus = pipe ? `${pipe.status} (#${pipe.id})` : "no pipelines";

      const mrList = openMRs.length === 0
        ? "  None"
        : openMRs.map(mr =>
            `  !${mr.iid} ${mr.title} (${mr.author?.name}, ${mr.has_conflicts ? "⚠ conflicts" : "clean"})`
          ).join("\n");

      const text = [
        `**${proj.path_with_namespace}**`,
        `Branch: ${proj.default_branch} | Pipeline: ${pipeStatus}`,
        `Open MRs: ${openMRs.length}`,
        mrList,
        `URL: ${proj.web_url}`,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: get_sync_log ──────────────────────────────────────────────────
server.tool(
  "get_sync_log",
  "Read the ProjectSync notebook — past scan results, reconciliation actions, and decisions for a project.",
  { project: z.string().optional().describe("GitLab project path or ID. If omitted, tries to detect from current git repo.") },
  async ({ project }) => {
    try {
      let projDir;
      if (project) {
        projDir = await notebook.getProjectDirByPath(project);
      } else {
        projDir = await notebook.getProjectDir();
      }
      if (!projDir) {
        return { content: [{ type: "text", text: "Could not determine project. Pass a project path or ID." }] };
      }
      const log = await notebook.readSyncLog(projDir.dir);
      return { content: [{ type: "text", text: `**Sync log for ${projDir.repoName}:**\n\n${log}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: session_diff ──────────────────────────────────────────────────
server.tool(
  "session_diff",
  "Show what changed since the last ProjectSync session — new mismatches, resolved mismatches, MR status changes, pipeline results. Use this at the start of a new session to get caught up.",
  { project: z.string().describe("GitLab project path or ID") },
  async ({ project }) => {
    try {
      const projDir = await notebook.getProjectDirByPath(project);
      if (!projDir) {
        return { content: [{ type: "text", text: "Project not found." }], isError: true };
      }

      // Read last scan results
      const lastScan = await notebook.readLastScan(projDir.dir);
      const lastSession = await notebook.readLastSession(projDir.dir);

      // Run a fresh scan
      const currentMismatches = await scan(project);

      // Save current state
      await notebook.saveLastScan(projDir.dir, currentMismatches);
      await notebook.markSession(projDir.dir);

      // No previous scan — this is the first time
      if (!lastScan || !Array.isArray(lastScan)) {
        scanCache.set(project, currentMismatches);
        const report = currentMismatches.length === 0
          ? "✅ No mismatches found."
          : currentMismatches.map((m, i) =>
              `${i + 1}. [${m.severity}] ${m.summary}`
            ).join("\n");

        return {
          content: [{
            type: "text",
            text: `**First scan for this project.** No previous session to compare.\n\n${currentMismatches.length} mismatches found:\n${report}`,
          }],
        };
      }

      // Diff: what's new, what's resolved, what persists
      const lastIds = new Set(lastScan.map(m => m.id));
      const currentIds = new Set(currentMismatches.map(m => m.id));

      const newMismatches = currentMismatches.filter(m => !lastIds.has(m.id));
      const resolvedMismatches = lastScan.filter(m => !currentIds.has(m.id));
      const persistent = currentMismatches.filter(m => lastIds.has(m.id));

      // Also check MR/pipeline changes via GitLab
      let mrChanges = "";
      try {
        const proj = await gitlab.getProject(project);
        const recentMRs = await gitlab.listMRs(proj.id, { state: "merged", per_page: 5, order_by: "updated_at", sort: "desc" });
        const lastTime = lastSession ? new Date(lastSession).getTime() : 0;
        const newlyMerged = recentMRs.filter(mr => new Date(mr.merged_at).getTime() > lastTime);
        if (newlyMerged.length > 0) {
          mrChanges = `\n**MRs merged since last session:**\n` +
            newlyMerged.map(mr => `- !${mr.iid} ${mr.title} (${mr.author?.name})`).join("\n");
        }

        const pipes = await gitlab.listPipelines(proj.id, { ref: proj.default_branch, per_page: 3 });
        const recentPipes = pipes.filter(p => new Date(p.created_at).getTime() > lastTime);
        if (recentPipes.length > 0) {
          mrChanges += `\n\n**Pipeline runs since last session:**\n` +
            recentPipes.map(p => `- #${p.id} ${p.status} (${p.created_at.slice(0, 16)})`).join("\n");
        }
      } catch {}

      // Update scan cache
      scanCache.set(project, currentMismatches);

      // Build summary
      const sinceText = lastSession
        ? `since ${lastSession.slice(0, 16).replace("T", " ")}`
        : "since last scan";

      const lines = [`**Changes ${sinceText}:**`];

      if (resolvedMismatches.length > 0) {
        lines.push(`\n✅ **${resolvedMismatches.length} resolved:**`);
        resolvedMismatches.forEach(m => lines.push(`- ~~${m.summary}~~`));
      }

      if (newMismatches.length > 0) {
        lines.push(`\n🆕 **${newMismatches.length} new:**`);
        newMismatches.forEach(m => lines.push(`- [${m.severity}] ${m.summary}`));
      }

      if (persistent.length > 0) {
        lines.push(`\n⏳ **${persistent.length} still open:**`);
        persistent.forEach(m => lines.push(`- [${m.severity}] ${m.summary}`));
      }

      if (mrChanges) lines.push(mrChanges);

      if (resolvedMismatches.length === 0 && newMismatches.length === 0 && !mrChanges) {
        lines.push("\nNo changes since last session. Everything is the same.");
      }

      // Log to notebook
      await notebook.appendSyncLog(projDir.dir,
        `### Session Diff\n${lines.join("\n")}\n`
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Session diff failed: ${err.message}` }], isError: true };
    }
  }
);

// ─── Tool: jira_to_mr ────────────────────────────────────────────────────
server.tool(
  "jira_to_mr",
  `Create a GitLab branch and MR from a JIRA ticket. Reads the ticket, extracts requirements, creates a branch with the correct naming convention, and opens a draft MR linked back to the ticket.

If information is missing or ambiguous, this tool returns QUESTIONS instead of proceeding — the user must answer them before the tool continues.

Example questions it might ask:
- "Which GitLab project should this MR target?"
- "The ticket has no acceptance criteria — what should the MR accomplish?"
- "Multiple repos are configured — which one: enablement-ui or n1-ads-api?"`,
  {
    jira_key: z.string().describe("JIRA ticket key, e.g. N1AREF-1234"),
    project: z.string().describe("GitLab project path or ID to create the MR in"),
    target_branch: z.string().optional().describe("Target branch (default: main)"),
    answers: z.record(z.string()).optional().describe("Answers to previously asked questions, keyed by question ID (q1, q2, etc.)"),
  },
  async ({ jira_key, project, target_branch, answers }) => {
    try {
      // Step 1: Read the JIRA ticket
      const issue = await jira.viewIssue(jira_key);
      if (!issue) {
        return { content: [{ type: "text", text: `❌ Could not find JIRA ticket ${jira_key}. Check the key and try again.` }] };
      }

      // Parse issue — handle both JSON and raw string formats
      let summary, description, issueType, status, assignee;
      if (typeof issue === "object") {
        summary = issue.fields?.summary || issue.summary || "";
        description = issue.fields?.description || issue.description || "";
        issueType = issue.fields?.issuetype?.name || issue.type || "Task";
        status = issue.fields?.status?.name || issue.status || "";
        assignee = issue.fields?.assignee?.displayName || issue.assignee || "";
      } else {
        // Raw string — extract what we can
        summary = jira_key;
        description = String(issue);
        issueType = "Task";
        status = "";
        assignee = "";
      }

      // Step 2: Check for missing info — ask questions
      const questions = [];

      if (!summary || summary === jira_key) {
        questions.push({ id: "q1", question: `Could not parse the ticket summary. What should the MR title be?` });
      }

      if (!description && !(answers?.q2)) {
        questions.push({ id: "q2", question: `Ticket ${jira_key} has no description or acceptance criteria. What should this MR accomplish? What files or areas will it change?` });
      }

      if (questions.length > 0 && !answers) {
        const qText = questions.map(q => `**${q.id}:** ${q.question}`).join("\n\n");
        return {
          content: [{
            type: "text",
            text: `🤔 **I need more info before creating the MR:**\n\n${qText}\n\nCall \`jira_to_mr\` again with the same params plus \`answers: { "q1": "your answer", ... }\``,
          }],
        };
      }

      // Step 3: Resolve project
      const proj = await gitlab.getProject(project);
      const target = target_branch || proj.default_branch || "main";

      // Step 4: Build branch name and MR details
      const slug = (answers?.q1 || summary)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);
      const branchName = `${jira_key}_${slug}`;

      const mrDescription = [
        `## ${jira_key}: ${answers?.q1 || summary}`,
        ``,
        `**JIRA:** [${jira_key}](${process.env.JIRA_URL || "https://jira.nielsen.com"}/browse/${jira_key})`,
        `**Type:** ${issueType}`,
        assignee ? `**Assignee:** ${assignee}` : "",
        ``,
        `### Description`,
        answers?.q2 || description || "(No description provided)",
        ``,
        `---`,
        `*MR created by ProjectSync from JIRA ticket ${jira_key}*`,
      ].filter(Boolean).join("\n");

      const mrTitle = `Draft: ${jira_key} ${answers?.q1 || summary}`;

      // Step 5: Create branch via GitLab API
      let branchCreated = false;
      try {
        const token = await (async () => {
          // Reuse the token extraction from gitlab client
          const { execFile } = await import("child_process");
          return new Promise((resolve) => {
            execFile("glab", ["auth", "status", "-t"], { timeout: 10000 }, (err, stdout, stderr) => {
              const combined = (stdout || "") + (stderr || "");
              const match = combined.match(/Token.*:\s*(\S+)/);
              resolve(match ? match[1] : null);
            });
          });
        })();

        const branchRes = await fetch(`https://gitlab.com/api/v4/projects/${proj.id}/repository/branches`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ branch: branchName, ref: target }),
        });

        if (branchRes.ok) {
          branchCreated = true;
        } else {
          const err = await branchRes.json().catch(() => ({}));
          // Branch might already exist — that's fine
          if (err.message?.includes("already exists")) {
            branchCreated = true;
          } else {
            return {
              content: [{
                type: "text",
                text: `⚠️ Could not create branch "${branchName}": ${err.message || branchRes.status}\n\nYou can create it manually: \`git checkout -b ${branchName}\` and then run this tool again.`,
              }],
            };
          }
        }
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `⚠️ Branch creation failed: ${e.message}\n\n**Manual fallback:**\n\`\`\`\ngit checkout -b ${branchName}\ngit push -u origin ${branchName}\n\`\`\`\nThen run this tool again.`,
          }],
        };
      }

      // Step 6: Create draft MR
      let mr;
      try {
        mr = await gitlab.createMR(proj.id, branchName, target, mrTitle, mrDescription);
      } catch (e) {
        // MR might fail if no diff — branch was just created with same HEAD
        return {
          content: [{
            type: "text",
            text: [
              `✅ Branch created: \`${branchName}\``,
              ``,
              `⚠️ MR could not be created yet (branch has no changes vs ${target}).`,
              `This is normal — push some commits first, then the MR will be created.`,
              ``,
              `**Next steps:**`,
              `1. \`git checkout ${branchName}\``,
              `2. Make your changes`,
              `3. \`git push\``,
              `4. Run this tool again, or create the MR manually with:`,
              `   - Title: \`${mrTitle}\``,
              `   - Description: pre-filled with JIRA link and details`,
              ``,
              `**Prepared MR description:**`,
              mrDescription,
            ].join("\n"),
          }],
        };
      }

      // Step 7: Update JIRA ticket status if it's in "To Do" or "Open"
      let jiraUpdate = "";
      if (/to do|open|backlog|new/i.test(status)) {
        try {
          await jira.moveIssue(jira_key, "In Progress", `Branch and MR created by ProjectSync: ${mr.web_url}`);
          jiraUpdate = `\n✅ ${jira_key} moved to "In Progress"`;
        } catch {
          jiraUpdate = `\n⚠️ Could not transition ${jira_key} to "In Progress" — do it manually.`;
        }
      }

      // Step 8: Log to notebook
      const projDir = await notebook.getProjectDirByPath(project);
      if (projDir) {
        await notebook.appendSyncLog(projDir.dir,
          `### JIRA → MR: ${jira_key}\nBranch: ${branchName}\nMR: !${mr.iid} ${mr.web_url}\n${jiraUpdate}\n`
        );
      }

      return {
        content: [{
          type: "text",
          text: [
            `✅ **MR created from ${jira_key}**`,
            ``,
            `**Branch:** \`${branchName}\``,
            `**MR:** [!${mr.iid} — ${mrTitle}](${mr.web_url})`,
            `**Target:** ${target}`,
            jiraUpdate,
            ``,
            `The MR description includes the JIRA link, ticket type, and description.`,
            `Push your changes to \`${branchName}\` and the MR is ready for review.`,
          ].join("\n"),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `jira_to_mr failed: ${err.message}` }], isError: true };
    }
  }
);

// ─── Start ───────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
