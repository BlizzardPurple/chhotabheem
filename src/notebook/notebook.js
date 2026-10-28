import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";
import { PROJECTSYNC_HOME } from "../config.js";
import { tryRun } from "../exec.js";

function hashRemote(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

/** Get notebook dir for a project by git remote (auto-detect from cwd). */
export async function getProjectDir(cwd) {
  const remote = await tryRun("git", ["remote", "get-url", "origin"], { cwd });
  if (!remote) return null;

  const repoName = remote.replace(/\.git$/, "").split("/").pop()?.split(":").pop() || "unknown";
  const dir = join(PROJECTSYNC_HOME, `${repoName}-${hashRemote(remote)}`);
  await mkdir(dir, { recursive: true });
  return { dir, remoteUrl: remote, repoName };
}

/** Get notebook dir for a project by GitLab path or ID (no git needed). */
export async function getProjectDirByPath(projectPath) {
  const key = String(projectPath);
  const repoName = key.includes("/") ? key.split("/").pop() : key;
  const dir = join(PROJECTSYNC_HOME, `${repoName}-${hashRemote(key)}`);
  await mkdir(dir, { recursive: true });
  return { dir, repoName };
}

/** Read sync log. */
export async function readSyncLog(projectDir) {
  try { return await readFile(join(projectDir, "sync-log.md"), "utf-8"); }
  catch { return "No sync log yet. Run a scan first."; }
}

/** Append to sync log. */
export async function appendSyncLog(projectDir, entry) {
  const logPath = join(projectDir, "sync-log.md");
  let existing = "";
  try { existing = await readFile(logPath, "utf-8"); } catch {}
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  await writeFile(logPath, existing + `\n## Scan: ${ts}\n\n${entry}\n`, "utf-8");
}

/** Save last scan results for diffing. */
export async function saveLastScan(projectDir, results) {
  await writeFile(join(projectDir, "last-scan.json"), JSON.stringify(results, null, 2), "utf-8");
}

export async function readLastScan(projectDir) {
  try { return JSON.parse(await readFile(join(projectDir, "last-scan.json"), "utf-8")); }
  catch { return null; }
}

/** Save session timestamp. */
export async function markSession(projectDir) {
  await writeFile(join(projectDir, "last-session.txt"), new Date().toISOString(), "utf-8");
}

export async function readLastSession(projectDir) {
  try { return await readFile(join(projectDir, "last-session.txt"), "utf-8"); }
  catch { return null; }
}
