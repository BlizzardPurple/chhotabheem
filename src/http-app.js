import { readFile } from "node:fs/promises";
import { createRuntime } from "./runtime.js";

const assets = new Map([["/", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/pitch", ["pitch.html", "text/html; charset=utf-8"]], ["/pitch.html", ["pitch.html", "text/html; charset=utf-8"]], ["/pitch.css", ["pitch.css", "text/css; charset=utf-8"]], ["/pitch.js", ["pitch.js", "text/javascript; charset=utf-8"]]]);
const baseHeaders = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...baseHeaders, "Content-Type": "application/json" } });
const validProject = value => typeof value === "string" && value.trim().length > 0 && value.length <= 300 && !/[\x00-\x1f]/.test(value);

export function createHttpApp({ runtimeFactory = createRuntime, publicDemo = process.env.PROJECTSYNC_PUBLIC_DEMO === "true" } = {}) {
  let runtimePromise;
  const runtime = () => runtimePromise ||= runtimeFactory();
  return async function handleRequest(request) {
    const url = new URL(request.url);
    // Live server is intentionally loopback-only. Public cloud mode can only use fixtures.
    if (!publicDemo && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return json({ error: "Local access only." }, 403);
    if (request.method === "GET" && assets.has(url.pathname)) {
      const [file, contentType] = assets.get(url.pathname);
      return new Response(await readFile(new URL(`../public/${file}`, import.meta.url)), { headers: { ...baseHeaders, "Content-Type": contentType } });
    }
    if (request.method === "GET" && ["/health", "/healthz"].includes(url.pathname)) return json({ status: "ok", service: "project-sync" });
    try {
      const app = await runtime();
      if (publicDemo && app.mode !== "demo") return json({ error: "Public mode requires synthetic data." }, 503);
      if (request.method === "GET" && url.pathname === "/api/config") return json({ mode: app.mode, project: app.project, readOnly: publicDemo });
      if (request.method === "GET" && url.pathname === "/api/events") return json(app.workflow.getEvents(url.searchParams.get("project")));
      if (request.method === "GET" && url.pathname === "/api/activity") {
        const project = url.searchParams.get("project");
        if (!project) return json({ error: "Provide a project parameter." }, 400);
        try {
          const { createGitlabClient } = await import("./clients/gitlab.js");
          const gl = createGitlabClient();
          const proj = await gl.getProject(project);
          const pid = proj.id;
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          
          const [mergedMRs, openMRs, pipelines, events] = await Promise.all([
            gl.listMRs(pid, { state: "merged", order_by: "updated_at", sort: "desc", per_page: 10 }).catch(() => []),
            gl.listMRs(pid, { state: "opened", order_by: "updated_at", sort: "desc", per_page: 10 }).catch(() => []),
            gl.listPipelines(pid, { per_page: 10 }).catch(() => []),
            gl.listEvents ? gl.listEvents(pid, { per_page: 20 }).catch(() => []) : Promise.resolve([]),
          ]);

          const activity = [];
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;

          mergedMRs.filter(mr => new Date(mr.merged_at).getTime() > cutoff).forEach(mr => {
            activity.push({ type: "merged", icon: "✅", time: mr.merged_at,
              title: `MR !${mr.iid} merged`, detail: mr.title, author: mr.author?.name || "unknown",
              url: mr.web_url, source: "gitlab" });
          });

          openMRs.filter(mr => new Date(mr.updated_at).getTime() > cutoff).forEach(mr => {
            const age = Math.floor((Date.now() - new Date(mr.created_at).getTime()) / 86400000);
            if (new Date(mr.created_at).getTime() > cutoff) {
              activity.push({ type: "opened", icon: "🆕", time: mr.created_at,
                title: `MR !${mr.iid} opened`, detail: mr.title, author: mr.author?.name || "unknown",
                url: mr.web_url, source: "gitlab" });
            } else if (mr.user_notes_count > 0) {
              activity.push({ type: "reviewed", icon: "💬", time: mr.updated_at,
                title: `MR !${mr.iid} got activity`, detail: `${mr.title} (${mr.user_notes_count} comments, ${age}d old)`,
                author: (mr.reviewers || []).map(r => r.name).join(", ") || "unknown",
                url: mr.web_url, source: "gitlab" });
            }
          });

          pipelines.filter(p => new Date(p.created_at).getTime() > cutoff).forEach(p => {
            const icon = p.status === "success" ? "🟢" : p.status === "failed" ? "🔴" : "🟡";
            activity.push({ type: `pipeline_${p.status}`, icon, time: p.created_at,
              title: `Pipeline #${p.id} ${p.status}`, detail: `Branch: ${p.ref}`,
              author: p.source || "push", url: p.web_url, source: "gitlab" });
          });

          activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

          return json({ project: proj.path_with_namespace, period: "24h", count: activity.length, activity });
        } catch (e) {
          return json({ error: e.message }, 400);
        }
      }
      if (request.method !== "POST") return json({ error: "Route not found." }, 404);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Send application/json." }, 415);
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 16_384) return json({ error: "Request too large." }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Expected a JSON object." }, 400);
      if (url.pathname === "/api/reset") {
        if (app.mode !== "demo" || publicDemo) return json({ error: "Reset is only available in the local sample demo." }, 403);
        runtimePromise = runtimeFactory();
        return json({ reset: true });
      }
      if (!validProject(body.project)) return json({ error: "Provide a GitLab project path or ID." }, 400);
      if (url.pathname === "/api/scan") return json(await app.workflow.scan(body.project));
      if (url.pathname === "/api/preview") {
        if (typeof body.mismatch_id !== "string") return json({ error: "Select a finding." }, 400);
        // Hosted sample requests need no session affinity: recreate the fixture snapshot.
        if (publicDemo) await app.workflow.scan(body.project);
        return json(await app.workflow.preview(body.project, body.mismatch_id));
      }
      if (url.pathname === "/api/execute") {
        if (publicDemo) return json({ error: "Hosted sample is read-only. Run locally for the approval demo." }, 403);
        if (typeof body.approval_token !== "string") return json({ error: "Preview the action first." }, 400);
        return json(await app.workflow.execute(body.project, body.approval_token, body.approved));
      }
      return json({ error: "Route not found." }, 404);
    } catch (error) { return json({ error: error.message }, 400); }
  };
}

export const handleRequest = createHttpApp();
