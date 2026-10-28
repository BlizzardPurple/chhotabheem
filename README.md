# ProjectSync — Cross-Tool Mismatch Detection for Developer Workflows

MCP server for Kiro that scans GitLab, JIRA, and Google Drive, detects when they disagree, and fixes it.

## 1-Minute Setup

**Prerequisites:** Node 18+, `glab` CLI logged in, `jira` CLI logged in.

```bash
# Clone and install
git clone git@gitlab.com:nielsen-media/tam/ltam-sre/crediting/hackathon-jainwin/chhotaglean.git project-sync
cd project-sync
git checkout pilot
npm install

# Install globally (makes `project-sync` command available everywhere)
npm install -g .
```

**Add to Kiro:** Open `~/.kiro/settings/mcp.json` and add:

```json
{
  "mcpServers": {
    "project-sync": {
      "command": "project-sync"
    }
  }
}
```

Restart Kiro. Done.

**Alternative (without global install):** Use the full path instead:

```json
{
  "mcpServers": {
    "project-sync": {
      "command": "node",
      "args": ["/full/path/to/project-sync/src/server.js"]
    }
  }
}
```

## What It Does

Type these in Kiro chat:

| Command | What Happens |
|---|---|
| "Scan enablement-ui for mismatches" | Checks GitLab MRs, JIRA tickets, pipelines, Drive docs for inconsistencies |
| "Fix mismatch 2" | Reconciles the issue (creates bug ticket, transitions JIRA, generates release notes) |
| "What's the status of enablement-ui?" | Quick overview: open MRs, pipeline status, conflicts |
| "What changed since my last session?" | Diffs current state against last scan — new/resolved/persistent mismatches |
| "Create MR from N1AREF-1234 in enablement-ui" | Reads JIRA ticket, creates branch + draft MR, links back |
| "Show me the sync log" | Reads the agent notebook — past findings, fixes, decisions |

## 6 MCP Tools

| Tool | Description |
|---|---|
| `scan` | Detect mismatches across GitLab/JIRA/Drive (5 rules) |
| `reconcile` | Fix a mismatch — auto for tickets/docs, approval for state transitions |
| `repo_status` | Project overview: MRs, pipeline, conflicts |
| `get_sync_log` | Read the agent notebook |
| `session_diff` | What changed since last session |
| `jira_to_mr` | JIRA ticket → branch + MR (asks questions if info is missing) |

## 5 Mismatch Rules

1. **MR merged, ticket still open** — AI links MR to ticket even without JIRA key in branch name
2. **Pipeline failed, no bug ticket** — AI reads failure log, generates bug ticket with root cause
3. **Review pending too long** — AI summarizes the MR and why the review matters
4. **Tickets shipped, no release notes** — AI generates release notes doc from MR descriptions
5. **Branch exists, no MR** — AI generates MR title + description from commits

## Auth Requirements

| Service | How to Authenticate |
|---|---|
| GitLab | `glab auth login` (token stored in keyring) |
| JIRA | `jira init` (API token) |
| Google Drive | `npx @google/clasp login` (optional — for release notes docs) |

## Agent Notebook

ProjectSync saves its findings at `~/.projectsync/{project}/`. This is completely invisible to git — no files in your repo, nothing in git status.

## Hack-AI-Thon '26

**Team:** Ctrl+Automate | **Stream:** AI Enablement  
**GitLab:** https://gitlab.com/nielsen-media/tam/ltam-sre/crediting/hackathon-jainwin/chhotaglean
