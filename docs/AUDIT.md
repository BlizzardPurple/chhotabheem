# ProjectSync: hackathon product and engineering audit

Reviewed 28 October 2026. The baseline findings below refer to commit `790952c`, before the accompanying improvements. This is an independent assessment of the repository, not an official hackathon score or a review of a running customer deployment.

## The product worth presenting

**ProjectSync helps a developer or release lead find disagreements between GitLab work and Jira tracking, inspect the evidence, and review a proposed repair.** The initial user is a team member preparing a daily update or release handoff. The narrow job is: “Show me the work that slipped between our tools, and help me close the loop.”

The strongest example is an MR that has merged while its explicitly linked Jira ticket remains in progress. A second useful example is a failed default-branch pipeline with no ticket found by a documented lookup. Evidence, a proposed action, an approval, and a subsequent check make a coherent product story. A large list of wrapper commands does not demonstrate that outcome.

Keep the name **ProjectSync** throughout the submission. The baseline documents alternate among ChhotaBheem, BeyondGlean, and ProjectSync, which makes the product and installation instructions harder to follow.

## Judge's assessment of the baseline

Scores are subjective, on a five-point scale. They measure what the submitted code supports, not how ambitious the scope document sounds.

| Dimension | Baseline | Reason |
|---|---:|---|
| Problem and user value | 4.0 | Cross-tool status drift is a clear developer workflow problem with an understandable before/after. No user validation or measured business impact is recorded. |
| Differentiation | 2.5 | A focused reconciliation workflow is useful; connector wrappers and generic AI summaries alone are weak differentiation. |
| Working product | 2.0 | Six MCP tools and three clients exist. Some advertised actions are placeholders, dependencies require local authentication, and there is no reproducible demo. |
| AI contribution | 1.5 | The host assistant may reason over tool output. The server itself has no implemented model invocation or semantic matching, despite stronger claims in the README. |
| Engineering and trust | 1.5 | Important checks swallow errors, repeated writes are possible, and no automated tests were present. |
| Demo and communication | 2.0 | The planned narrative is understandable, but unverified speedup and “AI root cause” claims make it vulnerable to a judge's follow-up. |
| **Unweighted average** | **2.25** | **A promising prototype that needs a trustworthy, complete demonstration.** |

A higher score needs observable evidence: run the tests, rehearse the same seeded scenario, show a proposal before a write, and show the changed state afterward. Do not replace the baseline score with a guessed “after” score.

## Changes made in response

The accompanying implementation addresses the core workflow rather than adding more integrations. Review these files and run the current tests to verify the behavior:

| Change | Evidence | What remains outside the claim |
|---|---|---|
| Scanner returns individual check coverage, evidence, confidence labels, and source failures. | `src/tools/scan.js`, `test/scan.test.js` | “High confidence” describes an explicit relation, not calibrated statistical confidence. Permission-limited data is not exhaustive truth. |
| Pipeline rule checks the latest default-branch state and searches configured Jira scope for a reference. | `src/tools/scan.js`, `src/clients/jira.js` | Differently described or newly indexed tickets may evade text lookup. |
| Rules use real project/default-branch context, MR approval evidence, and branch comparisons. | `src/tools/scan.js` | MR age is still a heuristic; a merge still does not prove release. |
| Shared workflow creates a preview token, expires it, binds it to a scan/action, and revalidates before applying. | `src/workflow.js` | Approval is a process-local workflow gate, not authenticated user identity or distributed locking. |
| Reconciliation returns precise payloads and separates summaries from external writes. | `src/tools/reconcile.js` | Provider-specific permissions and transitions still need a sandbox test on your account. |
| Completed approval tokens replay their result; uncertain executions are not blindly retried. | `src/workflow.js` | The cache is in memory. Cross-process or post-restart exactly-once behavior is not implemented. |
| Live runtime rejects the legacy S3 notebook for mutations. | `src/runtime.js` | This avoids relying on an unverified backend; it does not repair or certify that legacy adapter. |
| Deterministic synthetic providers support rehearsal and failure-path tests without credentials. | `src/demo/fixtures.js`, `test/` | Synthetic success cannot certify live authentication, API behavior, or deployment. |

The primary acceptance test is still **a live sandbox run on the presenter's authenticated machine**. This audit has not verified live GitLab/Jira writes. AWS hosting can follow the local demonstration; it is not necessary to prove the product's integration story.

## Findings in the baseline

| Priority | Finding and code evidence | Why a judge or user cares | Required behavior |
|---|---|---|---|
| P0 | Rule 2 in `src/tools/scan.js` flags every fetched failed pipeline as “no bug ticket” without querying Jira. | The central claim is unsupported, and retries can create duplicate bugs. | Query configured Jira scope; show an explicit lookup limitation; do not treat a failed lookup as an empty result. |
| P0 | Jira and Drive failures are swallowed in the scanner and Jira client; `src/server.js` can then say “All tools are in sync.” | An outage looks like a clean bill of health. | Return rule/source coverage and warnings with findings. An incomplete scan must remain visibly incomplete. |
| P0 | `src/tools/reconcile.js` automatically creates tickets/docs. `src/server.js` reuses cached findings and accepts a bare approval flag. | A second click can repeat an external write; approval is not bound to a reviewed plan. | Preview every external change, bind confirmation to that proposal, reject stale evidence, and record the outcome. |
| P0 | `README.md` and `SCOPE.md` claim AI linking, root-cause analysis, and Bedrock behavior. No model call or Glean client is implemented. | A judge can disprove the key innovation by asking for the actual call or trace. | Separate deterministic detection, assistant-generated explanation, and roadmap work explicitly. |
| P1 | Rule 3 uses MR age as a proxy for stalled review; Rule 5 excludes only `main`/`master`; release-note search is global. | These heuristics can flag active work, the real default branch, or the wrong project's documentation. | Use precise labels, project context, actual default branch, and explicitly scoped coverage. |
| P1 | Rule 3 returns text without sending a notification. Rule 5 returns a proposal without creating an MR. | “Fixed” or “sent” would misrepresent the action. | State “summary prepared” or “proposal prepared”; only record a remote change when the provider confirms it. |
| P1 | `jira_to_mr` hardcodes `gitlab.com`, extracts credentials separately, and transitions Jira automatically. | A configured self-hosted GitLab can be bypassed, and one convenience tool silently changes multiple systems. | Reuse the provider adapter; require a reviewed plan; report each completed and failed step accurately. |
| P1 | GitLab/Drive fetches lack deadlines; list operations do not consistently handle pagination. | Demo requests can hang or falsely imply exhaustive coverage. | Set bounded request timeouts and document scan limits/pagination. |
| P1 | Local notebook logging reads and rewrites the whole log. S3 `get-object` shares stdout with CLI metadata, and temp names can collide. | Audit history can lose events or fail to parse; optional storage is not automatically cloud-ready. | Use safe appends/atomic snapshots locally; either repair and test the S3 adapter or keep it outside the demo path. |
| P1 | `package.json` had only `start`; no test suite or deployment artifacts existed. | A fresh checkout cannot prove the intended behavior without live accounts. | Provide a deterministic fixture demo, meaningful failure-path tests, and repeatable deployment steps. |
| P2 | `DESIGN.md` describes TypeScript files, tools, hooks, and AI providers absent from the JavaScript implementation. `SETUP.md` points at `src/server.ts`. | Reviewers cannot tell architecture from aspiration; setup fails if followed literally. | Make README/current runbooks authoritative and mark historical plans as historical. |

“No ticket found” is always narrower than “no ticket exists.” Jira search only sees the authenticated user's scope, and a human-created ticket may lack the identifier used by the lookup. Likewise, “MR merged” does not prove a deployment occurred or acceptance criteria passed. The application must present the evidence and leave workflow decisions to the owner.

## Positioning against Glean

Do not pitch “Glean finds things; we take action.” Glean already documents Jira actions and agent workflows, and it can expose custom agents through MCP. [Glean actions](https://www.glean.com/blog/85-new-actions-in-agents), [Glean MCP administration](https://docs.glean.com/administration/platform/mcp/create-mcp-servers).

The defensible positioning is narrower: **a transparent reconciliation workflow for GitLab and Jira, with reproducible rules, visible evidence, reviewed repairs, and a history of what changed.** This is a product hypothesis, not a claim that Glean cannot implement the same workflow. A Glean-like knowledge layer can later enrich ambiguous links; provider APIs remain the source used to verify current state before acting.

No Glean instance is connected by this repository. Do not show an invented Glean integration diagram as the implemented system.

## What to cut and what to prove

Protect one complete story: scan → inspect linked MR/ticket → preview a repair → approve → verify the changed state → inspect the action history. Keep a pipeline finding as the second example. Treat Google Drive, branch-to-MR convenience, notifications, and semantic matching as secondary until the first story is reliable.

Avoid spending the final hours on a vector database, a rewrite to TypeScript, Kubernetes, microservices, or model fine-tuning. None of them resolves the initial trust defects. Small modules, explicit interfaces, useful tests, and honest failure reporting are stronger evidence of engineering judgment.

## Measurement plan

Measure these during rehearsal; do not claim they have already been achieved:

| Question | Measurement |
|---|---|
| Are findings correct? | Seed labeled true positives and counterexamples. Report correct findings / all emitted findings, plus missed expected findings. |
| Can the workflow finish? | Count successful preview → apply → verification runs and record any provider failure. |
| Does repetition cause damage? | Repeat the same approved action and verify no extra ticket/document/MR is created within the supported idempotency boundary. |
| Does it save time? | Have a teammate do the same small task manually and with ProjectSync; report both elapsed times and sample size. |
| Does it fail honestly? | Disable Jira or Drive and show incomplete coverage, not a green “all clear.” |
| Is AI helping? | Compare assistant explanations against source evidence; count unsupported claims and review acceptance. No claim is made before this evaluation exists. |

For a later pilot, the useful outcome is time to resolve verified drift, with false-positive rate as a guardrail. Number of API calls, generated words, and connected tools are implementation counts rather than product impact.

## Production work still requiring evidence

Before real team deployment: validate each organization's Jira workflow; define the meaning of “done”; scope tokens to permitted projects; establish user identity and action authorization; review secret/log handling; implement durable concurrency and idempotency; test provider rate limits and partial failures; define retention; and run an approved sandbox integration test. A fixture demo proves the workflow and its tests, not universal provider compatibility or production readiness.
