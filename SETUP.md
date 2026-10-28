# Local demo setup — ProjectSync

This guide is for the teammate's machine where GitLab/Jira access already exists. No AWS account is needed. Use a dedicated hackathon project and tickets whose state you are allowed to change. The placeholders below must be replaced locally; never commit tokens or paste them into chat.

For the prepared offline submission bundle, start with [START-HERE.md](START-HERE.md). It includes dependencies; `node scripts/hackathon.mjs` launches the synthetic console and `node scripts/hackathon.mjs --live` launches the configured live console. The launcher prints the actual URL, normally port 3031. The older `demo`/`demo:live` commands below retain port 3021. No provider calls occur in explicitly selected synthetic mode.

## 1. Install and verify

Use Node.js 22 or 24, npm, and Python 3. The application supports Node 20.12+, but the CI matrix uses 22/24. Python is used by the deployment packaging tests, not the application. Commands assume macOS/Linux or Windows WSL.

```bash
cd /absolute/path/to/chhotabheem
node --version
python3 --version
npm ci
npm test
cp .env.example .env
```

If `.env` already exists, edit it rather than overwriting it. It is ignored by git. `src/load-env.js` reads `.env` from the process working directory; inherited environment variables take precedence.

Set these values in `.env`:

```dotenv
GITLAB_PROJECT=YOUR_GROUP/YOUR_SUBGROUP/YOUR_DEMO_REPO
GITLAB_HOST=https://gitlab.com
JIRA_PROJECT=YOUR_JIRA_PROJECT_KEY
JIRA_URL=https://YOUR_JIRA_HOST
JIRA_DONE_STATUS=Done
PORT=3021
```

`GITLAB_PROJECT` is a namespace/path or numeric ID, not the repo website URL. `GITLAB_HOST` and `JIRA_URL` must use HTTPS for remote hosts. Self-hosted Jira can include its context path. Use the exact status name your Jira workflow permits; some teams need `Closed` or another target. Changing the default target still requires approval.

## 2. Reuse configured access, or use API tokens

Choose one route for each provider. GitLab can use its CLI while Jira uses REST, or vice versa.

### Existing CLI logins — shortest path

In the same terminal/account that will launch ProjectSync:

```bash
glab --version
glab auth status --hostname YOUR_GITLAB_HOSTNAME
jira version
jira me
```

For the public GitLab service, the hostname is `gitlab.com` (no `https://`). If needed, authenticate using `glab auth login --hostname YOUR_GITLAB_HOSTNAME` and `jira init`. ProjectSync uses the configured host when retrieving the GitLab token. Jira CLI operations use the Jira CLI's own server/auth configuration; `JIRA_URL` does not reconfigure that CLI. Make sure they refer to the same instance.

If the CLIs are absent, either install them using their official instructions ([GitLab CLI](https://docs.gitlab.com/cli/), [jira-cli](https://github.com/ankitpokhrel/jira-cli)) or use the REST route below. The expected Jira CLI is `ankitpokhrel/jira-cli`, with `--raw` JSON support.

Leave `GITLAB_TOKEN` unset to reuse glab authentication. Set `JIRA_TRANSPORT=cli` to force your existing Jira CLI configuration. Keep any `JIRA_API_TOKEN` already required by that CLI in its environment. In auto mode, an API token alone uses the CLI; REST requires `JIRA_TOKEN` or the full URL/email/API-token combination. Do not activate literal `YOUR_TOKEN` placeholders.

### REST tokens — no provider CLI required

For GitLab, add the token locally:

```dotenv
GITLAB_TOKEN=YOUR_GITLAB_TOKEN
```

The account must be able to read the chosen repo/MRs/pipelines. GitLab actions also need permission to create branches and MRs, with an API-capable token. Protected branches and project roles still apply; possession of a token alone does not grant project permissions.

For Jira Cloud, add:

```dotenv
JIRA_URL=https://YOUR_ORG.atlassian.net
JIRA_EMAIL=YOUR_EMAIL
JIRA_API_TOKEN=YOUR_JIRA_API_TOKEN
JIRA_DEPLOYMENT=cloud
JIRA_TRANSPORT=rest
```

This implementation uses direct Jira-site basic authentication with email/API token. Use a token compatible with that route; scoped tokens that require an `api.atlassian.com/ex/jira/...` gateway are not configured by this template. If your organization requires a gateway or SSO-specific flow, use its configured Jira CLI or adapt the client and test it first.

For Jira Server/Data Center with supported personal access tokens:

```dotenv
JIRA_URL=https://YOUR_JIRA_HOST
JIRA_TOKEN=YOUR_PERSONAL_ACCESS_TOKEN
JIRA_DEPLOYMENT=server
JIRA_TRANSPORT=rest
```

Use only the credential variables for your chosen Jira mode. Read access requires Browse Projects. Actions require the relevant Create Issues/Transition Issues permissions; custom mandatory fields, validators, issue-type names, and workflow transitions vary by project. The demo creates the issue type named `Bug` without forcing a priority. Rehearse it in your sandbox. The transition target is resolved to an available transition ID rather than assuming an ID.

## 3. Optional Google Drive

GitLab and Jira are the main demo. Drive can use the teammate's existing `~/.clasprc.json` default OAuth credentials **if they already have the necessary Drive access**, or a short-lived `GOOGLE_ACCESS_TOKEN` set locally. A clasp login by itself does not guarantee visibility of all Drive files; scopes and organization policy apply. Do not broaden company access merely for the demo.

Release-note discovery uses this title convention:

```text
YOUR_GROUP/YOUR_DEMO_REPO — Release Notes
```

It looks for accessible matching documents modified in the last seven days. The creation action uses the same title. Missing Drive authorization appears as an incomplete check. Differently named documents can be missed; say this in the presentation.

## 4. Run the read-only preflight, then the console

```bash
npm run doctor
npm run demo:live
```

Open **http://127.0.0.1:3021**. Confirm the badge says **LIVE INTEGRATIONS** and the project field points at your sandbox. The server binds to loopback; don't expose it through a public tunnel. Local process access is trusted; this is not a shared authenticated web service.

`doctor` checks provider paths and performs a scan/project query when configured. `CHECK` lines explain incomplete prerequisites. An exit status of 1 may reflect optional Drive access; read the individual results. The preflight does not perform writes or prove write permissions.

Click **Scan project**. Expand source evidence. Choose **Review action** to inspect the exact target and payload. Only **Approve action in live tools** writes to a provider. The console then rescans. A successful write and a failed verification scan are reported separately; do not repeat a write just because verification is unavailable.

Only run one live process for the demo. Approval tokens and action serialization are process-local; running the browser service and MCP service together creates separate caches. The local notebook is shared storage, not a distributed lock.

## 5. Seed one convincing live story

Prepare this manually in your authorized sandbox before the presentation:

1. Create a Jira ticket with clear acceptance criteria. Leave it In Progress.
2. Make a small change on a branch whose name includes the exact key, for example `DEMO-123-rounding-fix`.
3. Open and merge the MR within the last seven days. Leave the Jira ticket unchanged.
4. Ensure the ticket genuinely satisfies your team's Done criteria so approving the transition is appropriate.
5. Scan the repo and confirm the merged-MR/ticket finding appears. Preview it without applying yet.

During the demo, show the two source tabs, approve the reviewed transition, then show the updated ticket and a new scan. If Drive is unavailable, that check remains partial. A disappeared finding is conservatively marked unverified while *any* check is incomplete; directly show Jira's refreshed status instead of claiming complete verification from the aggregate badge.

For the pipeline example, use a deliberately failed pipeline in the sandbox's latest default-branch run, with no ticket referencing its pipeline ID in the configured Jira project. A newer successful run suppresses historical failure findings. Bug creation depends on the project's issue fields and permissions; rehearse beforehand.

For repeat runs, manually return only the sandbox ticket to its prior state using the team's workflow. Do not reset real work or delete other people's issues. See [the timed demo script](docs/DEMO.md).

## 6. Connect to Kiro or another stdio MCP host

Run `npm ci` in this checkout first. Add this server to your MCP host's config; Kiro typically uses `~/.kiro/settings/mcp.json`. Merge this entry with existing servers rather than replacing the file. Use an absolute Node executable path if a GUI-launched host does not inherit your shell PATH.

```json
{
  "mcpServers": {
    "project-sync": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/chhotabheem/src/server.js"],
      "env": {
        "GITLAB_HOST": "https://YOUR_GITLAB_HOST",
        "GITLAB_PROJECT": "YOUR_GROUP/YOUR_DEMO_REPO",
        "JIRA_PROJECT": "YOUR_JIRA_PROJECT_KEY",
        "JIRA_URL": "https://YOUR_JIRA_HOST",
        "JIRA_DONE_STATUS": "Done"
      }
    }
  }
}
```

The host may run from another directory, so do not assume it loads this repo's `.env`. Existing CLI credentials are resolved for the host's OS user. If you choose REST tokens, provide them using the host's supported secure environment mechanism, or start it from the properly configured environment; don't commit credentials into a shared config. If `glab`/`jira` cannot be found from a GUI host, set its PATH to include the CLI installation directory.

Suggested live conversation:

```text
Scan YOUR_GROUP/YOUR_DEMO_REPO. Explain the evidence and any checks that could not complete.
Preview the merged-MR/Jira discrepancy. Do not execute it yet.
[Inspect the returned payload, target status, and evidence.]
I approve this exact proposed change. Execute using that approval token.
Scan again and explain what changed. Show the sync log.
```

The `reconcile` tool accepts a finding ID or 1-based number to preview. Execution requires `approved: true` plus the returned `approval_token`, not a bare boolean. Tokens expire after five minutes and a new scan invalidates unexecuted previews. The host model must obtain the human's approval; the server cannot authenticate the human from a boolean alone.

For `jira_to_mr`, provide `jira_key` and `project`. Missing requirements return questions. Inspect the returned `proposal`, then approve with its token. A newly created branch has no diff, so the tool correctly returns “branch prepared.” Push your actual work, request a new preview, then approve the draft MR. It never automatically transitions Jira. This convenience workflow is separate from scan/reconcile and does not write to the shared notebook; retain its returned result and inspect GitLab for its outcome.

## 7. Rehearsal fallback

Stop the live process with Ctrl+C, then:

```bash
npm run demo
```

The badge must say **SYNTHETIC SAMPLE**. The scenario has five findings and never contacts providers. It is a reliable way to learn the flow; it is not evidence of live integration. `npm run demo:mcp` provides the same fixture adapters through MCP. Add `PROJECTSYNC_MODE=demo` to an MCP config's env for a fixture host session.

## Troubleshooting

| Symptom | Check |
|---|---|
| `EADDRINUSE` | Stop the previous process or change `PORT` and use the new URL. |
| GitLab 401/403/404 | Correct host, API token or host-scoped CLI login, project path and membership, VPN. |
| Jira CLI unavailable | Run from the configured user's terminal, fix PATH, or set the REST credentials. |
| Jira REST search fails | Correct cloud/server mode; Cloud uses enhanced search; check site URL/token route and project permission. |
| Jira transition rejected | Target state exists and is uniquely available from the current status; inspect validators and required fields. |
| Scan has no ticket finding | Exact Jira key is in MR branch/title/description, MR merged within seven days, ticket status is not in Done category. |
| Preview expired/scan changed | Scan and review a new action; do not reuse stale approvals. |
| Action outcome uncertain | Inspect the provider first. The token is blocked to avoid blindly repeating an ambiguous write. |
| Notebook cannot be written | Check access to `~/.projectsync/` or set a writable private `PROJECTSYNC_HOME`; failed action-intent storage blocks writes. |
| Company TLS certificate error | Use the organization's approved CA configuration, e.g. `NODE_EXTRA_CA_CERTS`, before Node starts. Do not disable TLS verification. |
| Optional Drive or approval API missing | Show partial coverage and continue with available GitLab/Jira evidence. |
| MCP seems silent in a terminal | Stdio MCP awaits JSON-RPC input; use the host, not a browser. `npm run demo:live` starts the web console. |

Read [engineering limits](docs/ENGINEERING.md) before presenting claims about idempotency, AI, or production readiness. AWS can follow after this local checklist succeeds: [optional deployment guide](docs/AWS.md).
