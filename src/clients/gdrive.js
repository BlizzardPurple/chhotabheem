import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

let accessToken;
let tokenExpiry = 0;
async function getAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  let credentials;
  try {
    const file = JSON.parse(await readFile(join(homedir(), ".clasprc.json"), "utf8"));
    credentials = file.tokens?.default;
  } catch { /* Report missing configuration without exposing credential file contents. */ }
  if (!credentials?.client_id || !credentials?.client_secret || !credentials?.refresh_token) {
    throw new Error("Google Drive unavailable. Set GOOGLE_ACCESS_TOKEN or configure clasp with Drive access.");
  }
  const { client_id, client_secret, refresh_token } = credentials;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id, client_secret }),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status}).`);
  const data = await response.json();
  if (!data.access_token) throw new Error("Google token refresh returned no access token.");
  accessToken = data.access_token;
  tokenExpiry = Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
  return accessToken;
}

export function createDriveClient({ fetchImpl = globalThis.fetch, tokenProvider = getAccessToken,
  timeoutMs = 15_000, maxPages = 10 } = {}) {
  async function request(url, init = {}) {
    const token = await tokenProvider();
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}). Check permissions and Drive OAuth scopes.`);
    return response.json();
  }
  return {
    createDoc: async (title, htmlContent) => {
      const boundary = `ProjectSync${randomUUID()}`;
      const metadata = JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: text/html\r\n\r\n${htmlContent}\r\n--${boundary}--\r\n`;
      const file = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
      });
      if (!file.id) throw new Error("Google Drive create response lacked a document ID; check Drive before retrying.");
      return { id: file.id, name: file.name, url: `https://docs.google.com/document/d/${file.id}/edit` };
    },
    searchDrive: async (query, pageSize = 100) => {
      const files = [];
      let pageToken;
      for (let page = 0; page < maxPages; page++) {
        const search = new URLSearchParams({ q: query, fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)",
          pageSize: String(Math.max(1, Math.min(1000, pageSize))), orderBy: "modifiedTime desc" });
        if (pageToken) search.set("pageToken", pageToken);
        const data = await request(`https://www.googleapis.com/drive/v3/files?${search}`);
        if (!Array.isArray(data.files)) throw new Error("Unexpected Google Drive search response.");
        files.push(...data.files.map(file => ({ id: file.id, name: file.name,
          url: file.webViewLink || `https://drive.google.com/file/d/${file.id}`,
          mimeType: file.mimeType, modifiedTime: file.modifiedTime })));
        if (!data.nextPageToken) return files;
        if (pageToken === data.nextPageToken) throw new Error("Invalid Google Drive pagination response.");
        pageToken = data.nextPageToken;
      }
      throw new Error("Google Drive search exceeded the pagination limit; results are incomplete.");
    },
  };
}
export const { createDoc, searchDrive } = createDriveClient();
