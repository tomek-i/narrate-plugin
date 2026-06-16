import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";

/** Walk up from the running module to the nearest dir containing package.json. */
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/**
 * Run npm. On Windows the launcher is `npm.cmd`, and Node refuses to spawn a
 * `.cmd` without a shell (security hardening), so use a shell there.
 */
function npm(args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): void {
  execFileSync(isWin ? "npm.cmd" : "npm", args, {
    cwd,
    stdio: "inherit",
    shell: isWin,
    env: { ...process.env, ...extraEnv },
  });
}

/** True if the `playwright` package can be resolved from where the CLI runs. */
export async function hasPlaywright(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the Playwright package next to the CLI — *without* its browsers
 * (we prefer an already-installed Edge/Chrome at launch; Chromium is fetched
 * lazily only if no system browser is found). Fast, ~no large download.
 */
export function installPlaywrightPackage(log: (msg: string) => void = console.log): void {
  const root = packageRoot();
  log(`Installing Playwright into ${root}…`);
  npm(["install", "--omit=dev"], root, { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" });
}

/**
 * Download the Chromium browser via Playwright's own CLI (invoked through
 * `node`, so there's no `.cmd` spawn issue). Only needed when no installed
 * Edge/Chrome is available. Idempotent.
 */
export function installChromium(log: (msg: string) => void = console.log): void {
  const root = packageRoot();
  const cli = join(root, "node_modules", "playwright", "cli.js");
  log("Downloading the Chromium browser…");
  if (existsSync(cli)) {
    execFileSync(process.execPath, [cli, "install", "chromium"], { cwd: root, stdio: "inherit" });
  } else {
    // Fallback if the package layout differs.
    npm(["exec", "--", "playwright", "install", "chromium"], root);
  }
}

/**
 * Provision Playwright (package only). Browsers are resolved at launch: an
 * installed Edge/Chrome is used if present, otherwise Chromium is downloaded.
 */
export async function setup(log: (msg: string) => void = console.log): Promise<void> {
  if (await hasPlaywright()) log("Playwright already installed.");
  else installPlaywrightPackage(log);
  log("Setup complete. A browser will be resolved on first render.");
}
