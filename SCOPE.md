# BeyondGlean — Project Sync Agent + Git-Invisible Project Memory

**Hack-AI-Thon '26 | Stream: AI Enablement | Team: Ctrl+Automate**

> Your tools lie to each other. JIRA says "Done" but the MR has unresolved threads.
> The pipeline failed but nobody updated the ticket. The design doc is three sprints stale.
>
> BeyondGlean catches the mismatches and fixes them.

---

## The Problem

Every developer at Nielsen works across 4+ tools daily: **GitLab, JIRA, Google Workspace, Confluence**. Each tool has its own truth about a project's state, and those truths constantly drift apart:

- An MR gets merged but the JIRA ticket stays "In Progress"
- A review has been pending for 5 days and nobody noticed
- The pipeline failed on main but no bug ticket was created
- Three Google Docs reference this project but none are linked from JIRA
- You discussed a refactor plan in a Kiro session last week — now you can't find it
- You want to write design notes for enablement-ui but any file you create shows up in `git status`

**Glean solves search.** It finds information across tools. But Glean doesn't detect when tools **disagree** with each other, and it doesn't **fix** those disagreements. Glean tells you what happened. BeyondGlean tells you what's **wrong** and acts on it.

---

## The Solution

BeyondGlean is two things:

### 1. Project Sync Agent — Cross-Tool Mismatch Detection & Resolution

An AI agent that continuously checks whether your tools agree on the state of your work, and reconciles them when they don't.

| Mismatch | Detection | Auto-Action |
|---|---|---|
| MR merged but JIRA still "In Progress" | GitLab merge event + JIRA status check | Transition JIRA → "Done" (with approval) |
| JIRA ticket "Done" but MR has open threads | JIRA status + GitLab discussion check | Alert: "MR !918 has 3 unresolved discussions" |
| Code review pending > 2 days | GitLab MR age + reviewer activity | Notify reviewer, escalate at 3 days |
| Pipeline failed on merged MR | GitLab pipeline status | Create JIRA bug ticket with log excerpt |
| Release notes missing for shipped tickets | Drive search + JIRA "Done" tickets | Auto-generate release notes Google Doc |
| Branch exists with no MR | GitLab branch list vs MR list | Prompt: "You have unpushed work on feature/X" |
| Design doc is stale (> 2 sprints old) | Drive doc last-modified vs JIRA sprint | Flag: "Architecture doc hasn't been updated since Sprint 14" |
| JIRA ticket assigned but no branch created | JIRA "In Progress" + GitLab branch check | Offer: "Create branch feature/N1ADS-1234-..." |

**The demo moment:** Show 5 real mismatches across JIRA/GitLab/Docs. Agent catches all 5, fixes 3 automatically, flags 2 for human approval. *"Reconciled 5 mismatched items in 30 seconds instead of manual triage."*

### 2. Git-Invisible Project Memory — Persistent Context That Never Touches the Repo

A memory layer for every project that stores design docs, task lists, session notes, and team context — completely invisible to git. No `git stash`, no `.gitignore` hacks, no cluttered MRs.

```
Your repo (enablement-ui/)           BeyondGlean Memory (remote/local)
┌──────────────────────────┐         ┌─────────────────────────────────┐
│ src/                     │         │ projects/                       │
│ package.json             │         │   enablement-ui/                │
│ ...                      │  linked │     meta.yaml                   │
│                          │◄───────►│     design.md                   │
│ ZERO extra files.        │ by git  │     tasks.md                    │
│ Nothing in git status.   │ remote  │     sessions/                   │
│ Nothing to stash.        │  URL    │       2026-10-13-refactor.md    │
│                          │         │     notes/                      │
└──────────────────────────┘         │       campaignsMain.md          │
                                     │     sync-state.json             │
                                     │   n1-ads-api/                   │
                                     │     design.md                   │
                                     │     ...                         │
                                     └─────────────────────────────────┘
```

**How linking works:** The agent reads `git remote get-url origin` → hashes the remote URL → maps it to a memory folder. No config file in the repo. No `.beyondglean/` directory in the repo. Zero footprint.

**What lives in project memory:**

```yaml
# meta.yaml — auto-populated on first access
repo_url: git@gitlab.com:nielsen-media/.../enablement-ui.git
repo_id: 46638336
tech_stack: react, typescript, vite
team:
  - { name: "Garvit Jain", gitlab: "garvit.jain3", role: "developer" }
  - { name: "Manmeet Kaur", gitlab: "manmeet.kaur.consultant", role: "developer" }
  - { name: "Ayushman Singh", gitlab: "ayushman.singh", role: "reviewer" }
related_repos:
  - n1-ads-api
  - n1-ads-services
  - n1-ads-ref-airflow
conventions:
  branch_pattern: "{JIRA-KEY}_{short_description}"
  mr_requirements: ["JIRA link", "screenshots if UI", "tests pass"]
```

```markdown
# design.md — written by developer, invisible to git
## Campaign Edit Refactor Plan
The current campaignsMain-dataprovider.ts fetches all campaigns then filters
client-side. This means users with 500+ campaigns load everything upfront.

Plan: Move filtering to API query params. n1-ads-api already supports
?primary_owner_be_id= but the UI doesn't use it.

Related: CampaignPolicy#can_edit? only checks client_owner_be_ids,
NOT secondary_owner_be_ids. See campaign-ownership steering for details.
```

```markdown
# sessions/2026-10-13-bulk-upload-review.md — auto-saved from Kiro session
## Session: MR !913 / !918 Bulk Upload Review
- !913 (Manmeet) — bulk placement upload component. Has merge conflicts.
- !918 (Garvit) — fix MR review comments. Also has conflicts.
- Dependency: !918 depends on !913. Must merge !913 first.
- Decision: Rebase !918 after !913 merges. Don't force-push.
- Open question: Should bulk upload reuse the DAR wizard component or fork it?
```

**Where memory is stored:**

| Storage | Use Case |
|---|---|
| **`~/.beyondglean/projects/`** | Local cache — instant access, always available |
| **Google Drive** (synced) | Persistent backup — survives laptop change, shareable with team |
| **AgentCore Memory** | Session-level context for deployed agents |

Local is the primary. Google Drive sync is background. Agent reads local first, falls back to Drive.

---

## How It All Connects

```
┌─────────────────────────────────────────────────────────────────┐
│                         KIRO IDE                                 │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │   Chat   │  │   Steering   │  │   Hooks    │  │  Editor   │ │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘ │
│       └───────────────┬┘───────────────┘               │       │
│                       │                                 │       │
│               ┌───────▼────────┐                       │       │
│               │  MCP Protocol  │                       │       │
│               └───────┬────────┘                       │       │
└───────────────────────┼────────────────────────────────┘       │
                        │                                         │
             ┌──────────▼──────────┐                              │
             │  BeyondGlean MCP    │                              │
             │  Server (local)     │                              │
             │                     │                              │
             │  Tools:             │    ┌────────────────────┐    │
             │  • sync_check       │───►│ ~/.beyondglean/    │    │
             │  • get_project_mem  │    │ projects/          │    │
             │  • save_note        │    │   enablement-ui/   │    │
             │  • get_mismatches   │    │   n1-ads-api/      │    │
             │  • reconcile        │    └────────────────────┘    │
             │  • search_memory    │                              │
             │  • repo_status      │                              │
             └───┬────┬────┬───┬──┘                              │
                 │    │    │   │                                   │
         ┌───────▼┐ ┌─▼──┐ ┌─▼─────┐ ┌──▼──────┐                │
         │ GitLab │ │JIRA│ │Google │ │ Glean  │                │
         │  API   │ │CLI │ │Drive  │ │  API   │                │
         └────────┘ └────┘ └───────┘ └────────┘                  │
                                                                   │
             On AWS (hackathon):                                   │
             ┌──────────────────────┐                              │
             │ AgentCore Runtime    │                              │
             │  • Sync Agent        │─── Bedrock Claude ───────────┘
             │  • Reconcile Agent   │    (Opus 4.6 / Sonnet 4.6)
             │  • Docs Agent        │
             └──────────────────────┘
```

---

## Feature Breakdown

### Core (Must-Have for Demo)

**F1: Project Memory — Read/Write**
- `get_project_memory(repo?)` — loads project meta + recent notes + open tasks
- `save_note(filename, content)` — saves to memory without touching git
- `search_memory(query)` — full-text search across all project memory
- Auto-link by git remote URL — zero config in the repo
- SessionStart hook: "Loaded project memory for enablement-ui. 3 open tasks, 2 pending reviews."

**F2: Mismatch Detection**
- `sync_check(repo?)` — scans GitLab + JIRA + Drive for inconsistencies
- Returns structured list: `[{type: "mr_merged_jira_open", severity: "high", details: {...}}]`
- Runs automatically on SessionStart via hook
- Output example:
  ```
  ⚠ 3 mismatches detected for enablement-ui:
  1. [HIGH] MR !957 merged Oct 6, but N1AREF-2949 still "In Progress"
  2. [MED]  MR !913 review pending 5 days (reviewer: Ayushman Singh)
  3. [LOW]  Branch N1AREF-2851_bulk_placement exists with no MR
  
  Fix all? [Y/n] or fix individually?
  ```

**F3: Reconciliation Actions**
- `reconcile(mismatch_id, action?)` — fix a detected mismatch
- JIRA transitions: move ticket to correct state
- GitLab: create MR from orphaned branch, re-request review
- Google Docs: generate missing release notes
- All write actions require human approval (displayed in Kiro chat)

**F4: Multi-Repo Status**
- `repo_status()` — aggregate view across all configured projects
  ```
  enablement-ui:    main ✓ | Pipeline: ✅ | Open MRs: 2 | Mismatches: 3
  n1-ads-api:       main ✓ | Pipeline: ✅ | Open MRs: 0 | Mismatches: 1
  n1-ads-services:  main ✓ | Pipeline: 🔴 | Open MRs: 1 | Mismatches: 0
  ```

### Should-Have (Makes It Impressive)

**F5: Session Auto-Save**
- Kiro hook on session end (Stop trigger)
- Summarizes what was discussed, decisions made, files touched
- Saves to `projects/{repo}/sessions/{date}-{topic}.md`
- Next session: "Last time you worked on enablement-ui, you were reviewing MR !913. Pick up where you left off?"

**F6: Cross-Repo Context**
- When reading a file in enablement-ui, auto-check if n1-ads-api has related changes
- "Heads up: n1-ads-api MR !234 changed the campaigns endpoint your file depends on"
- Uses `related_repos` from project memory

**F7: Glean Integration (Knowledge Layer)**
- Use Glean API to search across emails, Confluence, Slack for project context
- "What did the team discuss about bulk upload in the last 2 weeks?"
- Glean handles search; we handle action + memory

**F8: Pipeline Notifications**
- Background watcher polls pipeline status
- On failure: analyze logs, create JIRA ticket, notify in Kiro
- On success: "Deployed to QA. URL: https://qa.enablement.nielsen.internal"

### Stretch Goals (Day 3)

**F9: JIRA-to-MR Pipeline**
- Read JIRA ticket → create branch → open draft MR → link back to JIRA
- Uses project memory for conventions (branch naming, MR template)

**F10: Team Activity Feed**
- "What did the team ship this week?"
- Aggregates merged MRs, closed tickets, deployed pipelines across related repos

**F11: Google Drive Sync**
- Background sync of project memory to a Google Drive folder
- Enables access from any machine / shareable with teammates

**F12: Release Readiness Check**
- Pre-release agent: "Is enablement-ui ready to release?"
- Checks: all MRs merged, all tickets closed, pipeline green, release notes exist, no pending reviews

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **MCP Server** | Node.js 22 + TypeScript | Kiro-native, fast startup, MCP SDK best in JS |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Official SDK, handles stdio transport |
| **AgentCore Agents** | Python + Strands Agents | AWS-native, deploys to Bedrock AgentCore Runtime |
| **AI Models** | Bedrock Claude Opus 4.6 / Sonnet 4.6 / Haiku 4.5 | Available in workshop sandbox |
| **GitLab** | REST API via `fetch` + `glab` CLI fallback | Full CRUD, auth via glab token |
| **JIRA** | `jira` CLI wrapper (ankitpokhrel/jira-cli) | Already authenticated, full CRUD |
| **Google Workspace** | Drive API via clasp OAuth token | Docs creation, Drive search confirmed working |
| **Glean** | REST API (`glean` Python client) | Enterprise search across all connected tools |
| **Project Memory** | Local YAML/MD files at `~/.beyondglean/projects/` | Git-invisible, instant access |
| **Config** | YAML | Human-readable, familiar |

### TEST_MODE

```typescript
// CHHOTABHEEM_TEST_MODE=true (pre-hack)
// - AI calls: skip or use Ollama Qwen / Kiro passthrough
// - GitLab: real API calls (glab token works now)
// - JIRA: real CLI calls (authenticated now)
// - Google: real Drive API calls (clasp token works now)
// - Glean: mock or skip (need API token from admin)

// CHHOTABHEEM_TEST_MODE=false (hackathon)
// - AI calls: Bedrock Claude via AgentCore
// - Everything else: same real calls
```

---

## Delivery Format

### Primary: Kiro MCP Server (local)

```jsonc
// ~/.kiro/settings/mcp.json
{
  "mcpServers": {
    "beyondglean": {
      "command": "npx",
      "args": ["tsx", "/path/to/beyondglean/src/server.ts"],
      "env": {
        "CHHOTABHEEM_TEST_MODE": "true",
        "BEYONDGLEAN_HOME": "~/.beyondglean"
      }
    }
  }
}
```

One config entry. Kiro spawns it. All tools available in chat. Project memory auto-loads on session start.

### Secondary: AgentCore Deployment (AWS)

The sync/reconciliation agents run on AgentCore Runtime for:
- Background mismatch scanning (doesn't need Kiro open)
- Team-wide deployment (one agent instance serves the whole team)
- Observability/audit trail via CloudWatch

### Tertiary: Kiro Hooks (background intelligence)

```jsonc
// .kiro/hooks/beyondglean-session-start.json
{
  "version": "v1",
  "hooks": [{
    "name": "BeyondGlean Project Load",
    "trigger": "SessionStart",
    "action": {
      "type": "agent",
      "prompt": "Load BeyondGlean project memory for the current workspace. Check for mismatches across GitLab, JIRA, and Google Drive. Report any issues found."
    }
  }]
}
```

---

## Demo Script (3 Minutes)

**0:00–0:20 — The Problem**
"Your tools lie to each other. JIRA says this ticket is done. GitLab says the MR still has unresolved comments. The design doc hasn't been updated in two months. Nobody notices until something breaks. We built an agent that catches these mismatches and fixes them."

**0:20–0:50 — Project Memory**
Open enablement-ui in Kiro. BeyondGlean auto-loads: "Last session: bulk upload review. 3 open tasks. 2 pending reviews."
Create a design note: "Save this refactor plan for campaignsMain-dataprovider." Note saved. Run `git status` — nothing. Zero footprint.

**0:50–1:40 — Mismatch Detection**
"Check enablement-ui for mismatches." Agent scans GitLab + JIRA + Drive.
```
⚠ 4 mismatches found:
1. MR !957 merged Oct 6, JIRA N1AREF-2949 still "In Progress"
2. MR !913 review pending 5 days
3. MR !918 has merge conflicts (yours)
4. No release notes doc for last 3 merged MRs
```

**1:40–2:15 — Reconciliation**
"Fix mismatch 1." → Agent transitions JIRA to Done. Shows approval prompt.
"Fix mismatch 4." → Agent generates a Google Doc with release notes from MR descriptions. Shows the doc URL.
"Reconciled 2 items in 15 seconds. 2 remaining need manual attention."

**2:15–2:45 — How It Works**
Architecture slide. MCP server (local) + AgentCore (AWS) + GitLab API + JIRA CLI + Drive API + Glean. Project memory at `~/.beyondglean/` — completely git-invisible.

**2:45–3:00 — Path to Production**
"One config line to install. Uses existing auth — glab, jira, clasp. No new credentials. Memory lives locally, optionally syncs to Drive. Ship as a Kiro Power. Every developer gets cross-tool consistency checking on day one."

---

## Pre-Hack Work (Now → Oct 26)

### ✅ Can Build Now

| Task | Effort | Status |
|---|---|---|
| MCP server scaffold + tool schemas | 2-3 hrs | Not started |
| GitLab API client (all endpoints) | 3-4 hrs | Not started |
| JIRA CLI wrapper | 2-3 hrs | Not started |
| Google Drive client (docs, search) | 1-2 hrs | **Pattern proven** |
| Project memory system (`~/.beyondglean/`) | 2-3 hrs | Not started |
| Mismatch detection logic (no AI needed) | 3-4 hrs | Not started |
| Reconciliation actions (JIRA move, GitLab ops) | 2-3 hrs | Not started |
| Kiro steering file + hooks | 1 hr | Steering done |
| Sample project configs (enablement-ui, n1-ads-api) | 1 hr | Not started |
| Demo scenario prep + rehearsal | 1-2 hrs | Not started |

### ⛔ Needs Hackathon

| Task | Why |
|---|---|
| Bedrock Claude integration | Need AWS sandbox |
| AgentCore deployment | Need workshop environment |
| Glean API integration | Need GLEAN_API_TOKEN from admin |
| Live mismatch detection on real repos | Need full GitLab token scope |

### Build Plan

```
Week 1 (Oct 13-19):
  ├── MCP server scaffold + project memory system
  ├── GitLab API client + JIRA CLI wrapper
  └── Mismatch detection engine (rule-based, no AI)

Week 2 (Oct 20-26):
  ├── Reconciliation actions
  ├── Google Drive client (reuse proven pattern)
  ├── Kiro hooks + steering
  ├── Demo scenarios with real enablement-ui data
  └── Slide skeleton + demo script rehearsal

Hackathon Day 1 (Oct 27):
  ├── Wire up Bedrock Claude via AgentCore
  ├── Deploy sync agent to AgentCore Runtime
  ├── Glean API integration (if token available)
  └── End-to-end test: mismatch detect → reconcile flow

Hackathon Day 2 (Oct 28):
  ├── Polish: session auto-save, cross-repo context
  ├── Pipeline notifications
  ├── Demo recording (DO THIS EARLY — AWS burner account is 72 hrs)
  └── Slides finalized

Hackathon Day 3 (Oct 29):
  ├── Stretch features (JIRA-to-MR, release readiness)
  ├── Final demo polish
  ├── 150-word description
  └── Submit before 10 AM IST
```

---

## Competitive Positioning

| | Glean | BeyondGlean |
|---|---|---|
| **What it does** | Finds information across tools | Detects when tools disagree and fixes it |
| **Mode** | Search + Chat (read-heavy) | Sync + Reconcile (read + write) |
| **GitLab** | Connected (MCP) — can search and trigger | Same + mismatch detection + auto-fix |
| **JIRA** | Connected — can search and read | Same + state transitions + ticket creation |
| **Project context** | Learns from indexed data | Explicit project memory — design docs, session notes |
| **Git visibility** | N/A | Zero footprint — memory is completely git-invisible |
| **Where it runs** | Browser (glean.com) | IDE-native (Kiro) — where you're already coding |
| **Innovation** | Enterprise search (established) | Cross-tool consistency agent (novel) |

**Pitch line:** "Glean tells you what happened. BeyondGlean tells you what's wrong and fixes it."

---

## Judging Criteria Alignment

| Criterion | Our Score (est.) | Why |
|---|---|---|
| **Innovation** | 4/5 | Cross-tool mismatch detection is novel. Git-invisible memory is novel. Nobody else builds this. |
| **Works in Practice** | 4/5 | All integrations proven pre-hack. GitLab, JIRA, Google Docs confirmed working. Real mismatches, real fixes. |
| **Business Value** | 4.5/5 | Measurable: "Reconciled N mismatches in X seconds." Every team has this problem. |
| **Reusability / Scale** | 5/5 | One MCP config line. Works for any project on GitLab. Universal across Nielsen. |
| **Built Responsibly** | 4/5 | All writes require human approval. Uses existing auth. No new credentials. Audit trail via AgentCore. |
| **Estimated Overall** | ~4.3/5 | Up from Glean's 3.5 rating of the raw idea. |

---

## Open Questions

1. **Glean API token:** Need to request `GLEAN_API_TOKEN` from Anshul/admin. Endpoint: `https://nielsen-be.glean.com/rest/api/v1/`. Without it, Glean integration is mocked.
2. **Nielsen GitLab namespace:** Need team subgroup under `nielsen-media/cloud-enablement/aws-hack-ai-thon/teams/` for final submission.
3. **AgentCore IAM permissions:** Workshop role has Bedrock access but need to verify AgentCore deploy permissions.
4. **AWS burner account lifespan:** 72 hours — record demo on Day 1 or early Day 2.

## Reference Links

- [AI Enablement / Glean Info](https://sites.google.com/nielsen.com/ai-enablement/glean?authuser=0)
- [Hack-AI-Thon '26 Info](https://sites.google.com/nielsen.com/ai-enablement/hack-ai-thon26?authuser=0)
- [Glean Developer Platform](https://developers.glean.com/)
- [Glean MCP Server Docs](https://developers.glean.com/agents/mcp)
- [AgentCore CLI Docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-get-started-cli.html)
- [AWS Workshop](https://catalog.us-east-1.prod.workshops.aws/event/dashboard/en-US)
- [BeyondGlean Idea Doc](https://docs.google.com/document/d/1OP_bCy4mlv_NacaxUx2mdrMkzc0u0DV7cvm4g9ITOaM/edit)
- [Google Apps Script Editor](https://script.google.com/d/1ArimAIX-bG1BraegGDQPgUANNY7c2g3Ch7mJVjZ9cEn0KJNp8rKSNpnD/edit)

## JIRA CLI Capabilities (Confirmed)

```bash
# Read
jira issue list -q "project=N1ADS AND status='In Progress'"
jira issue view N1ADS-1234
jira project list

# Write — all confirmed working
jira issue create -p N1ADS -t Bug -s "Summary" -b "Description" -y High -l "label1"
jira issue assign N1ADS-1234 "garvit.jain@nielsen.com"
jira issue move N1ADS-1234 "In Progress"
jira issue move N1ADS-1234 "Done" --resolution "Fixed"
jira issue comment add N1ADS-1234 "Comment body"
```

## Google Workspace Capabilities (Confirmed)

```bash
# Create formatted Google Doc (via Drive API + HTML-to-Docs conversion)
curl -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F 'metadata={"name":"Doc Title","mimeType":"application/vnd.google-apps.document"};type=application/json' \
  -F "file=@content.html;type=text/html"

# Search Drive
curl "https://www.googleapis.com/drive/v3/files?q=name+contains+'search'" \
  -H "Authorization: Bearer ${TOKEN}"

# Upload file
curl -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F 'metadata={"name":"file.png"};type=application/json' \
  -F "file=@file.png;type=image/png"
```

## AWS Workshop Environment

```
Account:  434527238467
Role:     CodeEditorInstanceRole-us-west-2
Region:   us-west-2
Node:     v22.23.3
Python:   3.9.25
AWS CLI:  2.38.1

Bedrock Models (env vars):
  ANTHROPIC_DEFAULT_HAIKU_MODEL=global.anthropic.claude-haiku-4-5-20251001-v1:0
  ANTHROPIC_DEFAULT_SONNET_MODEL=global.anthropic.claude-sonnet-4-6
  ANTHROPIC_DEFAULT_OPUS_MODEL=global.anthropic.claude-opus-4-6-v1

CLAUDE_CODE_USE_BEDROCK=1
```
