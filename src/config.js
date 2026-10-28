import { homedir } from "os";
import { join } from "path";

export const PROJECTSYNC_HOME = process.env.PROJECTSYNC_HOME || join(homedir(), ".projectsync");
export const GITLAB_HOST = process.env.GITLAB_HOST || "https://gitlab.com";
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";
export const REVIEW_STALE_DAYS = Number(process.env.REVIEW_STALE_DAYS || "3");
if (!Number.isFinite(REVIEW_STALE_DAYS) || REVIEW_STALE_DAYS < 0 || REVIEW_STALE_DAYS > 365) {
  throw new Error("REVIEW_STALE_DAYS must be a number between 0 and 365.");
}
