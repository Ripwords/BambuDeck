import { readFile, writeFile } from "node:fs/promises";

function command(args: string[], capture = false) {
  const result = Bun.spawnSync(args, { stdout: capture ? "pipe" : "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} exited with ${result.exitCode}`);
  return capture ? result.stdout?.toString().trim() || "" : "";
}

const args = process.argv.slice(2);
const allowed = new Set(["--patch", "--minor", "--major", "--dry-run"]);
if (args.some((arg) => !allowed.has(arg)))
  throw new Error("Use --patch, --minor, --major, or --dry-run");
const bumps = args.filter((arg) => arg !== "--dry-run");
if (bumps.length > 1) throw new Error("Choose one version increment");
const bump = bumps[0] || "--patch";
const dryRun = args.includes("--dry-run");
const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
  throw new Error("Current version must be a stable semantic version");
const [major, minor, patch] = pkg.version.split(".").map(Number);
const version =
  bump === "--major"
    ? `${major + 1}.0.0`
    : bump === "--minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
const previous = `v${pkg.version}`;
const tag = `v${version}`;
if (command(["git", "branch", "--show-current"], true) !== "main")
  throw new Error("Release from main");
command(["git", "rev-parse", "--verify", previous], true);
if (command(["git", "tag", "--list", tag], true)) throw new Error(`${tag} already exists`);
console.info(`${previous} → ${tag}`);
if (dryRun) {
  command(["bunx", "--no-install", "changelogen", "--from", previous, "-r", version]);
  process.exit(0);
}
if (command(["git", "status", "--porcelain"], true))
  throw new Error("Commit or stash changes before releasing");
command(["git", "fetch", "origin", "main", "--tags"]);
if (
  command(["git", "rev-parse", "HEAD"], true) !== command(["git", "rev-parse", "origin/main"], true)
)
  throw new Error("Local main must match origin/main before releasing");
if (!command(["git", "log", "--format=%h", `${previous}..HEAD`], true))
  throw new Error("No commits to release");
command(["bun", "run", "check"]);
command(["bun", "run", "typecheck"]);
command(["bun", "run", "build"]);
command(["bun", "run", "docs:build"]);
command([
  "bunx",
  "--no-install",
  "changelogen",
  "--release",
  "-r",
  version,
  "--from",
  previous,
  "--no-commit",
  "--no-tag",
  "--no-github",
]);
const bumped = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
if (bumped.version !== version) throw new Error("Changelogen produced an unexpected version");
await writeFile("package.json", JSON.stringify(bumped, null, 2) + "\n");
command(["bunx", "--no-install", "oxfmt", "--write", "package.json"]);
command(["git", "add", "package.json", "CHANGELOG.md"]);
command(["git", "commit", "-m", `chore(release): ${tag}`]);
command(["git", "tag", "-a", tag, "-m", tag]);
command(["git", "push", "--atomic", "origin", "main", tag]);
console.info(`Published ${tag}. GitHub Actions will publish the Docker image and release assets.`);
