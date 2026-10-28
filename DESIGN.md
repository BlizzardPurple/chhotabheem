> **Historical planning document.** This predates the audited implementation and includes unshipped ideas and unverified claims. See [README](README.md), [current audit](docs/AUDIT.md), and [demo guide](docs/DEMO.md) for what actually exists.

# ChhotaBheem — Technical Design

> Working name. Candidates: **Labrador** (Lab +rador/retriever — retrieves from GitLab),
> **CtrlLab** (team Ctrl+Automate + GitLab), **Devnagri** (Devanagari script + dev + navigate),
> **Sutra** (thread that connects — Sanskrit), **GitSutra**, **Labwise**, **Gitanjali** (Tagore + Git).
> Or lean into the Glean rivalry: **GleanWho**, **CleanWho**, **BeyondGlean**.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Runtime** | Node.js 22 (already installed) | MCP SDK is best supported in JS/TS. Fast startup for local server. |
| **Language** | TypeScript | Type safety for tool schemas, better DX. |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Official SDK. Handles stdio transport, tool registration, schema validation. |
| **GitLab API** | `glab` CLI + direct REST via `fetch` | `glab` for auth/convenience, REST for bulk operations. Token from `glab auth status`. |
| **JIRA** | `jira` CLI (ankitpokhrel/jira-cli) | Already authenticated. Wrap CLI commands with JSON output parsing. |
| **AI / LLM** | Bedrock Claude (hackathon) / Ollama Qwen (pre-hack) / Kiro passthrough | `TEST_MODE` flag switches between them. See below. |
| **Config** | YAML (`.chhotabheem/`) | Human-readable, easy to edit, familiar to devs. |
| **Build** | `tsup` or `tsx` | Zero-config TS bundling. `tsx` for dev mode (no compile step). |

### Why NOT Python?

Python MCP SDK exists but Node gives us:
- Faster cold start (MCP servers are spawned per-session)
- Better TypeScript tooling for schema definitions
- Same ecosystem as Kiro extensions
- `fetch` is native in Node 22 (no axios/requests needed)

---

## TEST_MODE — How Pre-Hack Testing Works

```
┌─────────────────────────────────────────────┐
│              Environment Variable            │
│         CHHOTABHEEM_TEST_MODE=true           │
└──────────────────────┬──────────────────────┘
                       │
          ┌────────────▼────────────┐
          │    What changes:        │
          ├─────────────────────────┤
          │ AI calls → skip / use   │
          │   Ollama Qwen locally   │
          │   or return mock data   │
          │                         │
          │ GitLab API → real calls │
          │   (your repos work now) │
          │                         │
          │ JIRA → real calls       │
          │   (CLI already authed)  │
          └─────────────────────────┘
```

### What TEST_MODE controls:

| Component | TEST_MODE=true (pre-hack) | TEST_MODE=false (hackathon) |
|---|---|---|
| **AI/LLM calls** | Ollama Qwen (`localhost:11434`) OR skip AI and return raw data | AWS Bedrock Claude Sonnet/Opus |
| **GitLab API** | Real calls — works now via `glab` token on `gitlab.com` | Same, possibly different token scope |
| **JIRA API** | Real calls — works now via `jira` CLI | Same |
| **Pipeline watcher** | Poll your own repos | Poll hackathon repos |
| **Log level** | Verbose (debug) | Normal |

```typescript
// src/config.ts
export const TEST_MODE = process.env.CHHOTABHEEM_TEST_MODE === 'true';

export function getAIProvider() {
  if (TEST_MODE) {
    // Option 1: Ollama locally
    // Option 2: No AI — return raw GitLab data, let Kiro's model reason over it
    return 'ollama'; // or 'passthrough'
  }
  return 'bedrock';
}
```

### The "Passthrough" Strategy (Smartest for Pre-Hack)

Here's the key insight: **the MCP server doesn't NEED its own AI model for most tools.**

When you ask Kiro "why did the pipeline fail?", the flow is:
1. Kiro (Claude Opus 4.6) decides to call the `get_job_log` MCP tool
2. MCP server fetches the log from GitLab API → returns raw text
3. **Kiro's own model** reasons over the log and explains the failure

The MCP server is a data bridge, not an AI. It only needs its own AI for:
- `smart_review` (generating review comments)
- `summarize_changes` (release notes)
- Smart MR descriptions from diffs

For pre-hack: skip those AI-dependent tools and build everything else. Kiro's model handles the reasoning.

---

## MCP Server Integration — How It Plugs Into Kiro

### Step 1: mcp.json config

```jsonc
// ~/.kiro/settings/mcp.json
{
  "mcpServers": {
    "chhotabheem": {
      "command": "npx",
      "args": ["tsx", "/Users/gajain2402/Nrepos/chhotabheem/src/server.ts"],
      "env": {
        "GITLAB_TOKEN": "${GITLAB_TOKEN}",         // from glab auth
        "GITLAB_HOST": "https://gitlab.com",
        "CHHOTABHEEM_TEST_MODE": "true",
        "CHHOTABHEEM_CONFIG": "/Users/gajain2402/Nrepos/.chhotabheem"
      }
    }
  }
}
```

When Kiro starts a session:
1. Kiro reads `mcp.json`
2. Spawns: `npx tsx /path/to/server.ts` as a child process
3. Communicates over stdio (stdin/stdout JSON-RPC)
4. All tools registered in the server appear in Kiro's tool list
5. Kiro can call them naturally during conversation

### Step 2: Steering file (auto-activates context)

```markdown
<!-- .kiro/steering/chhotabheem.md -->
---
inclusion: auto
name: ChhotaBheem GitLab AI
description: GitLab operations, MRs, pipelines, code review, JIRA integration
---

You have access to the ChhotaBheem MCP server for GitLab and JIRA operations.

## Available Tools
- GitLab: search_code, get_project, list_mrs, get_mr, create_mr, get_pipeline,
  get_job_log, retry_pipeline, list_issues, create_issue, get_file, list_branches, get_diff
- JIRA: jira_get_issue, jira_create_issue, jira_list_issues, jira_move_issue,
  jira_assign_issue, jira_add_comment
- Intelligence: repo_status, smart_review, explain_failure, suggest_reviewer

## Context
User's configured repos and team info are in the .chhotabheem/ directory.
Always check repo metadata before making cross-repo suggestions.
```

### Step 3: Kiro hooks (background intelligence)

```jsonc
// .kiro/hooks/chhotabheem-pipeline-watcher.json
{
  "version": "v1",
  "hooks": [{
    "name": "Pipeline Watcher",
    "trigger": "SessionStart",
    "action": {
      "type": "agent",
      "prompt": "Check for any failing pipelines in the user's configured repos using the ChhotaBheem MCP server. If any are failing, notify the user and offer to analyze the failure."
    }
  }]
}
```

---

## Project Structure

```
chhotabheem/
├── package.json
├── tsconfig.json
├── SCOPE.md                    # What and why
├── DESIGN.md                   # How (this file)
├── TASKS.md                    # Build plan
├── src/
│   ├── server.ts               # MCP server entry — tool registration
│   ├── config.ts               # TEST_MODE, env vars, paths
│   ├── tools/
│   │   ├── gitlab/
│   │   │   ├── search-code.ts
│   │   │   ├── projects.ts
│   │   │   ├── merge-requests.ts
│   │   │   ├── pipelines.ts
│   │   │   ├── issues.ts
│   │   │   ├── files.ts
│   │   │   └── branches.ts
│   │   ├── jira/
│   │   │   ├── issues.ts
│   │   │   ├── transitions.ts
│   │   │   └── comments.ts
│   │   └── intelligence/
│   │       ├── repo-status.ts
│   │       ├── smart-review.ts
│   │       ├── explain-failure.ts
│   │       └── suggest-reviewer.ts
│   ├── clients/
│   │   ├── gitlab-client.ts    # GitLab REST API wrapper
│   │   ├── jira-client.ts      # JIRA CLI wrapper (spawns jira commands)
│   │   └── ai-client.ts        # Bedrock / Ollama / passthrough switch
│   ├── brain/
│   │   ├── config-loader.ts    # Loads .chhotabheem/ config
│   │   ├── repo-metadata.ts    # Repo context for AI
│   │   └── team-resolver.ts    # Who reviews what
│   └── utils/
│       ├── logger.ts
│       └── exec.ts             # Child process helpers for CLI wrapping
├── .chhotabheem/                # Sample config (ships with project)
│   ├── config.yaml
│   ├── repos/
│   │   └── sample-repo.yaml
│   ├── team/
│   │   └── colleagues.yaml
│   └── workflows/
│       └── mr-checklist.yaml
└── kiro-integration/
    ├── mcp.json.example         # Copy-paste MCP config
    ├── steering.md              # Auto-inclusion steering file
    └── hooks/
        └── pipeline-watcher.json
```

---

## Google Workspace — Alternative Approaches

Since direct Google API is blocked by org OAuth restrictions, here are possible workarounds:

### Option A: Google Apps Script Proxy (Most Likely to Work)

Deploy a Google Apps Script as a Web App inside Nielsen's Google Workspace:
- Apps Script runs INSIDE the org, no external OAuth project needed
- Can access Calendar, Gmail, Drive, Docs natively
- Expose as a simple REST endpoint: `https://script.google.com/macros/s/.../exec`
- MCP server calls this endpoint

```javascript
// Google Apps Script (deployed as web app)
function doGet(e) {
  const action = e.parameter.action;
  if (action === 'calendar') {
    const events = CalendarApp.getDefaultCalendar().getEventsForDay(new Date());
    return ContentService.createTextOutput(JSON.stringify(events.map(e => ({
      title: e.getTitle(), start: e.getStartTime(), end: e.getEndTime()
    }))));
  }
}
```

**Pros:** Works within org, no GCP project needed, Apps Script is already authorized.
**Cons:** Limited to what Apps Script API exposes. Slightly janky.

### Option B: IMAP/SMTP for Gmail

Gmail supports IMAP with app passwords or OAuth. If Nielsen allows app passwords:
```bash
# Could read emails programmatically
# But probably blocked by org security policies
```

**Verdict:** Try Option A (Apps Script) during hackathon as a stretch goal. If it works, we get Calendar + Drive + Gmail for free. If not, we focus on GitLab + JIRA which already work.

---

## Tool Schema Examples

### GitLab: get_pipeline

```typescript
{
  name: "get_pipeline",
  description: "Get pipeline details including status, jobs, duration, and failure info",
  inputSchema: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "GitLab project path (e.g., 'nielsen-media/nts/n1/n1-ads-api') or project ID"
      },
      pipeline_id: {
        type: "number",
        description: "Pipeline ID. If omitted, returns the latest pipeline."
      },
      branch: {
        type: "string",
        description: "Filter by branch name. Used when pipeline_id is omitted."
      }
    },
    required: ["project"]
  }
}
```

### JIRA: jira_move_issue

```typescript
{
  name: "jira_move_issue",
  description: "Transition a JIRA issue to a new state (e.g., 'In Progress', 'In Review', 'Done')",
  inputSchema: {
    type: "object",
    properties: {
      issue_key: {
        type: "string",
        description: "JIRA issue key (e.g., 'N1ADS-1234')"
      },
      state: {
        type: "string",
        description: "Target state name (e.g., 'In Progress', 'Done', 'In Review')"
      },
      comment: {
        type: "string",
        description: "Optional comment to add during transition"
      },
      resolution: {
        type: "string",
        description: "Resolution type if moving to Done (e.g., 'Fixed', 'Won\\'t Fix')"
      }
    },
    required: ["issue_key", "state"]
  }
}
```

---

## Data Flow Examples

### "Why did the pipeline fail?"

```
User (in Kiro): "Why did the n1-ads-api pipeline fail?"
    │
    ▼
Kiro model decides to call: get_pipeline(project="n1-ads-api")
    │
    ▼
MCP Server:
  1. Resolves "n1-ads-api" → full GitLab path from .chhotabheem/repos/
  2. GET /projects/:id/pipelines?status=failed&per_page=1
  3. GET /projects/:id/pipelines/:pid/jobs (find failed job)
  4. GET /projects/:id/jobs/:jid/trace (get log)
  5. Returns: { status, failed_job, log_excerpt, stage, runner }
    │
    ▼
Kiro model reasons over the raw log → explains to user
    │
    ▼
User: "Fix it"
    │
    ▼
Kiro generates fix → uses standard file editing tools
Then calls: retry_pipeline(project="n1-ads-api", pipeline_id=...)
```

### "Create MR from current branch"

```
User: "Open an MR for my current branch"
    │
    ▼
Kiro calls: create_mr(project="n1-ads-api", auto=true)
    │
    ▼
MCP Server:
  1. Detects current branch from local git
  2. GET /projects/:id/repository/compare?from=main&to=current-branch
  3. Loads MR checklist from .chhotabheem/workflows/mr-checklist.yaml
  4. If TEST_MODE=false: sends diff to AI for title/description generation
  5. If TEST_MODE=true: uses branch name + commit messages as description
  6. POST /projects/:id/merge_requests
  7. Auto-assigns reviewer from .chhotabheem/team/reviewers.yaml
  8. If JIRA key in branch name: adds JIRA link to description
  9. Returns: { mr_url, mr_iid, title, reviewers }
```
