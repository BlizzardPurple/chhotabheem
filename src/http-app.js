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
