import { homedir } from "os";
import { join } from "path";

export const TEST_MODE = process.env.PROJECTSYNC_TEST_MODE === "true";
export const PROJECTSYNC_HOME = process.env.PROJECTSYNC_HOME || join(homedir(), ".projectsync");
export const GITLAB_HOST = process.env.GITLAB_HOST || "https://gitlab.com";
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";
export const AWS_REGION = process.env.AWS_REGION || "us-west-2";
export const BEDROCK_MODEL = process.env.BEDROCK_MODEL || "global.anthropic.claude-sonnet-4-6";
export const REVIEW_STALE_DAYS = Number(process.env.REVIEW_STALE_DAYS || "3");
