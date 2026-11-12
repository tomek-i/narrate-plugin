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

/** Start a throwaway HTTP server on a free localhost port. */
export async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
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
 * Chromium plus Playwright's video encoder, which CI machines may lack; the
 * probe never downloads anything (unlike `launchBrowser`).
 */
export async function browserSkipReason(): Promise<string | false> {
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
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
