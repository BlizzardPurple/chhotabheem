# ProjectSync demo and presentation guide

## The one-sentence pitch

**ProjectSync finds disagreements between GitLab work and Jira tracking, shows the evidence, and helps a developer review and verify a repair.**

Lead with a developer's problem. “A merge request is already merged, but the ticket still says In Progress. The release lead has to open several tools to discover and reconcile that disagreement.”

Do not lead with “Jira wrapper,” the number of connectors, or a claim to replace Glean. The outcome is the demonstration.

## Run the live product on your authenticated machine

The main demonstration should use your own GitLab and Jira sandbox. The browser runs locally; it does not require AWS. Follow [SETUP.md](../SETUP.md) for placeholder values, environment variables, and authentication options. The entry points are:

| Command | Purpose |
|---|---|
| `npm ci` | Install the locked dependencies. |
| `npm test` | Run automated checks before rehearsal. |
| `npm run doctor` | Check configured provider access without writing; inspect each result, including optional failures. |
| `npm run demo:live` | Start the local browser UI with live provider adapters. |
| `npm start` | Start the live stdio MCP server for an assistant. |
| `npm run demo` | Run the synthetic browser scenario as a backup. |
| `npm run demo:mcp` | Run synthetic providers through MCP for rehearsal. |

Use the local URL printed by the browser server. A stdio MCP process is meant to be launched by its host; it is not itself a website. Keep GitLab/Jira credentials on the authenticated machine and out of slides, recordings, and command output.

### Prepare the live scenario manually

Create or select these records in an approved sandbox before presenting. These are rehearsal instructions; the audit has not created them or verified your remote accounts.

1. Choose a GitLab project and a Jira project you are permitted to modify. Set `JIRA_PROJECT` to that Jira project. Confirm the account can read the relevant issues and that its workflow supports the desired `JIRA_DONE_STATUS` (default `Done`).
2. Create a Jira issue with clear demonstration acceptance criteria. Complete the sandbox work but leave the ticket in its open/in-progress state.
3. Merge a small corresponding GitLab MR within the last seven days. Include the exact Jira key in its title, branch name, or description. Keep the MR and Jira pages open so judges can independently inspect the source records.
4. Optionally make the latest pipeline on the project's default branch a failed run, with no matching pipeline reference in the configured Jira scope. Make the failure benign and understandable. A newer successful run suppresses the failure finding. This is secondary to the ticket/MR story.
5. Run a live scan before presenting. Confirm that the merged-MR finding appears, the desired checks completed, and optional Drive unavailability is reported honestly. If the scanner cannot read Jira, fix authentication before relying on the live demo.
6. Preview the ticket transition and inspect its issue key, current status, target status, and MR evidence. Rehearse approval and an immediate rescan once. Restore the sandbox ticket manually to the starting state before the presentation.

During the talk, scan, select the actual finding, preview it, and approve that specific plan. The browser requests another scan automatically; in MCP, ask the assistant to scan again. Show the live Jira page after the transition. If another person changes the record or the preview expires, rescan and review a fresh proposal.

If any check is incomplete, the aggregate diff conservatively marks disappeared findings **unverified**, even when the relevant Jira write succeeded. Show the refreshed Jira status directly and explain the coverage limit. If the verification request fails entirely, the console preserves the confirmed write result and reports the verification failure separately. Do not repeat a provider write merely because verification was unavailable.

### Reset without hiding external changes

Synthetic demo reset affects only the fixture scenario. For a live rehearsal, reset through the providers' normal UI and workflow: transition the sandbox ticket back if that transition is allowed, remove or close a deliberately created demo bug according to your sandbox policy, and reuse or recreate appropriate seed data. Resetting local history does not undo a Jira or GitLab write. Do not run bulk deletion or blindly replay failed mutations to prepare for a presentation.

## Predictable backup scenario

`npm run demo` uses project `demo/checkout-service` and a fixed synthetic clock. Select **Scan project**. The initial scenario has five findings and five completed checks. These counts are fixture expectations, not measurements from a real project.

1. Open **Source evidence** on the finding linking merged MR `!108` to ticket `SHOP-241` in `In Progress`.
2. Select **Review action**. Inspect the JSON payload, issue key, target state, and MR link. Select **Approve simulated action**.
3. The browser requests a fresh scan. The finding count should fall from five to four, with the ticket finding listed as resolved by the workflow's diff.
4. Open **Activity log** to show scan, action-intent, and action-completed events.
5. Optionally approve the project-scoped release-notes proposal. The next scan should have three remaining findings. The generated synthetic URL is illustrative and is not a real Google document.
6. Select **Reset sample** before recording another take.

The MR/ticket repair, completed-token replay, fresh-scan diff, and release-notes disappearance were exercised together against the synthetic runtime during this audit. That check does not establish live provider compatibility. If demonstrating repeated approval, use the same token through MCP/API; clicking a new preview is a different operation.

## Four-minute presentation

| Time | Show | Say |
|---|---|---|
| 0:00–0:25 | ProjectSync's initial finding list | “Our tools disagree about the same work. We built a short workflow to make those disagreements visible and review the repair.” |
| 0:25–1:05 | A merged MR and its linked open ticket, including their identifiers and evidence | “The relationship is explicit. The MR is merged and the ticket remains open. This is a candidate for review; merging does not itself prove deployment or QA completion.” |
| 1:05–1:45 | The proposed action before approving it | “Here is exactly what we propose to change. The user decides whether this team's workflow allows it. A suggestion alone has not changed Jira.” |
| 1:45–2:15 | Apply the reviewed action, then scan again | “Now the observed state has changed. We verify the result instead of treating a button click as success.” |
| 2:15–2:45 | Action history and another finding | “The history connects the observation, action, and result. The remaining findings are still visible.” |
| 2:45–3:20 | One negative case: unavailable source or repeated action | “We tested the awkward case too. Missing evidence must not become a green result, and repeating an action must not blindly create more work.” |
| 3:20–3:45 | Architecture and one test result | “The assistant handles conversation; explicit rules check facts; adapters isolate providers; tests cover counterexamples. We chose a small design we can explain.” |
| 3:45–4:00 | The verified result and next pilot step | “We can reproduce this workflow today. Next we will measure time saved and false positives with a small team.” |

For live mode, name the approved sandbox and show the source records. If switching to backup synthetic data, say so before applying an action: **“This replay uses synthetic GitLab/Jira data; it does not change company systems.”** Do not imply that a fixture URL or simulated state change is a live provider mutation.

## Showing the assistant in MCP mode

After following the current [README](../README.md), use these prompts with your configured MCP host. Exact syntax is determined by the tools exposed by the running server.

1. “Scan this project for mismatches. Show the evidence and which checks could not run.”
2. “Explain the merged-MR/open-ticket finding. Distinguish the observed facts from assumptions.”
3. “Prepare a repair for that finding and show me the exact proposed change.”
4. Approve the specific proposal only after reviewing it.
5. “Scan again and show which findings changed. Show the recorded action.”

The assistant's explanation is the AI contribution. The server's rules are deterministic. If the host generated text, point to it. If the demo uses only the browser, say that the browser demonstrates the reconciliation workflow and that AI orchestration is available through the local MCP integration.

Do not rely on a model guessing a missing ticket key. The current core demonstration should use explicit links. Do not claim a Bedrock call or a connected Glean instance unless an actual invocation has been implemented and tested.

## Rehearsal checklist

- Start from the documented fresh-checkout path and run the automated tests.
- Reset the demo so the starting findings are predictable.
- Verify the first repair and the post-action state before recording.
- Rehearse one failed-source or repeat-action case; know exactly what the implementation guarantees.
- Keep the local demo ready if the hosted URL or venue internet is unavailable.
- For live mode, use an approved sandbox, verify permissions and Jira transitions, and record a successful end-to-end run beforehand.
- Capture a short backup video. State whether each recording uses fixtures or live providers.
- Have the architecture, test output, and [engineering answers](ENGINEERING.md) ready for questions.
- Record elapsed time and fixture counts from the actual run. Remove any unmeasured “8× faster,” adoption, or ROI claims.

## Five-slide outline

1. **Problem:** one work item, two conflicting tool states, one concrete developer cost.
2. **Workflow:** observe → inspect evidence → preview → approve → verify → history.
3. **Demo:** the actual before/after, with synthetic/live mode clearly identified.
4. **Engineering:** boundaries, explicit uncertainty, meaningful tests, and one lesson from the audit.
5. **Next experiment:** a small sandbox pilot measuring accuracy, completion rate, and manual time saved.

## Submission description

ProjectSync is a developer workflow assistant for finding and reviewing disagreements between GitLab and Jira. It checks explicit relationships such as a merged merge request whose linked ticket remains open, then presents the evidence and a proposed repair. Developers can use their existing provider access through a local browser UI or MCP tools in a coding assistant. The workflow emphasizes review, verification, and an action history. A repeatable synthetic scenario supports rehearsal without company credentials. Detection uses transparent rules; the host assistant can explain findings and help users navigate the workflow. The project focuses on a narrow engineering handoff problem and makes incomplete source coverage visible. Our next validation step is an approved sandbox pilot measuring finding accuracy, successful repairs, and time spent on manual reconciliation.

## Claims to avoid

| Avoid | Say instead |
|---|---|
| “Glean only searches; we act.” | “We focus on an explicit GitLab/Jira reconciliation workflow.” |
| “AI proved the root cause.” | “The assistant suggested an explanation from this log excerpt; a developer must verify it.” |
| “No bug exists.” | “No matching bug was found in the configured lookup scope.” |
| “Everything is in sync.” | “No mismatch was detected by the checks that completed in this scope.” |
| “MR merged means shipped.” | “The MR is merged; deployment and acceptance are separate facts.” |
| “Production-ready.” | “A tested prototype with a repeatable demo and documented remaining gaps.” |
| “Eight times faster.” | “We are measuring manual and assisted completion time on the same tasks.” |

The most convincing closing line is a result you just showed: “You saw the disagreement, the exact proposed repair, and the verified outcome.”
