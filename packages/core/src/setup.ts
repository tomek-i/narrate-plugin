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

/** True if the `playwright` package can be resolved from where the CLI runs. */
export async function hasPlaywright(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

/** `npm install` the Playwright package next to the CLI (no-op if already present). */
export function installPlaywrightPackage(log: (msg: string) => void = console.log): void {
  const root = packageRoot();
  log(`Installing Playwright into ${root}…`);
  execFileSync(isWin ? "npm.cmd" : "npm", ["install", "--omit=dev"], {
    cwd: root,
    stdio: "inherit",
  });
}

/** Download the Chromium browser binary (idempotent; fast if already installed). */
export function installChromium(log: (msg: string) => void = console.log): void {
  log("Installing the Chromium browser…");
  execFileSync(isWin ? "npx.cmd" : "npx", ["playwright", "install", "chromium"], {
    cwd: packageRoot(),
    stdio: "inherit",
  });
}

/**
 * Provision everything Playwright needs (package + Chromium). Run once after a
 * bare plugin install — the Chromium binary can't be bundled into the CLI.
 */
export async function setup(log: (msg: string) => void = console.log): Promise<void> {
  if (await hasPlaywright()) log("Playwright already installed.");
  else installPlaywrightPackage(log);
  installChromium(log);
  log("Setup complete.");
}
