import { createServer } from "node:http";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Native HTTP adapter, shared by the usual entry point and the deliverable launcher. */
export function createProjectSyncServer(handleRequest) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) { res.writeHead(413); res.end("Request too large"); return; }
        chunks.push(chunk);
      }
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers,
        ...(req.method !== "GET" && req.method !== "HEAD" ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handleRequest(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"error":"Request failed."}'); }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;
  return server;
}

export async function startServer({ port = Number(process.env.PORT || 3021),
  host = process.env.PROJECTSYNC_PUBLIC_DEMO === "true" ? "0.0.0.0" : "127.0.0.1",
  handler, serverFactory = createProjectSyncServer } = {}) {
  // Port zero is available to programmatic rehearsals; the user-facing CLI rejects it.
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be between 0 and 65535.");
  const app = handler || (await import("./http-app.js")).handleRequest;
  const server = serverFactory(app);
  await new Promise((resolveListening, reject) => {
    const onError = error => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolveListening(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const actualPort = server.address()?.port || port;
  return { server, port: actualPort, host, url: `http://127.0.0.1:${actualPort}` };
}

/** Drain active requests, then close remaining connections if shutdown takes too long. */
export function attachShutdown(server, { processLike = process, timeoutMs = 5000 } = {}) {
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => server.closeAllConnections?.(), timeoutMs);
    deadline.unref?.();
    server.close(() => { clearTimeout(deadline); processLike.exitCode = 0; dispose(); });
    server.closeIdleConnections?.();
  };
  const dispose = () => {
    processLike.off("SIGTERM", shutdown);
    processLike.off("SIGINT", shutdown);
  };
  processLike.on("SIGTERM", shutdown);
  processLike.on("SIGINT", shutdown);
  return dispose;
}

const isDirect = process.argv[1] && existsSync(process.argv[1]) && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
if (isDirect) {
  try {
    await import("./load-env.js");
    const started = await startServer();
    attachShutdown(started.server);
    console.error(`ProjectSync: ${started.url} (${process.env.PROJECTSYNC_MODE || "live"})`);
  } catch (error) {
    console.error(error.code === "EADDRINUSE"
      ? `Port ${process.env.PORT || 3021} is already in use. Stop the other server or set PORT to another port.`
      : `Server could not start: ${error.message}`);
    process.exitCode = 1;
  }
}
