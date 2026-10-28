import { execFile } from "child_process";

/** Run a command and return stdout. Throws on non-zero exit. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeout ?? 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

/** Run a command and return stdout, or null on failure. */
export async function tryRun(cmd, args, opts = {}) {
  try { return await run(cmd, args, opts); }
  catch { return null; }
}
