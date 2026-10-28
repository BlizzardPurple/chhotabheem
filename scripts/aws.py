#!/usr/bin/env python3
"""Optional AWS demo lifecycle. Package/plan are offline; deploy/destroy are explicit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "aws"


def package():
    required = ["src/http-app.js", "public", "deploy/lambda.mjs", "package.json", "node_modules"]
    for name in required:
        if not (ROOT / name).exists():
            raise RuntimeError(f"Missing {name}. Finish the application and run npm ci first.")
    DIST.mkdir(parents=True, exist_ok=True)
    archive = DIST / "projectsync.zip"
    # Explicit inputs prevent .env, CLI credentials, Git data, and notebooks being uploaded.
    inputs = [ROOT / name for name in ("src", "public", "node_modules", "package.json", "package-lock.json", "deploy/lambda.mjs")]
    files = []
    for source in inputs:
        if source.is_dir():
            files.extend(p for p in source.rglob("*") if p.is_file())
        elif source.is_file():
            files.append(source)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for source in sorted(files):
            relative = source.relative_to(ROOT)
            if source.is_symlink() or ".bin" in relative.parts:
                continue
            if any(part == ".env" or part.startswith(".env.") for part in relative.parts):
                continue
            # Stable metadata makes identical inputs produce the same artifact hash.
            info = zipfile.ZipInfo(relative.as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, source.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    manifest = {"archive": str(archive.relative_to(ROOT)), "sha256": digest, "bytes": archive.stat().st_size, "scope": "public synthetic read-only demo"}
    (DIST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return archive, digest


class Aws:
    def __init__(self, args):
        if not shutil.which("aws"):
            raise RuntimeError("AWS CLI v2 is not installed. Local demo and offline package/plan still work; see docs/AWS.md.")
        self.args = args

    def run(self, *command, capture=True):
        invocation = ["aws", "--profile", self.args.profile, "--region", self.args.region, "--no-cli-pager", *command]
        result = subprocess.run(invocation, cwd=ROOT, text=True, capture_output=capture, env={**os.environ, "AWS_PAGER": ""})
        if result.returncode:
            raise RuntimeError((result.stderr or "AWS command failed").strip())
        return result.stdout if capture else ""

    def check_account(self):
        identity = json.loads(self.run("sts", "get-caller-identity", "--output", "json"))
        if identity["Account"] != self.args.account_id:
            raise RuntimeError("AWS account mismatch: refusing to operate outside the explicitly selected burner account.")
        print(f"Verified account {identity['Account']}; region {self.args.region}; profile {self.args.profile}.")

    def outputs(self, stack):
        result = json.loads(self.run("cloudformation", "describe-stacks", "--stack-name", stack, "--output", "json"))
        return {item["OutputKey"]: item["OutputValue"] for item in result["Stacks"][0].get("Outputs", [])}

    def deploy_stack(self, stack, template, parameters=()):
        command = ["cloudformation", "deploy", "--stack-name", stack, "--template-file", str(ROOT / "deploy" / template), "--no-fail-on-empty-changeset", "--tags", "Project=ProjectSync", "Mode=SyntheticDemo"]
        if template == "template.json":
            command.extend(["--capabilities", "CAPABILITY_IAM"])
        if parameters:
            command.extend(["--parameter-overrides", *parameters])
        self.run(*command, capture=False)


def plan(args):
    print(json.dumps({
        "mode": "offline plan; no AWS calls or changes",
        "region": args.region,
        "profile": args.profile,
        "stacks": [args.stack + "-artifacts", args.stack],
        "resources": ["Private encrypted S3 artifact bucket (7-day build expiry)", "Lambda Node.js 24 arm64, 256 MB, 10-second timeout", "Public HTTPS HTTP API: synthetic scan and preview only", "IAM role: write only this function's logs", "CloudWatch log group, 3-day retention"],
        "target_throttle": "5 requests/second, burst 10; best effort, not a spending cap",
        "not_deployed": ["Real GitLab/Jira/Drive credentials or data", "MCP transport", "Bedrock model", "Persistent application database"],
        "next": "After local demo sign-off: install AWS CLI, configure hackathon profile, then use deploy with --account-id. See docs/AWS.md.",
    }, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["plan", "package", "deploy", "status", "destroy"], nargs="?", default="plan")
    parser.add_argument("--profile", default="hackathon")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--stack", default="projectsync-demo")
    parser.add_argument("--account-id", help="Expected 12-digit burner AWS account; required for every AWS command")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9-]{0,39}", args.stack):
        parser.error("--stack must start with a letter, contain only letters, numbers or hyphens, and be at most 40 characters")
    if args.command == "plan":
        return plan(args)
    if args.command == "package":
        return package()
    if not args.account_id or not re.fullmatch(r"\d{12}", args.account_id):
        parser.error("AWS operations require --account-id with the expected 12-digit burner account")
    aws = Aws(args)
    aws.check_account()
    if args.command == "status":
        print(json.dumps(aws.outputs(args.stack), indent=2))
        return
    artifacts_stack = args.stack + "-artifacts"
    if args.command == "deploy":
        subprocess.run(["npm", "test"], cwd=ROOT, check=True)
        archive, digest = package()
        aws.deploy_stack(artifacts_stack, "artifacts.json")
        bucket = aws.outputs(artifacts_stack)["BucketName"]
        key = f"builds/{digest}.zip"
        aws.run("s3", "cp", str(archive), f"s3://{bucket}/{key}", "--only-show-errors")
        aws.deploy_stack(args.stack, "template.json", [f"ArtifactBucket={bucket}", f"ArtifactKey={key}"])
        print(json.dumps(aws.outputs(args.stack), indent=2))
    elif args.command == "destroy":
        # Bucket comes only from this deployment's stack; never accepts arbitrary bucket names.
        bucket = aws.outputs(artifacts_stack)["BucketName"]
        aws.run("cloudformation", "delete-stack", "--stack-name", args.stack)
        aws.run("cloudformation", "wait", "stack-delete-complete", "--stack-name", args.stack, capture=False)
        aws.run("s3", "rm", f"s3://{bucket}/builds/", "--recursive", "--only-show-errors")
        aws.run("cloudformation", "delete-stack", "--stack-name", artifacts_stack)
        aws.run("cloudformation", "wait", "stack-delete-complete", "--stack-name", artifacts_stack, capture=False)
        print("Removed ProjectSync demo stacks and build artifacts.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
