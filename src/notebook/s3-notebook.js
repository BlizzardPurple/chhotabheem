#!/usr/bin/env node
import { execFile } from "child_process";
import { createHash } from "crypto";

const BUCKET = process.env.PROJECTSYNC_S3_BUCKET || "projectsync-hackathon-2026";
const REGION = process.env.AWS_REGION || "us-west-2";

function hashKey(project) {
  const key = String(project);
  const name = key.includes("/") ? key.split("/").pop() : key;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

function s3(args) {
  return new Promise((resolve, reject) => {
    execFile("aws", ["s3api", ...args, "--region", REGION], {
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function getObject(key) {
  try {
    const raw = await s3(["get-object", "--bucket", BUCKET, "--key", key, "/dev/stdout"]);
    return raw;
  } catch {
    return null;
  }
}

async function putObject(key, body) {
  // Write to temp file then upload (aws cli needs a file for body)
  const tmp = `/tmp/ps-${Date.now()}.tmp`;
  const { writeFile, unlink } = await import("fs/promises");
  await writeFile(tmp, body, "utf-8");
  await new Promise((resolve, reject) => {
    execFile("aws", [
      "s3", "cp", tmp, `s3://${BUCKET}/${key}`, "--region", REGION,
    ], { timeout: 15000 }, (err) => {
      unlink(tmp).catch(() => {});
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── Public API (same interface as local notebook) ───────────────────────

export async function getProjectDirByPath(project) {
  const prefix = hashKey(project);
  return { dir: prefix, repoName: prefix.split("-")[0] };
}

export async function getProjectDir(cwd) {
  // Fallback for local git detection — not used with S3
  const { tryRun } = await import("../exec.js");
  const remote = await tryRun("git", ["remote", "get-url", "origin"], { cwd });
  if (!remote) return null;
  const repoName = remote.replace(/\.git$/, "").split("/").pop()?.split(":").pop() || "unknown";
  const prefix = hashKey(remote);
  return { dir: prefix, remoteUrl: remote, repoName };
}

export async function readSyncLog(prefix) {
  const data = await getObject(`${prefix}/sync-log.md`);
  return data || "No sync log yet. Run a scan first.";
}

export async function appendSyncLog(prefix, entry) {
  const existing = (await getObject(`${prefix}/sync-log.md`)) || "";
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  await putObject(`${prefix}/sync-log.md`, existing + `\n## Scan: ${ts}\n\n${entry}\n`);
}

export async function saveLastScan(prefix, results) {
  await putObject(`${prefix}/last-scan.json`, JSON.stringify(results, null, 2));
}

export async function readLastScan(prefix) {
  const data = await getObject(`${prefix}/last-scan.json`);
  if (!data) return null;
  try { return JSON.parse(data); } catch { return null; }
}

export async function markSession(prefix) {
  await putObject(`${prefix}/last-session.txt`, new Date().toISOString());
}

export async function readLastSession(prefix) {
  return await getObject(`${prefix}/last-session.txt`);
}
