> **Historical planning document.** This predates the audited implementation and includes unshipped ideas and unverified claims. See [README](README.md), [current audit](docs/AUDIT.md), and [demo guide](docs/DEMO.md) for what actually exists.

# ChhotaBheem — Task Breakdown

## Phase 0: Project Setup (Pre-Hack, ~1 hour)

- [ ] **T0.1** Initialize Node.js project with TypeScript
  - `npm init`, install `typescript`, `tsx`, `tsup`, `@modelcontextprotocol/sdk`
  - Create `tsconfig.json` with strict mode
  - Create `src/server.ts` entry point (hello world MCP server)

- [ ] **T0.2** Verify MCP server starts and connects to Kiro
  - Add entry to `~/.kiro/settings/mcp.json`
  - Register one dummy tool, confirm Kiro sees it
  - This validates the entire integration path before writing real code

- [ ] **T0.3** Set up `src/config.ts` with TEST_MODE and environment loading
  - `CHHOTABHEEM_TEST_MODE` env var
  - `GITLAB_TOKEN`, `GITLAB_HOST`, `CHHOTABHEEM_CONFIG` path
  - Logger with debug level when TEST_MODE

---

## Phase 1: GitLab API Client (Pre-Hack, ~3-4 hours)

- [ ] **T1.1** Create `src/clients/gitlab-client.ts`
  - Token resolution: read from env, fallback to `glab auth token`
  - Base request helper: `gitlabFetch(path, options)` with auth headers
  - Error handling: rate limits, 401/403, not found

- [ ] **T1.2** Implement GitLab API methods
  - `searchCode(query, projectPath?, scope?)` → `GET /search`
  - `getProject(pathOrId)` → `GET /projects/:id`
  - `listMRs(projectId, filters)` → `GET /merge_requests`
  - `getMR(projectId, mrIid)` → `GET /merge_requests/:iid` (with changes, discussions)
  - `createMR(projectId, payload)` → `POST /merge_requests`
  - `getPipeline(projectId, pipelineId?)` → `GET /pipelines`
  - `getJobLog(projectId, jobId)` → `GET /jobs/:id/trace`
  - `retryPipeline(projectId, pipelineId)` → `POST /pipelines/:id/retry`
  - `listIssues(projectId, filters)` → `GET /issues`
  - `createIssue(projectId, payload)` → `POST /issues`
  - `getFile(projectId, filePath, ref)` → `GET /repository/files/:path`
  - `listBranches(projectId)` → `GET /repository/branches`
  - `compareBranches(projectId, from, to)` → `GET /repository/compare`

- [ ] **T1.3** Test GitLab client against real repos
  - Use own repos on gitlab.com
  - Verify search, MR listing, pipeline fetch, file read all work
  - Document any API quirks or limitations

---

## Phase 2: JIRA Client (Pre-Hack, ~2-3 hours)

- [ ] **T2.1** Create `src/clients/jira-client.ts`
  - CLI wrapper: spawn `jira` commands, capture stdout, parse output
  - Handle both tabular and `--raw` (JSON) output modes

- [ ] **T2.2** Implement JIRA methods
  - `listIssues(project, jql?)` → `jira issue list -q "..." --raw`
  - `getIssue(key)` → `jira issue view KEY --raw`
  - `createIssue(project, type, summary, body, priority?, labels?)` → `jira issue create`
  - `moveIssue(key, state, comment?, resolution?)` → `jira issue move`
  - `assignIssue(key, assignee)` → `jira issue assign`
  - `addComment(key, body)` → `jira issue comment add`

- [ ] **T2.3** Test JIRA client
  - List issues from a real project
  - Test issue view with JSON output
  - Verify transition commands work (use a test ticket if possible)

---

## Phase 3: MCP Tool Registration (Pre-Hack, ~3-4 hours)

- [ ] **T3.1** Create GitLab MCP tools in `src/tools/gitlab/`
  - Each tool: schema definition + handler function
  - `search_code` — search across one or all repos
  - `get_project` — project metadata and CI status
  - `list_mrs` — list MRs with filters
  - `get_mr` — full MR detail with diff
  - `create_mr` — create MR (with AI description if not TEST_MODE)
  - `get_pipeline` — pipeline status + failed job details
  - `get_job_log` — raw CI job log (truncated to reasonable size)
  - `retry_pipeline` — retry failed pipeline
  - `list_issues` — search/list GitLab issues
  - `create_issue` — create GitLab issue
  - `get_file` — read file from any repo at any ref
  - `list_branches` — branches with last activity
  - `get_diff` — compare two refs

- [ ] **T3.2** Create JIRA MCP tools in `src/tools/jira/`
  - `jira_get_issue` — fetch issue details
  - `jira_list_issues` — search with JQL
  - `jira_create_issue` — create new issue
  - `jira_move_issue` — transition state
  - `jira_assign_issue` — assign to user
  - `jira_add_comment` — add comment

- [ ] **T3.3** Wire all tools into `src/server.ts`
  - Register tools with MCP SDK
  - Add tool listing capability
  - Test each tool from Kiro chat

---

## Phase 4: Brain / Config Layer (Pre-Hack, ~2 hours)

- [ ] **T4.1** Create `.chhotabheem/` config schema
  - `config.yaml` — global settings (gitlab host, default project, test mode)
  - `repos/*.yaml` — per-repo metadata
  - `team/colleagues.yaml` — team member info
  - `workflows/mr-checklist.yaml` — MR creation rules

- [ ] **T4.2** Create `src/brain/config-loader.ts`
  - Load and parse YAML configs
  - Resolve repo names to full GitLab paths
  - Cache loaded config in memory

- [ ] **T4.3** Create `src/brain/repo-metadata.ts`
  - Given a repo name, return: tech stack, key files, owners, conventions
  - Used by intelligence tools for context

- [ ] **T4.4** Create sample config for known repos
  - n1-ads-api (Ruby/Rails)
  - enablement-ui (React/TypeScript)
  - n1-ads-services
  - n1-ads-ref-airflow

---

## Phase 5: Kiro Integration Files (Pre-Hack, ~1 hour)

- [ ] **T5.1** Create `kiro-integration/mcp.json.example`
  - Ready-to-copy MCP server config
  - Document all env vars

- [ ] **T5.2** Create `kiro-integration/steering.md`
  - Auto-inclusion steering file
  - Lists available tools
  - Provides context about user's repos

- [ ] **T5.3** Create hook definitions
  - Pipeline watcher (SessionStart)
  - Cross-repo context prompt (SessionStart)

---

## Phase 6: Intelligence Tools (Hackathon Day 1-2)

> These need AI (Bedrock) and are the hackathon-day work.

- [ ] **T6.1** Create `src/clients/ai-client.ts`
  - Interface: `generateText(prompt, options) → string`
  - Bedrock provider (uses AWS SDK)
  - Ollama provider (uses localhost API)
  - Passthrough provider (returns raw data, lets Kiro model handle it)

- [ ] **T6.2** `repo_status` tool
  - Scan all configured repos
  - Return: branch, dirty state, pipeline status, open MR count
  - No AI needed — pure data aggregation

- [ ] **T6.3** `smart_review` tool
  - Takes MR iid + project
  - Fetches diff
  - Loads repo conventions from brain
  - Sends to AI: "Review this diff against these conventions"
  - Returns structured feedback

- [ ] **T6.4** `explain_failure` tool
  - Takes pipeline ID or "latest failed"
  - Fetches job log
  - Loads pipeline playbooks from brain
  - Sends to AI: "Explain this failure and suggest a fix"
  - Returns: root cause, suggestion, auto-fix command if available

- [ ] **T6.5** `suggest_reviewer` tool
  - Takes MR diff file paths
  - Loads team reviewer map
  - Cross-references with GitLab blame/history
  - Returns: recommended reviewer(s) with reasoning

---

## Phase 7: JIRA-to-MR Pipeline (Hackathon Day 2-3 Stretch)

- [ ] **T7.1** `jira_to_branch` tool
  - Read JIRA issue → extract key + summary
  - Create branch: `feature/{JIRA-KEY}-{slugified-summary}`
  - Push empty branch to GitLab

- [ ] **T7.2** `jira_to_mr` tool (full pipeline)
  - Read JIRA issue requirements
  - Load target repo context
  - Generate implementation plan via AI
  - Create branch + scaffold code changes
  - Open draft MR with JIRA link
  - Update JIRA ticket status to "In Progress"

---

## Phase 8: QOL / Polish (Hackathon Day 2-3)

- [ ] **T8.1** Pipeline watcher background hook
  - Poll configured repos every 60s for pipeline status changes
  - Notify on failure with summary

- [ ] **T8.2** Cross-repo context auto-prompt
  - Detect multiple repos in workspace
  - Steering file suggests using ChhotaBheem for cross-repo context

- [ ] **T8.3** Multi-repo status view
  - `repo_status` shows all repos at once
  - Git branch, dirty state, pipeline status, latest MR

- [ ] **T8.4** Google Workspace via Apps Script (stretch)
  - Deploy Google Apps Script as web app
  - MCP tool `google_calendar` to fetch today's meetings
  - MCP tool `google_drive_search` to find docs

---

## Phase 9: Demo & Submission (Hackathon Day 3)

- [ ] **T9.1** Record 3-min demo video
  - 0:00-0:20 — The problem (AI can't talk to GitLab)
  - 0:20-2:15 — Live demo (repo status, pipeline debug, JIRA-to-MR)
  - 2:15-2:45 — Architecture overview
  - 2:45-3:00 — Path to production

- [ ] **T9.2** Create 5-slide deck
  - Title + Team
  - Problem (the gap)
  - Solution / Architecture
  - Demo result / metrics
  - Next steps + ask

- [ ] **T9.3** Write 150-word project description

- [ ] **T9.4** Push final code to Nielsen GitLab
  - Ensure repo is accessible to judges
  - Clean up any sensitive tokens/configs

---

## Priority Order (If Time Runs Short)

Must-have (wins the stream):
1. T0 — Project setup + Kiro integration verified
2. T1 — GitLab client
3. T3.1 — GitLab MCP tools
4. T5 — Kiro steering + hooks
5. T9 — Demo video + slides

Should-have (makes it impressive):
6. T2 — JIRA client
7. T3.2 — JIRA MCP tools
8. T6.2 — Repo status
9. T6.4 — Explain failure (if Bedrock available)

Nice-to-have (stretch goals):
10. T6.3 — Smart review
11. T7 — JIRA-to-MR pipeline
12. T8 — QOL features
13. T4 — Full brain config system
