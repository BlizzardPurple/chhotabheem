#!/bin/bash
# BeyondGlean — Google Workspace Setup
# Run this script to authenticate and deploy the Apps Script bridge.

set -e

echo "🔑 Step 1: Authenticate with Google (opens browser)..."
npx -y @google/clasp login

echo ""
echo "✅ Authenticated! Creating Apps Script project..."
cd "$(dirname "$0")"

npx -y @google/clasp create \
  --title "BeyondGlean Workspace Bridge" \
  --type webapp \
  --rootDir .

echo ""
echo "📤 Pushing code to Google Apps Script..."
npx -y @google/clasp push --force

echo ""
echo "🚀 Deploying as web app..."
DEPLOY_OUTPUT=$(npx -y @google/clasp deploy --description "BeyondGlean v1")
echo "$DEPLOY_OUTPUT"

echo ""
echo "📋 Getting web app URL..."
npx -y @google/clasp open --webapp

echo ""
echo "✅ Done! The web app URL is your BeyondGlean Google Workspace endpoint."
echo "Add it to your .chhotabheem/config.yaml as:"
echo "  google_workspace_url: <the URL from above>"
