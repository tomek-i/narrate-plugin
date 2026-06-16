import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** True if `playwright` can be resolved from where the CLI is running. */
export async function hasPlaywright(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Playwright + the Chromium browser next to the CLI. Run once after a
 * bare plugin install (the chromium binary can't be bundled into the CLI).
 */
export async function setup(log: (msg: string) => void = console.log): Promise<void> {
  const root = packageRoot();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";

  if (await hasPlaywright()) {
    log("Playwright already installed.");
  } else {
    log(`Installing Playwright into ${root}…`);
    execFileSync(npm, ["install", "--omit=dev"], { cwd: root, stdio: "inherit" });
  }

  log("Installing the Chromium browser…");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["playwright", "install", "chromium"], { cwd: root, stdio: "inherit" });
  log("Setup complete.");
}
