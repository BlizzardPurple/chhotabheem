import * as gitlab from "./clients/gitlab.js";
import * as jira from "./clients/jira.js";
import * as gdrive from "./clients/gdrive.js";
import { createScanner } from "./tools/scan.js";
import { createWorkflow } from "./workflow.js";
import { createDemoClients } from "./demo/fixtures.js";

export async function createRuntime({ mode = process.env.PROJECTSYNC_MODE || (process.env.PROJECTSYNC_DEMO === "true" ? "demo" : "live") } = {}) {
  if (!["demo", "live"].includes(mode)) throw new Error("PROJECTSYNC_MODE must be demo or live.");
  if (mode === "demo") {
    const fixture = createDemoClients();
    const scanner = createScanner({ ...fixture.clients, now: fixture.now, jiraProject: "SHOP", reviewStaleDays: 3 });
    return { mode, clients: fixture.clients, project: fixture.project, workflow: createWorkflow({ scanner, clients: fixture.clients }) };
  }
  if (process.env.PROJECTSYNC_PUBLIC_DEMO === "true") throw new Error("Public hosting only supports synthetic demo mode.");
  if (process.env.PROJECTSYNC_S3_BUCKET) throw new Error("The legacy S3 notebook is unsupported for live mutations. Use the local notebook; see docs/AWS.md.");
  const notebook = await import("./notebook/notebook.js");
  const clients = { gitlab, jira, gdrive };
  return { mode, clients, notebook, project: process.env.GITLAB_PROJECT || "", workflow: createWorkflow({ scanner: createScanner(clients), clients, notebook }) };
}
