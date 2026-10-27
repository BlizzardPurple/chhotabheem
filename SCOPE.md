# ProjectSync — Cross-Tool Mismatch Detection & Resolution for Developer Workflows

**Hack-AI-Thon '26 | Stream: AI Enablement | Team: Ctrl+Automate**

> Your tools disagree with each other. MR merged but the ticket says "In Progress."
> Pipeline failed but nobody filed a bug. Three MRs shipped with no release notes.
>
> ProjectSync catches what humans miss, and fixes it.

---

## The Problem

Most Ad Tech developers at Nielsen work across GitLab, JIRA, and Google Workspace daily. Each tool holds its own version of the truth about a project's state, and those versions constantly drift apart.

This drift is invisible until something breaks. Nobody's job is to compare JIRA status against GitLab merge state against Google Drive docs. It's tedious, error-prone, and skipped under time pressure.

**Glean has all the data. Nobody is asking it to compare.**

ProjectSync is an AI agent that scans your tools, detects when they disagree, and reconciles them — with AI doing the work that requires judgment, not just if-then checks.

---

## 5 Rules — What ProjectSync Detects and Fixes

Each rule has a simple check (any script could do this) AND an AI layer (where the hackathon value lives).

### Rule 1: MR Merged, Ticket Still Open

| | |
|---|---|
| **Simple check** | GitLab MR state = `merged` AND linked JIRA ticket ≠ `Done` |
| **AI does** | Links MR to ticket even when the branch name doesn't contain a JIRA key — searches MR description, commit messages, and Glean (if available) to find the right ticket |
| **Auto-action** | Notifies user with proposed JIRA transition |
| **Needs approval** | Yes — state transitions always need human confirmation |

### Rule 2: Pipeline Failed, No Bug Ticket

| | |
|---|---|
| **Simple check** | GitLab pipeline status = `failed` on default branch AND no recent JIRA ticket references the pipeline |
| **AI does** | Reads the failure log, identifies root cause, generates a readable bug ticket with: error summary, affected files, suggested fix, log excerpt |
| **Auto-action** | Creates JIRA ticket automatically (read-only action — creating tickets is safe) |
| **Needs approval** | No — ticket creation is non-destructive |

### Rule 3: Review Pending Too Long

| | |
|---|---|
| **Simple check** | MR open > N days (configurable, default 3) with no reviewer activity |
| **AI does** | Summarizes what the MR changes, why the review matters (based on files touched and their criticality), drafts a context-rich nudge for the reviewer |
| **Auto-action** | Sends summary to user, who can forward to reviewer |
| **Needs approval** | No — informational only |

### Rule 4: Tickets Shipped, No Release Notes

| | |
|---|---|
| **Simple check** | JIRA tickets moved to "Done" in last N days AND no Google Doc titled with release/version info exists |
| **AI does** | Reads merged MR descriptions and diffs, generates formatted release notes Google Doc with: what changed, why it changed, who did it, links to MRs and tickets |
| **Auto-action** | Creates Google Doc automatically |
| **Needs approval** | No — doc creation is non-destructive |

### Rule 5: Branch Exists, No MR Opened

| | |
|---|---|
| **Simple check** | GitLab branch exists with commits ahead of main AND no MR references that branch |
| **AI does** | Reads the branch's commits, generates MR title + description, suggests reviewer based on which files were changed and past review patterns |
| **Auto-action** | Presents draft MR for user to review and submit |
| **Needs approval** | Yes — MR creation needs human confirmation |

### Approval Model (Consistent)

| Action Type | Approval Required? | Why |
|---|---|---|
| Create ticket, doc, notification | No | Non-destructive. Worst case: an extra ticket gets closed. |
| Transition JIRA state | Yes | Changes shared project state. Team relies on ticket status. |
| Create/submit MR | Yes | Commits code on user's behalf. Must review first. |

---

## Agent Notebook — How ProjectSync Remembers

ProjectSync saves its findings, fixes, and decisions to a local notebook at `~/.projectsync/{project}/`. This is the sync agent's memory — not a separate product.

**How it links to a project:** Reads `git remote get-url origin` → hashes the URL → maps to a notebook folder. No files added to the repo. Nothing in `git status`.

```
~/.projectsync/
  enablement-ui/                      # linked by git remote URL hash
    meta.yaml                          # repo metadata (auto-populated)
    sync-log.md                        # what was found, fixed, decided
    last-scan.json                     # cached state for diffing
  n1-ads-api/
    meta.yaml
    sync-log.md
    last-scan.json
```

**What goes in the sync log:**
```markdown
## Scan: 2026-10-27 14:30 IST

### Mismatches Found: 3
1. ✅ FIXED — MR !957 merged Oct 6, transitioned N1AREF-2949 to "Done" (approved by user)
2. ✅ FIXED — Pipeline #2942913 failed, created JIRA N1AREF-2970 with root cause analysis
3. ⏳ PENDING — MR !913 review pending 5 days. Summary sent to Ayushman Singh.

### Stats
- Scanned: 12 MRs, 8 tickets, 3 pipelines
- Mismatches: 3 found, 2 fixed, 1 pending
- Time: 28 seconds (manual estimate: 15-20 minutes)
```

**Kiro reads it back via MCP:**
```
User: "What did ProjectSync find last time?"
→ MCP tool reads ~/.projectsync/enablement-ui/sync-log.md
→ Returns the log
```

**Stretch goal (not core):** Sync the notebook to Google Drive for persistence across machines.

---

## Architecture

```
┌────────────────────────────────────────────────┐
│                   KIRO IDE                      │
│  ┌────────┐  ┌──────────┐  ┌───────────────┐   │
│  │  Chat  │  │  Hooks   │  │   Steering    │   │
│  └───┬────┘  └────┬─────┘  └──────┬────────┘   │
│      └────────────┼───────────────┘             │
│                   │                              │
│           ┌───────▼────────┐                    │
│           │  MCP Protocol  │                    │
│           └───────┬────────┘                    │
└───────────────────┼─────────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │  ProjectSync MCP    │
         │  Server (local)     │
         │                     │       ┌──────────────────┐
         │  Tools:             │──────►│ ~/.projectsync/  │
         │  • scan             │       │   {project}/     │
         │  • reconcile        │       │     sync-log.md  │
         │  • repo_status      │       └──────────────────┘
         │  • get_sync_log     │
         └──┬────┬────┬────┬──┘
            │    │    │    │
    ┌───────▼┐ ┌─▼──┐ ┌──▼───┐ ┌──▼────┐
    │ GitLab │ │JIRA│ │Google│ │Bedrock│
    │  API   │ │CLI │ │Drive │ │Claude │
    └────────┘ └────┘ └──────┘ └───────┘
```

**For the hackathon:** MCP server runs locally in Kiro. AI reasoning via Bedrock Claude (Sonnet 4.6 for speed, Opus 4.6 for quality).

**Path to production:** Deploy the scan agent to AgentCore Runtime for background scheduled scans. Team-wide deployment — one agent instance serves all developers on a project.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **MCP Server** | Node.js 22 + TypeScript | MCP SDK best in JS, Kiro-native |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Official, handles stdio transport |
| **AI** | Bedrock Claude Sonnet 4.6 (primary), Opus 4.6 (quality), Haiku 4.5 (speed) | Available in workshop sandbox |
| **GitLab** | REST API via `fetch` + `glab` CLI token | Full CRUD, confirmed working |
| **JIRA** | `jira` CLI wrapper | Full CRUD, confirmed working |
| **Google Docs** | Drive API via clasp OAuth token | Doc creation + search, confirmed working |
| **Glean** | REST API (if token available) | Optional knowledge layer for smart linking |
| **Notebook** | Local YAML/MD at `~/.projectsync/` | Git-invisible, instant access |

### TEST_MODE

```
PROJECTSYNC_TEST_MODE=true  → AI: skip or Kiro passthrough | APIs: real calls
PROJECTSYNC_TEST_MODE=false → AI: Bedrock Claude | APIs: real calls
```

Most tools don't need their own AI. The MCP server fetches data; Kiro's model (Opus 4.6) does the reasoning. Only Rules 2, 4, and 5 need Bedrock calls for text generation (bug ticket, release notes, MR description).

---

## Demo Script (3 Minutes)

**0:00–0:15 — The Problem**
"Your tools disagree with each other. JIRA says done, GitLab says the MR has unresolved comments. The pipeline failed on main but nobody filed a bug. This is every team, every week."

**0:15–0:25 — What ProjectSync Is**
"An AI agent that scans GitLab, JIRA, and Google Docs, detects mismatches, and resolves them. It runs from inside Kiro with one config line."

**0:25–1:00 — Scan**
Open Kiro with enablement-ui. Type: "Scan enablement-ui for mismatches."
```
⚠ 5 mismatches found:
1. [HIGH] MR !957 merged Oct 6, N1AREF-2949 still "In Progress"
2. [HIGH] Pipeline #2942913 failed on main — no bug ticket exists
3. [MED]  MR !913 review pending 5 days (reviewer: Ayushman)
4. [MED]  3 tickets shipped this week, no release notes doc
5. [LOW]  Branch N1AREF-2851 has 4 commits, no MR opened
```
Time shown: 28 seconds. "Doing this manually takes 15-20 minutes."

**1:00–1:45 — Fix (AI does real work)**
"Fix mismatch 2." → AI reads the pipeline log:
```
Root cause: RSpec failure in campaign_policy_spec.rb — undefined method 'ctv_placement'
Suggested fix: Add factory definition for ctv_placement in spec/factories
```
→ Creates JIRA bug ticket with this analysis automatically. Shows the ticket.

"Fix mismatch 4." → AI reads the 3 merged MR descriptions, generates release notes:
→ Creates a formatted Google Doc. Shows the doc URL.

"Fix mismatch 1." → Agent proposes transitioning N1AREF-2949 to "Done."
→ Shows approval prompt. User approves. Ticket transitioned.

"3 fixed. 2 remaining need manual attention."

**1:45–2:00 — Agent Notebook**
"What did ProjectSync find?" → Shows the sync log with all findings, fixes, and decisions. Stored locally at `~/.projectsync/enablement-ui/`. Run `git status` — nothing. Zero footprint.

**2:00–2:30 — How It Works**
Architecture slide. Kiro → MCP server → GitLab API + JIRA CLI + Drive API + Bedrock Claude. Agent notebook for memory. Each rule has a simple check + an AI layer for the hard part.

**2:30–2:50 — Path to Production**
"One config line to install. Uses existing auth — glab, jira, clasp. No new credentials needed. Deploy scan agent to AgentCore Runtime for background scheduled checks. Every developer at Nielsen can use this today."

**2:50–3:00 — Impact**
"5 mismatches detected and reconciled in under 2 minutes. Manual triage: 15-20 minutes. That's 8× faster, and it catches things humans skip entirely."

---

## Build Plan

### Pre-Hack (Now → Oct 26)

| Task | Effort | Impact |
|---|---|---|
| MCP server scaffold + 4 tool schemas (scan, reconcile, repo_status, get_sync_log) | 2 hrs | Foundation |
| GitLab API client (pipelines, MRs, branches, jobs, files) | 3 hrs | Core |
| JIRA CLI wrapper (list, view, create, move, comment) | 2 hrs | Core |
| Google Drive client (create doc, search) | 1 hr | Proven pattern, reuse |
| 5 mismatch detection rules (simple check logic) | 3 hrs | Core |
| Agent notebook system (`~/.projectsync/`) | 1 hr | Memory |
| Reconciliation actions (JIRA move, GitLab MR, Drive doc) | 2 hrs | Core |
| Kiro steering file + SessionStart hook | 30 min | Integration |
| Demo scenario with real enablement-ui data | 1 hr | Rehearsal |
| **Total pre-hack** | **~16 hrs** | |

### Hackathon Day 1 (Oct 27)

| Task | Time |
|---|---|
| Wire up Bedrock Claude for Rules 2, 4, 5 (bug ticket, release notes, MR description) | 3 hrs |
| End-to-end test: scan → detect → reconcile flow with real repos | 2 hrs |
| AgentCore deployment (if time) | 2 hrs |
| Record demo video backup (AWS burner = 72 hrs) | 1 hr |

### Hackathon Day 2 (Oct 28)

| Task | Time |
|---|---|
| Polish AI outputs (prompt engineering for bug tickets, release notes) | 2 hrs |
| Glean API integration (smart linking for Rule 1) if token available | 2 hrs |
| Finalize demo video recording | 1 hr |
| Slides (5 max) | 1 hr |

### Hackathon Day 3 (Oct 29)

| Task | Time |
|---|---|
| 150-word project description | 30 min |
| Final polish + edge case fixes | 2 hrs |
| Push to Nielsen GitLab | 30 min |
| Submit before 10 AM IST | — |

### If Time Gets Tight — Cut Order

1. **Never cut:** Rules 1, 2, 3 (core mismatches) + scan tool + reconcile tool
2. **Cut last:** Rules 4, 5 (release notes, MR creation) — impressive but not essential
3. **Cut if needed:** Glean integration — nice but not required
4. **Cut if needed:** AgentCore deployment — demo from Kiro directly
5. **Cut first:** Notebook Google Drive sync — local-only is fine for demo

---

## Judging Criteria Alignment

| Criterion | Score (est.) | Evidence |
|---|---|---|
| **Innovation** | 4/5 | Cross-tool mismatch detection is novel. AI reads pipeline logs and generates bug tickets — not a wrapper around existing tools. |
| **Works in Practice** | 4.5/5 | All integrations proven pre-hack. Demo uses real MRs, real tickets, real pipelines from enablement-ui. |
| **Business Value** | 4.5/5 | Measurable: "5 mismatches reconciled in 2 minutes vs 15-20 minutes manual." Every team has this problem. |
| **Reusability / Scale** | 4.5/5 | One MCP config line. Works for any GitLab project. Universal across Nielsen. |
| **Built Responsibly** | 4/5 | State transitions require approval. Ticket/doc creation is auto (non-destructive). Uses existing auth. Uses sandbox JIRA project for demo. |
| **Estimated Overall** | **~4.3/5** | |

---

## Open Questions

1. **Glean API token** — Request from Anshul. Endpoint: `https://nielsen-be.glean.com/rest/api/v1/`. Without it, Rule 1 falls back to branch-name matching only (still works, less smart).
2. **Sandbox JIRA project** — Need a test project for demo writes. Don't touch real tickets during demo.
3. **Nielsen GitLab namespace** — Need team subgroup under `nielsen-media/cloud-enablement/aws-hack-ai-thon/teams/` for submission.
4. **AWS burner account** — 72 hours only. Record demo early. Don't lose work.
5. **Name confirmation** — "ProjectSync" is clean. Verify no existing internal tool uses this name.

---

## Reference Links

- [Hack-AI-Thon '26 Info](https://sites.google.com/nielsen.com/ai-enablement/hack-ai-thon26?authuser=0)
- [AI Enablement / Glean Info](https://sites.google.com/nielsen.com/ai-enablement/glean?authuser=0)
- [Glean Developer Platform](https://developers.glean.com/)
- [Glean MCP Server Docs](https://developers.glean.com/agents/mcp)
- [AgentCore CLI Docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-get-started-cli.html)
- [AWS Workshop Dashboard](https://catalog.us-east-1.prod.workshops.aws/event/dashboard/en-US)

## Proven Integrations

### JIRA CLI (Confirmed — Full CRUD)

```bash
jira issue list -q "project=N1ADS AND status='In Progress'"
jira issue view N1ADS-1234
jira issue create -p N1ADS -t Bug -s "Summary" -b "Description" -y High
jira issue assign N1ADS-1234 "garvit.jain@nielsen.com"
jira issue move N1ADS-1234 "Done" --resolution "Fixed"
jira issue comment add N1ADS-1234 "Comment body"
```

### Google Docs (Confirmed — Create + Search)

```bash
# Create formatted Google Doc via Drive API + HTML-to-Docs conversion
curl -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F 'metadata={"name":"Title","mimeType":"application/vnd.google-apps.document"};type=application/json' \
  -F "file=@content.html;type=text/html"

# Search Drive
curl "https://www.googleapis.com/drive/v3/files?q=name+contains+'query'" \
  -H "Authorization: Bearer ${TOKEN}"
```

### GitLab API (Confirmed — Full Access)

```bash
# enablement-ui project ID: 46638336
glab api "projects/46638336/merge_requests?state=all&per_page=5"
glab api "projects/46638336/pipelines?ref=main&per_page=5"
glab api "projects/46638336/repository/branches"
glab api "projects/46638336/jobs/:id/trace"  # pipeline logs
```

### AWS Workshop Environment

```
Account:  434527238467
Region:   us-west-2
Models:
  global.anthropic.claude-haiku-4-5-20251001-v1:0
  global.anthropic.claude-sonnet-4-6
  global.anthropic.claude-opus-4-6-v1
```
