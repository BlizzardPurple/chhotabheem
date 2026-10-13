# BeyondGlean — Setup & Authentication Guide

## Current Auth Landscape (3 Separate Logins)

| Service | Auth Method | Command | Status |
|---|---|---|---|
| **GitLab** | `glab` CLI, PAT via keyring | `glab auth login` | ✅ Logged in as `garvit.jain3` |
| **JIRA** | `jira` CLI, API token | `jira init` | ✅ Logged in as `garvit.jain@nielsen.com` |
| **Google Workspace** | `clasp` CLI, OAuth via Google SSO | `npx @google/clasp login` | ✅ Logged in as `garvit.jain@nielsen.com` |

All three use the same Nielsen identity but different auth mechanisms. Unifying under a single sign-on is a future goal (see below).

---

## Step-by-Step Setup

### 1. GitLab CLI (`glab`)

```bash
# Install
brew install glab

# Login — opens browser for GitLab OAuth
glab auth login

# Verify
glab auth status
# Expected: ✓ Logged in to gitlab.com as <your-username>
```

### 2. JIRA CLI (`jira`)

```bash
# Install
brew install ankitpokhrel/jira-cli/jira-cli

# Init — interactive setup
jira init
# Server: https://jira-<your-org>.atlassian.net (or your Nielsen JIRA URL)
# Auth type: API Token
# Generate token at: https://id.atlassian.com/manage-profile/security/api-tokens

# Verify
jira me
# Expected: garvit.jain@nielsen.com
```

### 3. Google Workspace (via `clasp`)

```bash
# Step 1: Enable Apps Script API (ONE TIME — browser)
# Visit: https://script.google.com/home/usersettings
# Toggle ON "Google Apps Script API"

# Step 2: Login via clasp
npx -y @google/clasp login
# Opens browser → sign in with Nielsen Google account
# Grants: Drive (file), Script management, Cloud platform scopes

# Verify
ls ~/.clasprc.json  # Should exist after login
```

**What this gives us access to:**
- ✅ Google Drive — search, create, upload files
- ✅ Google Docs — create formatted docs via HTML-to-Docs conversion
- ❌ Google Calendar — needs separate OAuth scope (stretch goal via Apps Script web app)
- ❌ Gmail — needs separate OAuth scope

### 4. BeyondGlean MCP Server (Kiro Integration)

```bash
# Install dependencies
cd /path/to/chhotabheem
npm install

# Add to Kiro MCP config
# Edit ~/.kiro/settings/mcp.json and add:
```

```json
{
  "mcpServers": {
    "beyondglean": {
      "command": "npx",
      "args": ["tsx", "/path/to/chhotabheem/src/server.ts"],
      "env": {
        "GITLAB_TOKEN": "${GITLAB_TOKEN}",
        "CHHOTABHEEM_TEST_MODE": "true"
      }
    }
  }
}
```

```bash
# Restart Kiro — MCP server will auto-start
# Verify: type in Kiro chat "list my MRs" — should work
```

---

## Google Workspace API Details

### What Works (via clasp's Drive token)

The clasp OAuth token includes `drive.file` and `cloud-platform` scopes, which gives us:

**Create Google Docs (from code):**
```bash
# HTTP: POST to Drive API with HTML content → auto-converts to Google Doc
curl -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F 'metadata={"name": "My Doc", "mimeType": "application/vnd.google-apps.document"};type=application/json' \
  -F "file=@content.html;type=text/html"
```

**Search Drive:**
```bash
curl "https://www.googleapis.com/drive/v3/files?q=name+contains+'search'" \
  -H "Authorization: Bearer ${TOKEN}"
```

**Upload files:**
```bash
curl -X POST "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F 'metadata={"name": "file.png"};type=application/json' \
  -F "file=@localfile.png;type=image/png"
```

### What Doesn't Work (yet)

- **Calendar**: The clasp token doesn't request `calendar` scope. Fix: deploy the Apps Script as a web app (uses its own scopes), or add a separate OAuth flow for calendar.
- **Gmail**: Same scope issue. Stretch goal.
- **Public sharing**: Nielsen org policy blocks `publishOutNotPermitted` — files can't be made public. Internal sharing works fine.

### Token Refresh (for MCP server use)

```typescript
// The MCP server refreshes the Google token automatically:
// 1. Read refresh_token from ~/.clasprc.json
// 2. POST to https://oauth2.googleapis.com/token with grant_type=refresh_token
// 3. Use the fresh access_token for API calls
// Token expires every ~1 hour, refresh_token is long-lived
```

---

## Future Goal: Single Sign-On

Currently three separate auth flows. The ideal state:

```bash
beyondglean auth login
# → Detects Nielsen SSO
# → Opens ONE browser tab
# → Authenticates against Nielsen Identity Provider
# → Obtains tokens for GitLab, JIRA, Google simultaneously
# → Stores in unified credential store (~/.beyondglean/credentials.json)
```

**How this could work:**
1. Nielsen uses Google Workspace as identity provider
2. GitLab is configured with Google OAuth (gitlab.com supports this)
3. JIRA (Atlassian) supports Google SSO
4. Google APIs use the Google OAuth token directly

If all three services accept Google as the identity provider, a single Google OAuth flow with the right scopes could theoretically authenticate all three. This requires:
- A Nielsen-approved GCP project with the necessary OAuth scopes
- All three services configured to accept the same OAuth client

**For the hackathon:** The three-login approach works. Single sign-on is a "path to production" talking point.

---

## Proven Capabilities (as of Oct 13, 2026)

| Capability | Tested | Result |
|---|---|---|
| Create GitLab repo | ✅ | Works (created + deleted test repo) |
| List GitLab groups/repos | ✅ | Access to `nielsen-media/` namespace |
| GitLab API calls | ✅ | Token works for REST API |
| JIRA list projects | ✅ | Access to N1 Ads projects |
| JIRA create/assign/move | ✅ | CLI supports full CRUD |
| Google Docs creation | ✅ | Formatted doc with images created |
| Google Drive search | ✅ | Can find files by name |
| Google Drive upload | ✅ | Files upload successfully |
| Google Calendar | ❌ | Insufficient scope — stretch goal |
| Google Doc with logo | ✅ | Base64 image embedded via HTML conversion |

---

## Reference Links

- [AI Enablement / Glean Info](https://sites.google.com/nielsen.com/ai-enablement/glean?authuser=0)
- [Hack-AI-Thon '26 Info](https://sites.google.com/nielsen.com/ai-enablement/hack-ai-thon26?authuser=0)
- [Google Apps Script Editor](https://script.google.com/d/1ArimAIX-bG1BraegGDQPgUANNY7c2g3Ch7mJVjZ9cEn0KJNp8rKSNpnD/edit)
- [BeyondGlean Idea Doc](https://docs.google.com/document/d/1OP_bCy4mlv_NacaxUx2mdrMkzc0u0DV7cvm4g9ITOaM/edit)
