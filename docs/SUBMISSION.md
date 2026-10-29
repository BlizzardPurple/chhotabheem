# ProjectSync — hackathon submission

**Team:** JainWin

**Stream:** AI Enablement

**Tagline:** Your tools should tell the same story.

## Short description

ProjectSync finds disagreements between GitLab work and Jira tracking, shows the source evidence, and helps developers review and verify a repair. A local console and six MCP tools support the same focused handoff workflow. The user previews an exact action before approving it; missing source access and uncertain outcomes stay visible.

## The problem and user

A developer preparing a handoff has to reconcile several tools manually. A merged MR can still have an In Progress ticket. A failed default-branch pipeline may have no visible tracking reference. A branch may have work but no open MR. These gaps are easy to miss because each tool holds a different part of the story.

Our first user is a developer or release lead checking a small team's work. The product's job is: “Show me what slipped between our tools, and help me close the loop.”

## What the prototype does

1. Read live GitLab/Jira data using the presenting machine's existing CLI access or configured REST credentials. Google Drive is optional.
2. Run five deterministic checks and return evidence, confidence labels, and individual check coverage.
3. Turn a selected finding into a preview with its target and payload.
4. Require an expiring approval token and re-read current evidence before the provider action.
5. Record the main reconciliation workflow and run a new scan to inspect the result.

The browser automatically requests the post-action scan. In MCP, the presenter asks the assistant to scan again. The separate Jira-to-MR convenience tool has its own approval flow and is outside the shared notebook.

## Where AI contributes

The MCP host interprets the user's request, selects tools, and can explain the returned source evidence. ProjectSync's scanner and approval rules are ordinary deterministic code. This separation makes critical state checks testable and keeps the decision to change another tool with the user.

The repository does not invoke a model itself and is not connected to a Glean instance. The browser alone demonstrates the workflow, not an AI inference. For the AI portion of judging, show the same evidence and approved action through the configured MCP host and identify the host-generated explanation.

## Deliverable and launch

The release bundle includes the application, browser presentation, local runbooks, tests, locked dependencies, and a manifest. On a machine with a supported Node.js version:

```bash
npm run hackathon
```

That command launches the clearly labeled synthetic rehearsal. Use the URL printed by the launcher and open `/pitch` for the five-slide presentation. The slide deck supports arrow keys, speaker notes, and printing to PDF.

For real integrations on the authenticated teammate's machine, replace the placeholders in `.env.example` as described in [SETUP.md](../SETUP.md), run the read-only preflight, and select the live launcher:

```bash
npm run doctor
npm run hackathon:live
```

Live mode is never silently replaced with fixtures. External provider writes require the user's reviewed approval. The presenting team must rehearse its Jira permissions and workflow validators before judging. Live account access was not available on the implementation machine.

## Four-minute talk track

| Slide | Time | Speaker cue |
|---|---:|---|
| 1. One piece of work, two stories | 0:00–0:25 | “The MR is merged, the ticket is still in progress, and somebody has to notice.” |
| 2. Find the gap, let the owner close it | 0:25–0:55 | “We compare facts, preview the action, ask the owner, then inspect the result.” |
| 3. The before and after | 0:55–2:25 | Switch to the console. State live or synthetic mode, show evidence, approve, and show the refreshed state/history. |
| 4. AI explains; code checks; people decide | 2:25–3:15 | Show an MCP explanation or its live invocation. Explain one tested failure case and why the boundary matters. |
| 5. Runnable today, measurable next | 3:15–4:00 | Show the packaged launch and current test output, then state the first pilot measurement. |

The deck uses illustrative synthetic MR `!108` and ticket `SHOP-241`. In the sample scenario, the first approved ticket repair changes five findings to four. These are expected fixture results, not production metrics. During a live demonstration, use the actual provider identifiers and observed outcome.

Use [DEMO.md](DEMO.md) for the detailed live seed and reset procedure. Use [ENGINEERING.md](ENGINEERING.md) for reviewer questions and [AUDIT.md](AUDIT.md) for the original defects and their fixes.

## Engineering lesson to explain

“Our first version could interpret a failed Jira lookup as an empty result. That could make the tool confidently wrong. We separated evidence availability from findings, made incomplete coverage visible, and tested the outage case. We also treated approval as a short-lived plan rather than a boolean that can be reused forever.”

Point to the tests for stale plans, changed branch commits, duplicate requests, and a successful provider write followed by an unavailable verification scan. Report the test count from the actual submission run rather than copying a number into slides.

## Validation claims and boundaries

- The deterministic sample workflow, MCP transport, adapter contracts, and failure cases can be checked without provider credentials.
- Live providers require the presenting user's access and sandbox rehearsal; fixture success does not certify live permissions.
- An MR merge is a reason to review a ticket, not proof that the team's definition of Done has been met.
- “No reference found” describes the configured lookup scope; it does not prove a ticket does not exist anywhere.
- Approval replay protection is process-local. Shared authentication and durable multi-worker coordination are future work.
- AWS templates are optional delivery artifacts. No hosted production service or built-in Bedrock inference is claimed.

## Next experiment

Run a small authorized team pilot. Measure correct versus incorrect findings, missed seeded cases, successful verified repairs, and manual versus assisted completion time on the same task. Record sample size and provider failures. Until those measurements exist, make no speedup, adoption, revenue, or ROI claim.
