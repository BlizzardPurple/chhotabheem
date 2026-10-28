# ProjectSync — start here

**Find disagreements between GitLab and Jira, inspect the evidence, and approve a verified repair.** This package contains the runnable application, its JavaScript dependencies, tests, live setup instructions, and presentation material.

## Run the delivered package

Install Node.js 22 or 24 on the presenting machine. The minimum application runtime is Node 20.12. The Node runtime itself is not bundled.

Extract `projectsync-hackathon.tar.gz`, then open a terminal in the extracted `projectsync-hackathon` folder:

```bash
node scripts/hackathon.mjs
```

No dependency download, cloud account, API token, or network connection is required for this **synthetic rehearsal**. Open the URL printed in the terminal. The launcher prefers port 3031 and finds an available port if that default is busy. Use the displayed URL, not a remembered one.

If working from the source repository instead of the delivered package, install dependencies once with `npm ci`, then run `npm run hackathon`. To check initialization and the fixture scenario without opening a server:

```bash
node scripts/hackathon.mjs --check
```

Stop the server with Ctrl+C. Do not present the synthetic scenario as a live integration: its mode badge stays visible and its source URLs are illustrative.

## Two-minute working walkthrough

1. Select **Scan project**. The fixed scenario returns five findings and five completed checks.
2. Open the evidence for merged MR `!108` and Jira ticket `SHOP-241`, which is still In Progress.
3. Select **Review action**. Inspect the target status, ticket key, and evidence. Nothing has been changed by this preview.
4. Select **Approve simulated action**. A fresh scan should show four findings and one resolved finding.
5. Open **Activity log** to show the observation, approved action, and result.
6. Select **Reset sample** to prepare the next rehearsal.

The server's rules are deterministic. Kiro or another MCP host provides conversational AI when connected. No Glean or Bedrock instance is included in this package.

## Run the live version on the authenticated machine

Preserve an existing `.env` if one is already configured. Otherwise, copy `.env.example` to `.env` and replace the project and host placeholders. Existing provider CLI authentication or REST credentials stay on that machine; the delivered archive contains neither.

```bash
node scripts/doctor.js
node scripts/hackathon.mjs --live
```

The live launcher never silently switches to sample data. Follow [SETUP.md](SETUP.md) for exact GitLab/Jira options, the `JIRA_TRANSPORT` setting for an existing Jira CLI, MCP configuration, sandbox seed records, and troubleshooting. A read-only preflight does not prove write permission; rehearse one approved sandbox action on the presenting machine before judging.

## Submission material

- [Four-minute demo and speaker prompts](docs/DEMO.md)
- [Submission description and talk track](docs/SUBMISSION.md)
- [Engineering decisions and judge Q&A](docs/ENGINEERING.md)
- [Product audit and honest feature boundaries](docs/AUDIT.md)
- [Optional AWS deployment and teardown](docs/AWS.md)

The browser presentation is available from the running application's presentation link. When generated during release preparation, `dist/rehearsal.json` records the actual synthetic HTTP rehearsal and `dist/recording/demo.webm` contains its browser recording. These are sample-data artifacts, not live provider evidence.

The prepared bundle also includes `dist/ProjectSync-pitch.pdf` for presenting without a browser, plus a labeled `dist/recording/sample-evidence.json` export. The backup recording is silent and uses synthetic data; rehearse your narration with [docs/DEMO.md](docs/DEMO.md).

The application notebook stores scan and reconciliation history locally. Approval replay protection is process-local; this is a tested hackathon prototype, not a shared production service. AWS artifacts are optional and do not imply a deployed cloud service.

## Package verification and rebuilding

`DELIVERABLE-MANIFEST.json` lists each packaged application file's size and SHA-256 checksum (the manifest does not hash itself). The adjacent `projectsync-hackathon.sha256` records the compressed archive checksum. A checksum demonstrates integrity, not a successful live provider test.

From the source checkout, run the test suite and rebuild the artifact:

```bash
npm run deliverable
```

Packaging uses Node's standard library. The complete test suite also uses Python 3 for the existing AWS ZIP packaging tests; application startup does not require Python. The bundle intentionally excludes real `.env` files, local notebooks, cloud/CLI configuration directories, Git history, and symlinks. JavaScript dependencies are included for offline startup; platform-specific native dependencies cause packaging to fail instead of producing an ambiguously portable archive.
