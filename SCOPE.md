# ChhotaBheem — GitLab AI Integration for Nielsen

**Hack-AI-Thon '26 | Stream: AI Enablement | Team: Ctrl+Automate**

> The AI-to-GitLab bridge that Nielsen doesn't have yet.
> Glean lists GitLab as "Coming Soon." We deliver it now.

---

## 1. What Are We Delivering?

The core product is an **AI layer on top of GitLab** that works from inside the developer's IDE (Kiro) and terminal. Not a website. Not a dashboard. It lives where developers already work.

### Delivery Format Options (Ranked by UX)

#### Option A: Kiro MCP Server ⭐ RECOMMENDED

An MCP server that exposes GitLab operations as AI-callable tools. Plug it into Kiro's `mcp.json` and every Kiro session can talk to GitLab natively.

| Aspect | Detail |
|---|---|
| **UX** | ⭐⭐⭐⭐⭐ — Natural language in Kiro chat. "Show me failing pipelines" just works. |
| **Distribution** | Drop a JSON block into `~/.kiro/settings/mcp.json`. One config change. |
| **Demo impact** | High — show Kiro doing GitLab ops in real-time conversation. |
| **Build effort** | Medium — MCP SDK is well-documented, GitLab REST API is comprehensive. |
| **Dependencies** | Node.js or Python, MCP SDK (`@modelcontextprotocol/sdk` or `mcp` python pkg), GitLab Personal Access Token, `glab` CLI as fallback. |
| **Hackathon fit** | Perfect — self-contained, no external hosting needed, runs locally. |

```jsonc
// What installation looks like — one entry in mcp.json
{
  "mcpServers": {
    "chhotabheem": {
      "command": "node",
      "args": ["path/to/chhotabheem/server.js"],
      "env": {
        "GITLAB_TOKEN": "${GITLAB_TOKEN}",
        "GITLAB_HOST": "https://gitlab.com"
      }
    }
  }
}
```

#### Option B: Kiro Power (MCP Server + Steering + Skills bundle)

Everything in Option A, plus bundled steering files and skills that guide Kiro's behavior.

| Aspect | Detail |
|---|---|
| **UX** | ⭐⭐⭐⭐⭐ — Same as MCP but with built-in workflows and documentation. |
| **Distribution** | Install as a Kiro Power — cleaner packaging. |
| **Build effort** | Medium-High — need to structure steering files, skills, and MCP server together. |
| **Dependencies** | Everything from Option A + Kiro Power packaging format. |
| **Hackathon fit** | Great if time allows. Option A is the MVP, this is the polish layer. |

#### Option C: Terminal CLI Companion

A standalone CLI tool (`bheem`) that wraps GitLab + AI operations for terminal users.

| Aspect | Detail |
|---|---|
| **UX** | ⭐⭐⭐⭐ — Fast, scriptable, works outside Kiro. |
| **Distribution** | `npm install -g chhotabheem` or just `npx`. |
| **Build effort** | Low-Medium — thinner than MCP, just command handlers. |
| **Dependencies** | Node.js, GitLab API, Bedrock SDK (for AI reasoning). |
| **Hackathon fit** | Good as a complementary interface. Not the primary deliverable. |

```bash
# What usage looks like
bheem pipelines --failing           # Show failing pipelines
bheem mr review 1234                # AI-review an MR
bheem mr create --smart             # Create MR with AI-generated title/description
bheem search "CampaignPolicy"       # Search across repos
```

#### Option D: Web Dashboard

A web UI showing GitLab state with AI-powered insights.

| Aspect | Detail |
|---|---|
| **UX** | ⭐⭐⭐⭐⭐ for demo, ⭐⭐⭐ for daily use — nobody wants another tab open. |
| **Distribution** | Deploy to AWS sandbox / Replit. |
| **Build effort** | High — frontend + backend + auth + real-time updates. |
| **Dependencies** | React, Node.js backend, WebSocket for live updates, GitLab OAuth. |
| **Hackathon fit** | Flashy demo but high build cost for a solo 2-day hack. |

### Recommended Build Order

```
Day 0 (Pre-hack):  Scaffold MCP server + define all tool schemas
Day 1 (Hack):      Option A (MCP Server) → core tools working in Kiro
Day 1 evening:     Option C (CLI) → thin wrapper over same logic
Day 2 (Hack):      Option B (Power packaging) + steering files + polish demo
Day 2 stretch:     Option D (lightweight web UI) only if time permits
```

---

## 2. Local Data Stash — The "Brain" Layer

Like Kiro steering files, but for GitLab context. A local `.chhotabheem/` directory (or `.kiro/chhotabheem/`) that holds persistent knowledge the AI uses across sessions.

### What Lives Here

```
.chhotabheem/
├── config.yaml                  # User preferences, GitLab host, default project
├── repos/
│   ├── n1-ads-api.yaml          # Repo metadata: tech stack, key files, owners, CI config
│   ├── enablement-ui.yaml       # Same structure per repo
│   ├── n1-ads-services.yaml
│   └── n1-ads-ref-airflow.yaml
├── team/
│   ├── colleagues.yaml          # Names, GitLab usernames, expertise areas, timezones
│   └── reviewers.yaml           # Who reviews what (auto-learned from MR history)
├── workflows/
│   ├── mr-checklist.yaml        # "MRs must have screenshots, JIRA ticket, tests"
│   ├── branch-naming.yaml       # "feature/JIRA-1234-short-description"
│   └── pipeline-playbooks.yaml  # "If eslint fails → run npm run lint:fix"
└── cache/
    ├── pipeline-history.json    # Recent pipeline results for trend analysis
    └── mr-patterns.json         # Learned patterns from past MRs
```

### Repo Metadata Example

```yaml
# .chhotabheem/repos/n1-ads-api.yaml
name: n1-ads-api
gitlab_path: nielsen-media/nts/n1/n1-ads-api  # (example path)
tech_stack:
  language: ruby
  framework: rails
  test_runner: rspec
  ci: gitlab-ci
key_files:
  - app/policies/campaign_policy.rb        # Authorization logic
  - app/controllers/campaigns_controller.rb
  - app/serializers/campaign_serializer.rb
  - config/routes.rb
owners:
  primary: ["garvit.jain3", "teammate1"]
  reviewers: ["senior-dev-1", "senior-dev-2"]
conventions:
  branch_pattern: "feature/{jira-key}-{short-desc}"
  mr_requirements:
    - "Link JIRA ticket in description"
    - "Include screenshots for UI changes"
    - "RSpec tests must pass"
    - "Rubocop must pass"
related_repos:
  - enablement-ui        # Frontend counterpart
  - n1-ads-services      # Microservices layer
  - n1-ads-ref-airflow   # Data pipelines
```

### Colleague / Reviewer Intelligence

```yaml
# .chhotabheem/team/colleagues.yaml
- name: "Garvit Jain"
  gitlab: "garvit.jain3"
  email: "garvit.jain@nielsen.com"
  expertise: ["n1-ads-api", "enablement-ui", "campaign-setup"]
  timezone: "IST"

# Auto-populated from MR history:
# .chhotabheem/team/reviewers.yaml
reviewer_map:
  "app/policies/**":     ["security-reviewer"]
  "app/controllers/**":  ["backend-lead"]
  "spec/**":             ["qa-lead"]
  "app/javascript/**":   ["frontend-lead"]
```

### Workflow Rules (User-Mandated Conventions)

```yaml
# .chhotabheem/workflows/mr-checklist.yaml
mr_creation:
  title_format: "{JIRA-KEY}: {short description}"
  required_in_description:
    - jira_ticket_link
    - what_changed
    - screenshots_if_ui
    - testing_notes
  auto_actions:
    - assign_reviewer_by_file_ownership
    - add_labels_by_file_path
    - link_jira_ticket_from_branch_name

# .chhotabheem/workflows/pipeline-playbooks.yaml
pipeline_failures:
  eslint_failure:
    auto_fix: "npm run lint:fix"
    notify: true
  rspec_failure:
    action: "analyze_failure_log"
    suggest_fix: true
  docker_build_failure:
    action: "check_dockerfile_changes"
    escalate_after: 2  # failures
```

---

## 3. Command Scope & Interface

### Core MCP Tools (MVP — Day 1)

| Tool Name | What It Does | GitLab API |
|---|---|---|
| `search_code` | Search code across one or all repos | `GET /search?scope=blobs` |
| `get_project` | Get project metadata, default branch, CI status | `GET /projects/:id` |
| `list_mrs` | List MRs with filters (mine, reviewing, all, merged) | `GET /projects/:id/merge_requests` |
| `get_mr` | Full MR detail: diff, discussions, approvals, pipeline | `GET /projects/:id/merge_requests/:mr_iid` |
| `create_mr` | Create MR with AI-generated title/description from diff | `POST /projects/:id/merge_requests` |
| `get_pipeline` | Get pipeline status and job details | `GET /projects/:id/pipelines/:id` |
| `get_job_log` | Read CI job logs (for failure analysis) | `GET /projects/:id/jobs/:id/trace` |
| `retry_pipeline` | Retry a failed pipeline | `POST /projects/:id/pipelines/:id/retry` |
| `list_issues` | List/search issues | `GET /projects/:id/issues` |
| `create_issue` | Create issue with AI-structured description | `POST /projects/:id/issues` |
| `get_file` | Read a file from any repo at any ref | `GET /projects/:id/repository/files/:path` |
| `list_branches` | List branches with last activity | `GET /projects/:id/repository/branches` |
| `get_diff` | Get diff between two refs (branches, tags, commits) | `GET /projects/:id/repository/compare` |

### Intelligence Tools (Day 2)

| Tool Name | What It Does | Dependencies |
|---|---|---|
| `smart_review` | AI code review: reads diff, checks patterns, suggests fixes | Bedrock Claude + repo conventions |
| `explain_failure` | Reads pipeline logs, identifies root cause, suggests fix | Bedrock Claude + pipeline playbooks |
| `suggest_reviewer` | Recommends reviewer based on file ownership history | MR history cache + team data |
| `summarize_changes` | Generates release notes from MR list between two tags | Bedrock Claude |
| `cross_repo_impact` | Shows what downstream repos might be affected by a change | Repo dependency graph |

### Kiro Hooks (Background Intelligence)

| Hook | Trigger | What It Does |
|---|---|---|
| `pipeline-watcher` | SessionStart | Starts background polling of active pipelines. Alerts on failure. |
| `mr-context` | PreToolUse (on file reads) | When reading a file, auto-fetches open MRs touching that file. |
| `smart-commit` | PostFileSave | Suggests commit message based on saved changes. |
| `cross-repo-prompt` | SessionStart | If multiple repos detected in workspace, prompts for cross-repo context loading. |

### How Do We Surface These?

**Primary: Kiro Chat (Natural Language)**
User types in Kiro: "Why did the pipeline fail on n1-ads-api?" → MCP server handles it. No special syntax needed. This is the main interface.

**Secondary: Terminal Commands**
For power users who want scriptable access:
```bash
bheem pipeline status n1-ads-api
bheem mr create --from-jira N1ADS-1234
bheem review mr 5678
```

**Tertiary: Kiro Steering Prompts**
Steering files that automatically activate when relevant:
```markdown
<!-- .kiro/steering/chhotabheem-gitlab.md -->
---
inclusion: auto
name: GitLab Context
description: Activates when user asks about MRs, pipelines, code review, or GitLab operations
---
You have access to the ChhotaBheem MCP server for GitLab operations.
Available tools: search_code, get_mr, create_mr, get_pipeline, ...
User's configured repos: {{repos from .chhotabheem/repos/}}
```

**NOT building: IDE sidebar or custom UI panels.** Too much effort for hackathon. The Kiro chat IS the UI.

---

## 4. Future / Stretch Goals (Day 2-3 + Post-Hack)

### JIRA Integration (HIGH PRIORITY — we already have CLI auth)

Status: `jira` CLI authenticated as `garvit.jain@nielsen.com`. Can list projects, query issues.

| Feature | What It Does |
|---|---|
| `jira_get_issue` | Fetch JIRA issue details (description, acceptance criteria, comments) |
| `jira_create_issue` | Create JIRA issue from Kiro conversation |
| `jira_to_branch` | Read JIRA ticket → create branch with correct naming → set up MR draft |
| `jira_to_mr` | Full flow: JIRA ticket → understand requirements → generate code scaffold → open MR |
| `jira_link_mr` | Auto-link MR to JIRA ticket, update ticket status |

JIRA CLI commands we can wrap:
```bash
jira issue list -q "project=N1ADS AND status='In Progress'"
jira issue view N1ADS-1234
jira issue create -t "Bug" -s "Summary" -b "Description" -p N1ADS
jira issue move N1ADS-1234 "In Review"
```

### Confluence Integration (STRETCH)

If JIRA works, Confluence likely shares auth. Could enable:
- Pull architecture docs as context for code changes
- Auto-update Confluence pages when code patterns change
- Search Confluence for existing solutions before coding

### Glean-Adjacent Features We Can Steal

| Glean Feature | Our Version | Feasibility |
|---|---|---|
| Cross-app search | Cross-repo code search + JIRA + Confluence in one query | ✅ Buildable |
| Activity feed | Recent MRs, pipeline results, JIRA updates in one view | ✅ Buildable |
| Knowledge graph | Repo dependency map + team ownership graph | ⚠️ Partial (manual config) |
| Google Workspace | Gmail/Calendar/Drive integration | ❌ Blocked (needs Google OAuth project key, org-restricted) |
| ServiceNow | Incident management integration | ❌ No CLI/API access confirmed |
| Salesforce | CRM integration | ❌ Out of scope for dev tooling |

### The JIRA-to-MR Pipeline (Day 3 Stretch)

```
JIRA Ticket (N1ADS-1234: "Add CTV placement type")
    │
    ▼
ChhotaBheem reads ticket requirements
    │
    ▼
Loads relevant repo context from .chhotabheem/repos/n1-ads-api.yaml
    │
    ▼
Bedrock Claude generates implementation plan
    │
    ▼
Code changes generated (model, controller, serializer, tests)
    │
    ▼
Branch created: feature/N1ADS-1234-add-ctv-placement
    │
    ▼
Changes committed + MR opened on GitLab
    │
    ▼
JIRA ticket moved to "In Review" + MR linked
```

---

## 5. Pre-Hack Edge Work (Now → Oct 26)

Things we can build RIGHT NOW on the private repo. No AWS/Replit keys needed.

### ✅ Can Do Now

| Task | Effort | Impact |
|---|---|---|
| MCP server scaffold (project structure, package.json, tool schemas) | 2-3 hours | Foundation for everything |
| GitLab API wrapper module (all REST endpoints we need) | 3-4 hours | Core dependency |
| JIRA CLI wrapper module (parse jira commands, structured output) | 2-3 hours | Enables JIRA integration |
| `.chhotabheem/` config schema + loader | 1-2 hours | Brain layer |
| Sample repo metadata files (n1-ads-api, enablement-ui) | 1 hour | Demo data |
| Steering files for Kiro | 1 hour | Auto-context loading |
| CLI tool scaffold (`bheem` command structure) | 1-2 hours | Bonus interface |
| Demo script + scenario planning | 1 hour | Rehearsal |
| README, architecture diagram | 1 hour | Submission materials |

### ⛔ Must Wait for Hackathon

| Task | Why |
|---|---|
| Bedrock Claude integration | Need AWS sandbox credentials |
| Pipeline watcher (background polling) | Needs real GitLab pipelines to monitor |
| Cross-repo search on Nielsen repos | Needs GitLab token with nielsen-media access |
| Live JIRA-to-MR flow | Needs both AWS (for AI) + GitLab (for MR creation) on real repos |
| Replit deployment (if doing web UI) | Need Replit Enterprise access |

### Estimated Pre-Hack Build Plan

```
Week 1 (Oct 13-17):
  ├── MCP server scaffold + tool schemas
  ├── GitLab API wrapper (all endpoints)
  └── Config schema + sample data

Week 2 (Oct 20-24):
  ├── JIRA CLI wrapper
  ├── CLI tool (bheem)
  ├── Steering files
  └── Demo scenarios + rehearsal

Oct 25-26:
  ├── Final polish
  ├── Architecture diagram
  └── Slide skeleton
```

---

## 6. QOL Features

### 6.1 Multi-Repo Git Management

**Problem:** You're in `Nrepos/` with 10+ repos each with separate `.git`. The git status bar is chaos. Only some repos show in the sidebar.

**Solution — Kiro Steering + Hook:**
```yaml
# .chhotabheem/config.yaml
workspace_repos:
  - path: ./n1-ads-api
    gitlab: nielsen-media/.../n1-ads-api
    active: true
  - path: ./enablement-ui
    gitlab: nielsen-media/.../enablement-ui
    active: true
  - path: ./cmi
    gitlab: nielsen-media/.../cmi
    active: false  # Don't monitor
```

MCP tool `repo_status` → shows git status across all active repos in one view:
```
n1-ads-api:        main ✓ (2 ahead, 1 behind) | Pipeline: ✅ passed
enablement-ui:     feature/new-form ✗ (3 modified) | Pipeline: 🔴 failed
n1-ads-services:   main ✓ (clean) | Pipeline: ✅ passed
```

### 6.2 Pipeline Notifications + Auto-Fix

**Problem:** Pipeline fails, you don't know until you manually check. Then you have to dig through logs.

**Solution — Background Watcher Hook:**

A Kiro hook that polls GitLab pipeline status on interval:

```
[Pipeline FAILED] n1-ads-api / branch: feature/add-ctv (Job: rspec)
→ Auto-analyzing failure log...
→ Root cause: Missing factory for CtvPlacement in spec/factories
→ Suggested fix: Add factory definition to spec/factories/ctv_placements.rb
→ [Apply Fix] [View Full Log] [Ignore]
```

Also for deployments:
```
[Deployed] n1-ads-api → QA Server
→ URL: https://qa.n1-ads.nielsen.internal
→ Deployed at: 2026-10-27 14:32 IST
→ MR #1234 included
```

Implementation: Kiro hook with `SessionStart` trigger that spawns a background poller. Checks `GET /projects/:id/pipelines?status=failed` every 60s.

### 6.3 Cross-Repo Context Auto-Prompt

**Problem:** When working on enablement-ui, you often need context from n1-ads-api (API contracts, serializer shapes). Kiro doesn't know about sibling repos.

**Solution — SessionStart Hook + Steering:**

```markdown
<!-- .kiro/steering/cross-repo-context.md -->
---
inclusion: auto
name: Cross-Repo Context
description: When user works across multiple Nielsen repos
---
Multiple repos detected in workspace. Use the ChhotaBheem `search_code` 
and `get_file` tools to fetch context from sibling repos when needed.

Known repo relationships:
- enablement-ui ↔ n1-ads-api (frontend/backend pair)
- n1-ads-api ↔ n1-ads-services (API/microservices)
- n1-ads-ref-airflow ↔ n1-ads-api (data pipeline/API)
```

### 6.4 JIRA Integration (Already Working!)

**Status:** `jira` CLI is authenticated. We have access to N1 Ads projects.

What we can build today:
- `jira issue view N1ADS-1234` → parse and feed to Kiro as context
- Auto-create branch from JIRA key
- Link MRs to JIRA tickets
- Move tickets through workflow states

What needs testing:
- Can we create issues programmatically?
- Can we add comments to tickets?
- Can we transition ticket status?

### 6.5 Google Workspace

**Status:** Blocked. Needs Google Cloud project key → restricted by Nielsen org.

**Workaround possibilities:**
- Google Calendar: `gcalcli` (CLI tool) might work with Google Workspace login
- Gmail: IMAP access might be available
- Google Drive: `gdrive` CLI tool, but auth is the same problem

**Verdict:** Park this. Glean already covers Google Workspace. We focus where Glean CAN'T go (GitLab, deep code operations).

### 6.6 ServiceNow / Salesforce

**Verdict:** Out of scope. Not developer tools. Glean can have these. Our moat is CODE + CI/CD + JIRA — the developer inner loop that Glean's search-first approach can't serve well.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                  KIRO IDE                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │   Chat   │  │  Hooks   │  │ Steering  │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │         │
│       └──────────┬───┘──────────────┘         │
│                  │                             │
│          ┌───────▼────────┐                   │
│          │  MCP Protocol  │                   │
│          └───────┬────────┘                   │
└──────────────────┼─────────────────────────── ┘
                   │
        ┌──────────▼──────────┐
        │  ChhotaBheem MCP    │
        │  Server (Node.js)   │
        │                     │
        │  ┌───────────────┐  │
        │  │  Tool Router  │  │
        │  └───┬───┬───┬───┘  │
        │      │   │   │      │
        │  ┌───▼┐┌─▼─┐┌▼──┐  │
        │  │ GL ││JRA││ AI│  │
        │  │ API││CLI││SDK│  │
        │  └─┬──┘└─┬─┘└─┬─┘  │
        │    │     │    │     │
        └────┼─────┼────┼─────┘
             │     │    │
     ┌───────▼┐ ┌──▼──┐ ┌▼────────┐
     │ GitLab │ │JIRA │ │ Bedrock │
     │  API   │ │ API │ │ Claude  │
     └────────┘ └─────┘ └─────────┘

        ┌──────────────────────┐
        │  .chhotabheem/       │
        │  (Local Brain)       │
        │  ├── config.yaml     │
        │  ├── repos/          │
        │  ├── team/           │
        │  ├── workflows/      │
        │  └── cache/          │
        └──────────────────────┘
```

---

## Demo Script (3 Minutes)

**0:00–0:20 — The Problem**
"Every developer at Nielsen uses GitLab. Every developer also uses AI tools — Kiro, Glean, Claude. But these two worlds don't talk to each other. Glean lists GitLab as 'Coming Soon.' We built it now."

**0:20–1:00 — Multi-Repo Awareness**
Show Kiro chat: "What's the status of my repos?"
→ ChhotaBheem returns status of n1-ads-api, enablement-ui, n1-ads-services — branches, pipeline status, open MRs.

**1:00–1:40 — Pipeline Intelligence**
"The n1-ads-api pipeline just failed. What happened?"
→ ChhotaBheem reads the job log → explains: "RSpec failure in campaign_policy_spec.rb — undefined method `ctv_placement`"
→ "Fix it" → generates fix → commits → pushes → pipeline re-triggered

**1:40–2:15 — JIRA-to-MR Flow**
"Show me JIRA ticket N1ADS-1234"
→ Reads ticket: "Add Connected TV placement type"
→ "Create a branch and start a draft MR"
→ Branch created, draft MR opened, JIRA ticket linked, reviewer auto-assigned

**2:15–2:45 — How It Works**
Quick architecture slide. MCP server, GitLab API, JIRA CLI, Bedrock Claude, local brain.

**2:45–3:00 — Path to Production**
"This is an MCP server. Any developer adds one config line to their Kiro setup and gets full GitLab AI. We can ship this to every Nielsen developer in a week."

---

## Open Questions

1. **GitLab token scope:** What permissions does the hackathon sandbox token grant? Need `api`, `read_repository`, `write_repository` at minimum.
2. **Bedrock model:** Which Claude model is available in the AWS sandbox? Sonnet preferred for speed, Opus for quality.
3. **Nielsen GitLab namespace:** Confirm we can create repos under `nielsen-media/cloud-enablement/aws-hack-ai-thon/teams/`.
4. ~~**JIRA write access:**~~ ✅ CONFIRMED — Full read/write. Create, assign, comment, transition states all work.
5. **Rate limits:** GitLab API rate limits for the hackathon token?

## JIRA CLI Capabilities (Confirmed)

```bash
# Read
jira issue list -q "project=N1ADS AND status='In Progress'"
jira issue view N1ADS-1234
jira project list

# Write — all confirmed working
jira issue create -p N1ADS -t Bug -s "Summary" -b "Description" -y High -l "label1"
jira issue assign N1ADS-1234 "garvit.jain@nielsen.com"
jira issue move N1ADS-1234 "In Progress"           # Transition states
jira issue move N1ADS-1234 "Done" --resolution "Fixed"
jira issue comment add N1ADS-1234 "Comment body"
```

## Reference Links

- [AI Enablement / Glean Info](https://sites.google.com/nielsen.com/ai-enablement/glean?authuser=0)
- [Hack-AI-Thon '26 Info](https://sites.google.com/nielsen.com/ai-enablement/hack-ai-thon26?authuser=0)
