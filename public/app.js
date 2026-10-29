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
    // Table row approach
    if (!document.getElementById("findings-table")) {
      const table = document.createElement("div");
      table.className = "table-wrap";
      table.innerHTML = `<table class="sync-table" id="findings-table">
        <thead><tr><th style="width:70px">Severity</th><th style="width:90px">Source</th><th>Finding</th><th style="width:200px">Suggested Action</th><th style="width:120px"></th></tr></thead>
        <tbody id="findings-tbody"></tbody></table>`;
      $("findings").append(table);
    }
    const source = m.rule?.includes("Pipeline") || m.rule?.includes("Review") || m.rule?.includes("Branch") ? "gitlab" : m.rule?.includes("ticket") || m.rule?.includes("merged") ? "jira" : "drive";
    const sourceLabel = source === "gitlab" ? "GitLab" : source === "jira" ? "JIRA" : "Drive";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="severity ${m.severity}">${m.severity}</span></td>
      <td><span class="source-badge ${source}">${sourceLabel}</span></td>
      <td><strong>${({"Pipeline failed, no bug ticket":"Failed pipeline without tracking","No release notes":"Release notes not found","Review pending too long":"Stale review","MR merged, ticket still open":"Merged MR with open ticket","Branch with no MR":"Orphaned branch"})[m.rule]||m.rule}</strong><br><span style="color:#738170;font-size:11px">${m.summary}</span></td>
      <td style="font-size:11px;color:#537047">${m.suggestedAction}</td>
      <td></td>`;
    const btn = node("button", "Review →");
    btn.className = "primary";
    btn.style.cssText = "font-size:10px;padding:6px 10px";
    btn.addEventListener("click", () => task(async () => {
      preview = await api("/api/preview", { project: report.requestedProject, mismatch_id: m.id });
      $("preview-title").textContent = preview.description; $("preview-warning").textContent = preview.warning;
      $("preview-payload").textContent = JSON.stringify(preview.payload, null, 2);
      $("approve").textContent = config.readOnly ? "Hosted sample · read-only" : config.mode === "demo" ? "Approve simulated action" : "Approve action in live tools";
      $("preview-dialog").showModal();
    }));
    tr.lastElementChild.append(btn);
    document.getElementById("findings-tbody").append(tr);
  }
  if (!report.mismatches.length) $("findings").append(node("div", report.complete ? "No findings within the checked scope." : "No findings in available evidence.", "empty"));
  document.getElementById("filter-bar").hidden = !report.mismatches.length;
  if (report.mismatches.length) populateFilterDropdowns();
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


// ═══ Tool panel navigation ═══
document.querySelectorAll(".nav-item[data-tool]").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    item.classList.add("active");
    const tool = item.dataset.tool;
    document.querySelectorAll("main > section[id^='panel-']").forEach(p => p.hidden = true);
    const panel = document.getElementById(`panel-${tool}`);
    if (panel) panel.hidden = false;
    document.getElementById("page-title").textContent = item.textContent.trim();
    // Copy project ID across panels
    const proj = document.getElementById("project")?.value || "";
    document.querySelectorAll("input[id$='-project']").forEach(inp => { if (!inp.value) inp.value = proj; });
    document.getElementById("jtm-project") && (document.getElementById("jtm-project").value ||= proj);
  });
});

// ═══ Repo Status tool ═══
document.getElementById("rs-go")?.addEventListener("click", async () => {
  const project = document.getElementById("rs-project").value.trim();
  if (!project) return;
  const el = document.getElementById("rs-result");
  el.innerHTML = "<p class='hint'>Loading...</p>";
  try {
    const data = await api("/api/scan", { project });
    const proj = data.project || {};
    let html = `<div class="table-wrap"><table class="sync-table">
      <thead><tr><th>Source</th><th>Item</th><th>Status</th><th>Details</th></tr></thead><tbody>`;
    html += `<tr><td><span class="source-badge gitlab">GitLab</span></td><td>Pipeline</td>
      <td><span class="status-pill ${data.checks?.[1]?.status === 'complete' ? 'ok' : 'warn'}">${data.checks?.[1]?.status || '—'}</span></td>
      <td>${data.checks?.[1]?.message || 'Run scan for details'}</td></tr>`;
    html += `<tr><td><span class="source-badge gitlab">GitLab</span></td><td>Open MRs</td>
      <td><strong>${data.mismatches?.filter(m => m.rule?.includes('Review')).length || 0}</strong> stale</td>
      <td>${data.mismatches?.filter(m => m.rule?.includes('Review')).map(m => m.summary?.split(',')[0]).join(', ') || 'All reviews current'}</td></tr>`;
    html += `<tr><td><span class="source-badge jira">JIRA</span></td><td>Ticket sync</td>
      <td><span class="status-pill ${data.mismatches?.some(m => m.rule?.includes('ticket')) ? 'warn' : 'ok'}">${data.mismatches?.some(m => m.rule?.includes('ticket')) ? 'drifted' : 'synced'}</span></td>
      <td>${data.mismatches?.filter(m => m.rule?.includes('ticket')).length || 0} ticket mismatches</td></tr>`;
    html += `<tr><td><span class="source-badge drive">Drive</span></td><td>Release notes</td>
      <td><span class="status-pill ${data.mismatches?.some(m => m.rule?.includes('release')) ? 'warn' : 'ok'}">${data.mismatches?.some(m => m.rule?.includes('release')) ? 'missing' : 'found'}</span></td>
      <td>${data.mismatches?.filter(m => m.rule?.includes('release')).map(m => m.summary).join('; ') || 'Up to date'}</td></tr>`;
    html += `</tbody></table></div>`;
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<p class="notice error">${e.message}</p>`; }
});

// ═══ Session Diff tool ═══
document.getElementById("sd-go")?.addEventListener("click", async () => {
  const project = document.getElementById("sd-project").value.trim();
  if (!project) return;
  const el = document.getElementById("sd-result");
  el.innerHTML = "<p class='hint'>Comparing with last session...</p>";
  try {
    const data = await api("/api/scan", { project });
    let html = `<div class="table-wrap"><table class="sync-table">
      <thead><tr><th>Change</th><th>Source</th><th>Finding</th><th>Action</th></tr></thead><tbody>`;
    if (data.diff?.resolved?.length) {
      data.diff.resolved.forEach(r => {
        html += `<tr class="resolved"><td>✅ Resolved</td><td><span class="source-badge">${r.rule?.includes('Pipeline') ? 'GitLab' : r.rule?.includes('ticket') ? 'JIRA' : 'Drive'}</span></td>
          <td><s>${r.summary || r.rule}</s></td><td>—</td></tr>`;
      });
    }
    data.mismatches?.forEach(m => {
      const isNew = data.diff?.baseline && !data.diff?.resolved?.find(r => r.id === m.id);
      const source = m.rule?.includes('Pipeline') || m.rule?.includes('Review') || m.rule?.includes('Branch') ? 'gitlab' : m.rule?.includes('ticket') ? 'jira' : 'drive';
      html += `<tr><td>${isNew ? '🆕 New' : '⏳ Open'}</td><td><span class="source-badge ${source}">${source === 'gitlab' ? 'GitLab' : source === 'jira' ? 'JIRA' : 'Drive'}</span></td>
        <td>[${m.severity}] ${m.summary}</td><td>${m.suggestedAction}</td></tr>`;
    });
    if (!data.mismatches?.length && !data.diff?.resolved?.length) html += `<tr><td colspan="4" class="empty">No changes since last session.</td></tr>`;
    html += `</tbody></table></div>`;
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<p class="notice error">${e.message}</p>`; }
});

// ═══ JIRA to MR tool ═══
document.getElementById("jtm-go")?.addEventListener("click", async () => {
  const jiraKey = document.getElementById("jtm-jira").value.trim();
  const project = document.getElementById("jtm-project").value.trim();
  if (!jiraKey || !project) return;
  const el = document.getElementById("jtm-result");
  el.innerHTML = "<p class='hint'>Reading JIRA ticket and creating MR...</p>";
  try {
    // This calls our MCP jira_to_mr if available, otherwise show instructions
    el.innerHTML = `<div class="tool-result-card">
      <h3>Use in Kiro Chat</h3>
      <p>This tool works best through Kiro's MCP interface. Type in Kiro:</p>
      <pre>"Create an MR from ${jiraKey} in project ${project}"</pre>
      <p class="hint">The MCP server reads the ticket, creates a branch, and opens a draft MR with the JIRA link.</p>
    </div>`;
  } catch (e) { el.innerHTML = `<p class="notice error">${e.message}</p>`; }
});

// ═══ Sync Log tool ═══
document.getElementById("sl-go")?.addEventListener("click", async () => {
  const project = document.getElementById("sl-project").value.trim();
  if (!project) return;
  const el = document.getElementById("sl-result");
  el.innerHTML = "<p class='hint'>Loading notebook...</p>";
  try {
    const events = await api(`/api/events?project=${encodeURIComponent(project)}`);
    let html = `<div class="table-wrap"><table class="sync-table">
      <thead><tr><th>Time</th><th>Type</th><th>Details</th></tr></thead><tbody>`;
    events.slice().reverse().forEach(ev => {
      html += `<tr><td><time>${new Date(ev.at).toLocaleString()}</time></td>
        <td><span class="source-badge">${ev.type?.replaceAll("_", " ")}</span></td>
        <td>${ev.message || ev.finding || `${ev.findings ?? ""} findings`}</td></tr>`;
    });
    if (!events.length) html += `<tr><td colspan="3" class="empty">No activity yet. Run a scan first.</td></tr>`;
    html += `</tbody></table></div>`;
    el.innerHTML = html;
  } catch (e) { el.innerHTML = `<p class="notice error">${e.message}</p>`; }
});


// ═══ Findings table filters ═══
function getSource(m) {
  const r = m.rule || "";
  if (r.includes("Pipeline") || r.includes("Review") || r.includes("Branch")) return "gitlab";
  if (r.includes("ticket") || r.includes("merged")) return "jira";
  return "drive";
}
function getAssignee(m) {
  return m.details?.reviewers || m.details?.assignee || m.author?.name || "—";
}
function getAgeDays(m) {
  const d = m.details?.days_open || m.details?.merged_at || m.details?.created_at;
  if (m.details?.days_open) return m.details.days_open;
  if (d) return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return 0;
}

function populateFilterDropdowns() {
  if (!report?.mismatches) return;
  const assignees = new Set();
  const rules = new Set();
  report.mismatches.forEach(m => {
    assignees.add(getAssignee(m));
    rules.add(m.rule);
  });
  const fAssignee = document.getElementById("f-assignee");
  const fRule = document.getElementById("f-rule");
  // Keep the "All" option, remove rest
  while (fAssignee.options.length > 1) fAssignee.remove(1);
  while (fRule.options.length > 1) fRule.remove(1);
  [...assignees].sort().forEach(a => { const o = document.createElement("option"); o.value = a; o.textContent = a; fAssignee.append(o); });
  [...rules].sort().forEach(r => { const o = document.createElement("option"); o.value = r; o.textContent = r; fRule.append(o); });
}

function applyFilters() {
  const fSev = document.getElementById("f-severity").value;
  const fSrc = document.getElementById("f-source").value;
  const fAsg = document.getElementById("f-assignee").value;
  const fAge = document.getElementById("f-age").value;
  const fRule = document.getElementById("f-rule").value;
  const tbody = document.getElementById("findings-tbody");
  if (!tbody) return;
  let visible = 0;
  [...tbody.rows].forEach((row, i) => {
    const m = report.mismatches[i];
    if (!m) return;
    let show = true;
    if (fSev && m.severity !== fSev) show = false;
    if (fSrc && getSource(m) !== fSrc) show = false;
    if (fAsg && getAssignee(m) !== fAsg) show = false;
    if (fRule && m.rule !== fRule) show = false;
    if (fAge) {
      const days = getAgeDays(m);
      const limit = Number(fAge);
      if (limit === 91) { if (days < 90) show = false; }
      else { if (days > limit) show = false; }
    }
    row.hidden = !show;
    if (show) visible++;
  });
  document.getElementById("scanned-at").textContent = fSev || fSrc || fAsg || fAge || fRule
    ? `Showing ${visible} of ${report.mismatches.length} findings`
    : `Scanned ${new Date(report.scannedAt).toLocaleTimeString()}`;
}

// Wire up filter events
["f-severity", "f-source", "f-assignee", "f-age", "f-rule"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", applyFilters);
});
document.getElementById("f-clear")?.addEventListener("click", () => {
  ["f-severity", "f-source", "f-assignee", "f-age", "f-rule"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  applyFilters();
});

// Filter bar is shown by the render function after scan completes.
