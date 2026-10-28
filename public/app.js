const $ = id => document.getElementById(id);
let config, report, preview, busy = false;
function notice(text, error = false) { $("notice").textContent = text; $("notice").hidden = !text; $("notice").className = `notice${error ? " error" : ""}`; }
async function api(path, body) {
  const response = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function link(text, href) { const el = node("a", text); try { const url = new URL(href); if (url.protocol !== "https:" && url.protocol !== "http:") return node("span", text); el.href = url.href; el.target = "_blank"; el.rel = "noopener noreferrer"; } catch { return node("span", text); } return el; }
async function task(fn) { if (busy) return; busy = true; document.querySelectorAll("button").forEach(b => b.disabled = true); try { await fn(); } catch (error) { notice(error.message, true); } finally { busy = false; document.querySelectorAll("button").forEach(b => b.disabled = false); $("approve").disabled = config?.readOnly || !preview; } }
function render() {
  const findingTitles = { "Pipeline failed, no bug ticket": "Failed pipeline without a tracking reference", "No release notes": "Project release notes not found" };
  $("count").textContent = report.mismatches.length;
  $("high").textContent = report.mismatches.filter(m => m.severity === "HIGH").length;
  $("coverage").textContent = `${report.checks.filter(c => c.status === "complete").length}/${report.checks.length}`;
  $("coverage-note").textContent = report.complete ? "All configured checks completed" : "Partial coverage · inspect checks";
  $("resolved").textContent = report.diff.baseline ? report.diff.resolved.length : "—";
  $("diff-note").textContent = report.diff.unverified.length ? `${report.diff.unverified.length} missing findings unverified` : report.diff.baseline ? "Compared with the previous scan" : "First scan establishes a baseline";
  $("scanned-at").textContent = `Scanned ${new Date(report.scannedAt).toLocaleTimeString()}`;
  $("checks").replaceChildren(); $("checks").hidden = false;
  report.checks.forEach((check, i) => { const el = node("span", `${check.status === "complete" ? "✓" : "!"} Check ${i + 1}: ${check.status}`, `check ${check.status}`); el.title = `${check.rule}${check.message ? `: ${check.message}` : ""}`; $("checks").append(el); });
  $("findings").replaceChildren();
  for (const m of report.mismatches) {
    const card = node("article", undefined, "finding"), head = node("div", undefined, "finding-head"), content = node("div", undefined, "finding-main");
    head.append(node("span", m.severity, `severity ${m.severity}`));
    content.append(node("h2", findingTitles[m.rule] || m.rule), node("p", m.summary, "finding-summary")); head.append(content);
    const button = node("button", "Review action →"); button.addEventListener("click", () => task(async () => {
      preview = await api("/api/preview", { project: report.requestedProject, mismatch_id: m.id });
      $("preview-title").textContent = preview.description; $("preview-warning").textContent = preview.warning;
      $("preview-payload").textContent = JSON.stringify(preview.payload, null, 2);
      $("approve").textContent = config.readOnly ? "Hosted sample · read-only" : config.mode === "demo" ? "Approve simulated action" : "Approve action in live tools";
      $("preview-dialog").showModal();
    })); head.append(button); card.append(head);
    const details = node("details"), list = node("ul", undefined, "evidence"); details.append(node("summary", `Source evidence · ${m.confidence || "review"} confidence`));
    for (const item of m.evidence || []) { const li = node("li"); li.append(item.url ? link(item.source, item.url) : node("strong", item.source), document.createTextNode(` — ${item.fact}`)); list.append(li); }
    details.append(list);
    if (m.details.log_excerpt) details.append(node("pre", m.details.log_excerpt));
    details.append(node("p", m.suggestedAction, "hint")); card.append(details); $("findings").append(card);
  }
  if (!report.mismatches.length) $("findings").append(node("div", report.complete ? "No findings within the checked scope." : "No findings in available evidence. Some checks could not complete.", "empty"));
  const warnings = report.checks.filter(c => c.status !== "complete").map(c => `${c.rule}: ${c.message || c.status}`);
  if (report.persistence_warning) warnings.push(report.persistence_warning);
  if (warnings.length) notice(warnings.join("\n"), true);
}
async function scan() {
  const project = $("project").value.trim(); if (!project) throw new Error("Enter a GitLab project path or numeric ID.");
  notice("Reading source evidence…"); preview = null;
  report = await api("/api/scan", { project }); report.requestedProject = project;
  notice(""); render(); await renderAudit();
}
async function renderAudit() {
  const events = await api(`/api/events?project=${encodeURIComponent(report?.requestedProject || $("project").value)}`);
  $("audit").replaceChildren();
  if (!events.length) $("audit").textContent = "Scan and approval events appear here. Live mode also saves a local notebook.";
  for (const event of events.slice().reverse()) { const el = node("div", undefined, "event"); el.append(node("time", new Date(event.at).toLocaleString()), node("strong", event.type.replaceAll("_", " ")), node("div", event.message || event.finding || `${event.findings ?? ""} findings · ${event.complete ? "complete" : "partial"} scan`)); $("audit").append(el); }
}
$("scan").addEventListener("click", () => task(scan));
$("export").addEventListener("click", () => task(async () => {
  if (!report) throw new Error("Run a scan before exporting evidence.");
  const events = await api(`/api/events?project=${encodeURIComponent(report.requestedProject)}`);
  const data = { product: "ProjectSync", mode: config.mode, exported_at: new Date().toISOString(), report,
    activity: events.map(({ approval_token, ...event }) => event),
    note: config.mode === "demo" ? "Synthetic rehearsal only; no external provider writes." : "Live source snapshot; limited to the scope visible to the configured accounts." };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `projectsync-${config.mode}-evidence.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice("Evidence report downloaded. The report includes its sample/live mode and scan coverage.");
}));
$("project").addEventListener("keydown", e => { if (e.key === "Enter") task(scan); });
$("approve").addEventListener("click", () => task(async () => {
  const result = await api("/api/execute", { project: report.requestedProject, approval_token: preview.approval_token, approved: true });
  $("preview-dialog").close();
  const completion = `${result.message}${result.persistence_warning ? ` ${result.persistence_warning}` : ""}`;
  notice(completion);
  try {
    await scan();
    notice(`${completion} ${report.complete ? "Fresh scan completed." : "Fresh scan has partial coverage; inspect checks."}`, Boolean(result.persistence_warning));
  } catch (error) {
    notice(`${completion} Verification scan failed: ${error.message} The provider action already completed; inspect it before any retry.`, true);
  }
}));
$("reset").addEventListener("click", () => task(async () => { await api("/api/reset", {}); await scan(); notice("Sample scenario reset. No external tools were changed."); }));
for (const tab of ["findings", "audit"]) $(`${tab}-tab`).addEventListener("click", () => { for (const name of ["findings", "audit"]) { const selected = name === tab; $(`${name}-tab`).classList.toggle("selected", selected); $(`${name}-tab`).setAttribute("aria-selected", String(selected)); $(`${name}-panel`).hidden = !selected; } });
task(async () => { config = await api("/api/config"); $("project").value = config.project; $("mode").textContent = config.mode === "demo" ? "SYNTHETIC SAMPLE" : "LIVE INTEGRATIONS"; $("reset").hidden = config.mode !== "demo" || config.readOnly; $("mode-note").textContent = config.mode === "demo" ? `Synthetic data · fixed rehearsal scenario · no external writes${config.readOnly ? " · hosted preview is read-only" : " · state resets when the server restarts"}.` : "Live sources · read-only scans · every external change requires an action preview and approval."; });
