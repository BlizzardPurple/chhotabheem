import { createHash, randomUUID } from "node:crypto";
import { reconcile } from "./tools/reconcile.js";

const fingerprint = plan => createHash("sha256").update(JSON.stringify({ action: plan.action, payload: plan.payload })).digest("hex");
const publicPlan = ({ execute, ...plan }) => plan;

/** Shared use case for MCP and HTTP. Provider adapters own I/O; this owns policy. */
export function createWorkflow({ scanner, clients, notebook, now = () => Date.now() }) {
  const scans = new Map(), approvals = new Map(), events = [], busyProjects = new Set();
  async function log(project, event) {
    const entry = { ...event, project, at: new Date(now()).toISOString() };
    events.push(entry);
    if (events.length > 500) events.shift();
    if (notebook) {
      const { dir } = await notebook.getProjectDirByPath(project);
      await notebook.appendSyncLog(dir, JSON.stringify(entry));
    }
    return entry;
  }
  return {
    async scan(project) {
      let baseline = scans.get(project);
      if (!baseline && notebook) {
        const { dir } = await notebook.getProjectDirByPath(project);
        const saved = await notebook.readLastScan(dir);
        if (saved && !Array.isArray(saved)) baseline = saved;
      }
      const report = await scanner.scanDetailed(project);
      report.scan_id = randomUUID();
      const baselineFindings = [...new Map([...(baseline?.mismatches || []), ...(baseline?.unverified_findings || [])].map(m => [m.id, m])).values()];
      const oldIds = new Set(baselineFindings.map(m => m.id));
      const ids = new Set(report.mismatches.map(m => m.id));
      report.diff = { baseline: Boolean(baseline), new: report.mismatches.filter(m => !oldIds.has(m.id)).map(m => m.id),
        resolved: [], unverified: [], persistent: report.mismatches.filter(m => oldIds.has(m.id)).map(m => m.id) };
      report.unverified_findings = [];
      for (const m of baselineFindings) {
        if (ids.has(m.id)) continue;
        // Missing evidence during an outage must never be reported as a resolution.
        (report.complete ? report.diff.resolved : report.diff.unverified).push(m.id);
        if (!report.complete) report.unverified_findings.push(m);
      }
      scans.set(project, report);
      if (scans.size > 100) scans.delete(scans.keys().next().value);
      try {
        await log(project, { type: "scan", scan_id: report.scan_id, findings: report.mismatches.length, complete: report.complete });
        if (notebook) {
          const { dir } = await notebook.getProjectDirByPath(project);
          await notebook.saveLastScan(dir, report);
          await notebook.markSession(dir);
        }
      } catch { report.persistence_warning = "Scan succeeded, but notebook storage failed. Fix storage before executing actions."; }
      return report;
    },
    getScan: project => scans.get(project),
    getEvents: project => events.filter(e => !project || e.project === project),
    async preview(project, mismatchId) {
      const report = scans.get(project);
      const m = report?.mismatches.find(m => m.id === mismatchId);
      if (!m) throw new Error("Run a scan and choose a current finding first.");
      const plan = await reconcile(m, clients);
      const token = randomUUID();
      approvals.set(token, { project, scanId: report.scan_id, finding: m, hash: fingerprint(plan), expires: now() + 5 * 60_000, status: "pending" });
      if (approvals.size > 500) approvals.delete(approvals.keys().next().value);
      return { ...publicPlan(plan), approval_token: token, scan_id: report.scan_id, expires_at: new Date(now() + 5 * 60_000).toISOString() };
    },
    async execute(project, token, approved) {
      if (approved !== true) throw new Error("Explicit approval is required. Review the preview first.");
      const entry = approvals.get(token);
      if (!entry || entry.project !== project) throw new Error("Unknown approval token. Preview this action first.");
      if (entry.status === "completed") return { ...entry.result, replayed: true };
      if (entry.status !== "pending" || busyProjects.has(project)) throw new Error("An action is running or its outcome is uncertain. Rescan and verify the provider before retrying.");
      if (entry.expires < now() || scans.get(project)?.scan_id !== entry.scanId) throw new Error("Preview expired or scan changed. Preview the current finding again.");
      busyProjects.add(project);
      entry.status = "validating";
      try {
        const fresh = await scanner.scanDetailed(project);
        const current = fresh.mismatches.find(m => m.id === entry.finding.id);
        if (!current) throw new Error("Evidence changed or is unavailable. Rescan before taking action.");
        const plan = await reconcile(current, clients);
        if (fingerprint(plan) !== entry.hash) throw new Error("The proposed action changed. Rescan and review a new preview.");
        // Persist intent before writing. A failed notebook blocks live mutations.
        await log(project, { type: "action_intent", action: plan.action, finding: current.id, approval_token: token });
        entry.status = "executing";
        const result = await plan.execute();
        entry.result = { ...result, action: plan.action, mismatch_id: current.id };
        entry.status = "completed";
        try { await log(project, { type: "action_completed", ...entry.result }); }
        catch { entry.result.persistence_warning = "Provider action completed, but audit storage failed. Verify the provider; do not repeat the action."; }
        return entry.result;
      } catch (error) {
        entry.status = entry.status === "executing" ? "uncertain" : "rejected";
        try { await log(project, { type: "action_failed", finding: entry.finding.id, outcome: entry.status }); } catch {}
        throw error;
      } finally { busyProjects.delete(project); }
    },
  };
}
