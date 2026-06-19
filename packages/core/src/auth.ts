import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ensureGitignore } from "./project.js";
import { launchBrowser, loadChromium } from "./record/playwright.js";
import { hasPlaywright, installChromium, installPlaywrightPackage } from "./setup.js";

export interface AuthCaptureOptions {
  /** Login URL to open. */
  url: string;
  /** Where to write the Playwright storage-state JSON (relative to cwd). */
  out: string;
  cwd: string;
  onLog?: (msg: string) => void;
}

/** True if `abs` is inside `.narrate/` (already gitignored by `init`). */
function underNarrateDir(cwd: string, abs: string): boolean {
  const rel = relative(resolve(cwd, ".narrate"), abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Open a real (headed) browser at `url` so the user can log in by hand, then save
 * the resulting session (cookies + localStorage) to a storage-state file that a
 * scene's `auth.storageState` can load. Blocks until the user **closes the browser**,
 * then returns the saved path — so an agent can invoke it on demand and continue
 * once it returns. No credential ever passes through the caller.
 *
 * The session is snapshotted continuously (on every page load and on a short
 * interval), so whatever is on disk when the window closes reflects the logged-in
 * state — there's nothing to "submit" or confirm beyond closing the window.
 */
export async function captureAuth(opts: AuthCaptureOptions): Promise<string> {
  const log = (m: string) => opts.onLog?.(m);
  const out = resolve(opts.cwd, opts.out);
  mkdirSync(dirname(out), { recursive: true });

  // Same one-time provisioning as `render`, so `auth` works on a fresh install.
  if (!(await hasPlaywright())) {
    log("First run: provisioning the headless browser (one-time)…");
    installPlaywrightPackage(log);
    installChromium(log);
  }

  const chromium = await loadChromium();
  const browser = await launchBrowser(chromium, { headed: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(opts.url, { waitUntil: "domcontentloaded" }).catch(() => {});

  log(`Opened ${opts.url}. Log in, then CLOSE THE BROWSER WINDOW to save the session…`);

  // Snapshot the storage state repeatedly; the last successful write before the
  // window closes is the saved session. Capturing on each page load means the
  // post-login navigation is recorded even if the user closes immediately after.
  let captured = false;
  const snapshot = async () => {
    try {
      await context.storageState({ path: out });
      captured = true;
    } catch {
      // Context already tearing down (window closing) — ignore; a prior snapshot stands.
    }
  };
  const timer = setInterval(snapshot, 750);
  context.on("page", (p) => p.on("load", snapshot));
  page.on("load", snapshot);

  // Resolve when the user closes the browser (process exits → disconnected).
  await new Promise<void>((res) => {
    browser.on("disconnected", () => res());
    context.on("close", () => res());
  });
  clearInterval(timer);
  await snapshot(); // best-effort final capture (usually already disconnected)
  try {
    await browser.close();
  } catch {}

  if (!captured) {
    throw new Error(
      `No session was captured for ${out}. The browser closed before any state could be saved — re-run \`narrate auth ${opts.url}\` and close it after you're logged in.`,
    );
  }

  // Keep the token-bearing file out of git. Under `.narrate/` it's already covered.
  if (underNarrateDir(opts.cwd, out)) {
    ensureGitignore(opts.cwd, ".narrate/");
  } else {
    const rel = relative(opts.cwd, out).split("\\").join("/");
    ensureGitignore(opts.cwd, rel);
    log(`Added ${rel} to .gitignore (it holds session tokens).`);
  }

  log(`Saved session → ${out}`);
  return out;
}
