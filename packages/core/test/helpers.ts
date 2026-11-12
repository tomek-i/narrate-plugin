import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadChromium } from "../src/record/playwright.js";

export interface TestServer {
  url: string;
  /** Request paths received, in order. */
  hits: string[];
  close(): Promise<void>;
}

/**
 * Start a throwaway HTTP server on a free port. `host: "localhost"` gives a
 * second, distinct host name (cookies are per host, not per port); it listens
 * dual-stack so `localhost` works whether it resolves to 127.0.0.1 or ::1.
 */
export async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  host: "127.0.0.1" | "localhost" = "127.0.0.1",
): Promise<TestServer> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, host === "localhost" ? "::" : host, r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}`,
    hits,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body>${body}</body></html>`);
}

/**
 * Why browser tests can't run here, or false if they can. Recording needs a
 * Chromium plus Playwright's video encoder, which a machine may lack; the probe
 * never downloads anything (unlike `launchBrowser`). With `ffmpeg`, a full
 * render's ffmpeg on PATH is needed too.
 *
 * CI sets NARRATE_REQUIRE_BROWSER=1, so a broken browser setup there fails the
 * run instead of quietly skipping every browser test.
 */
export async function browserSkipReason(opts: { ffmpeg?: boolean } = {}): Promise<string | false> {
  const reason = await probeBrowser(opts);
  if (reason && process.env.NARRATE_REQUIRE_BROWSER === "1") {
    throw new Error(`NARRATE_REQUIRE_BROWSER=1, but browser tests can't run: ${reason}`);
  }
  return reason;
}

async function probeBrowser(opts: { ffmpeg?: boolean }): Promise<string | false> {
  if (opts.ffmpeg && spawnSync("ffmpeg", ["-version"]).status !== 0) {
    return "ffmpeg is not on PATH";
  }
  let chromium: Awaited<ReturnType<typeof loadChromium>>;
  try {
    chromium = await loadChromium();
  } catch {
    return "playwright is not installed";
  }
  const dir = mkdtempSync(join(tmpdir(), "narrate-probe-"));
  try {
    for (const channel of [undefined, "msedge", "chrome"]) {
      try {
        const browser = await chromium.launch({ channel, headless: true });
        try {
          const ctx = await browser.newContext({ recordVideo: { dir } });
          await ctx.newPage();
          await ctx.close();
          return false;
        } finally {
          await browser.close();
        }
      } catch {
        // try the next channel
      }
    }
    return "no browser that can record video is available";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function tempDir(prefix: string): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  // Retries: on Windows a just-closed browser can hold a video file for a moment.
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}
