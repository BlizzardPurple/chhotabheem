import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

let _accessToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;

  const claspPath = join(homedir(), ".clasprc.json");
  let creds;
  try { creds = JSON.parse(await readFile(claspPath, "utf-8")); }
  catch { throw new Error("No clasp credentials. Run `npx @google/clasp login` first."); }

  const { client_id, client_secret, refresh_token } = creds.tokens.default;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id, client_secret }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = await res.json();
  _accessToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _accessToken;
}

/** Create a Google Doc from HTML content. Returns { id, url, name }. */
export async function createDoc(title, htmlContent) {
  const token = await getAccessToken();
  const boundary = "----ProjectSyncBoundary";
  const metadata = JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: text/html\r\n\r\n${htmlContent}\r\n--${boundary}--`;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive create doc failed: ${res.status}`);
  const file = await res.json();
  return { id: file.id, name: file.name, url: `https://docs.google.com/document/d/${file.id}/edit` };
}

/** Search Google Drive. */
export async function searchDrive(query, maxResults = 10) {
  const token = await getAccessToken();
  const q = encodeURIComponent(query);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive search failed: ${res.status}`);
  const data = await res.json();
  return (data.files || []).map(f => ({
    id: f.id, name: f.name, url: f.webViewLink || `https://drive.google.com/file/d/${f.id}`,
    mimeType: f.mimeType, modifiedTime: f.modifiedTime,
  }));
}
