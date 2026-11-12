import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { OriginGuardError } from "../src/record/origin-guard.js";
import { PlaywrightRecorder } from "../src/record/playwright.js";
import { ConfigSchema, SceneSchema } from "../src/types.js";
import { type TestServer, browserSkipReason, html, serve, tempDir } from "./helpers.js";

// Browser-driven tests: they record for real, so they're skipped where no
// recording-capable browser is available.
const skip = await browserSkipReason();

describe("page-load wait", { skip }, () => {
  let app: TestServer;
  before(async () => {
    // A page that polls every 200 ms, so the network never goes idle.
    app = await serve((req, res) => {
      if (req.url === "/poll") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      html(res, `<h1>Live</h1><script>setInterval(() => fetch("/poll"), 200);</script>`);
    });
  });
  after(() => app.close());

  async function record(scene: object, config: object) {
    const out = tempDir("narrate-rec-");
    const warnings: string[] = [];
    try {
      const recorder = new PlaywrightRecorder(out.dir, ConfigSchema.parse(config), (m) =>
        warnings.push(m),
      );
      const started = Date.now();
      // A generous beat, so a slow machine doesn't add an "overran" warning.
      const result = await recorder.record(SceneSchema.parse(scene), { a: 3 });
      return { result, warnings, ms: Date.now() - started };
    } finally {
      out.cleanup();
    }
  }

  test('a polling app renders with waitUntil "load", with no warning', async () => {
    const { result, warnings, ms } = await record(
      {
        site: app.url,
        waitUntil: "load",
        beats: [{ id: "a", say: "x", do: [{ action: "reload" }] }],
      },
      {},
    );
    assert.ok(result.videoPath);
    assert.deepEqual(
      warnings.filter((w) => /never went idle/.test(w)),
      [],
    );
    assert.ok(app.hits.includes("/poll"), "the page should have polled");
    assert.ok(ms < 20000, `took ${ms}ms`);
  });

  test("the default (networkidle) still renders, with a warning instead of a failure", async () => {
    const { result, warnings } = await record(
      { site: app.url, beats: [{ id: "a", say: "x", do: [{ action: "reload" }] }] },
      { record: { navigationTimeoutMs: 1500 } },
    );
    assert.ok(result.videoPath);
    const idle = warnings.filter((w) => /never went idle/.test(w));
    assert.equal(idle.length, 2, warnings.join("\n"));
    assert.match(idle[0], /Opening the site/);
    assert.match(idle[1], /reload/);
  });

  test('config record.waitUntil "load" works, and a scene can override it', async () => {
    const viaConfig = await record(
      { site: app.url, beats: [{ id: "a", say: "x", do: [{ action: "reload" }] }] },
      { record: { waitUntil: "load", navigationTimeoutMs: 1500 } },
    );
    assert.deepEqual(
      viaConfig.warnings.filter((w) => /never went idle/.test(w)),
      [],
    );
    const overridden = await record(
      { site: app.url, waitUntil: "networkidle", beats: [{ id: "a", say: "x" }] },
      { record: { waitUntil: "load", navigationTimeoutMs: 1500 } },
    );
    assert.equal(overridden.warnings.filter((w) => /never went idle/.test(w)).length, 1);
  });
});

describe("same-origin guard", { skip }, () => {
  let app: TestServer;
  let other: TestServer;
  before(async () => {
    other = await serve((_req, res) => html(res, "<h1>Another site</h1>"));
    app = await serve((req, res) => {
      switch (req.url) {
        case "/":
          html(res, `<a id="out" href="${other.url}/">out</a><a id="in" href="/inside">in</a>`);
          return;
        case "/with-image":
          html(res, `<img src="${other.url}/pixel.png"><p>page</p>`);
          return;
        case "/redirect-out":
          res.writeHead(302, { location: `${other.url}/landing` });
          res.end();
          return;
        case "/inside":
          res.writeHead(302, { location: "/with-image" });
          res.end();
          return;
        case "/timed":
          html(
            res,
            `<script>setTimeout(() => { location.href = "${other.url}/"; }, 1500);</script>`,
          );
          return;
        default:
          html(res, "not found", 404);
      }
    });
  });
  after(async () => {
    await app.close();
    await other.close();
  });

  /** Record and return the outcome plus whatever is left in the out dir. */
  async function record(scene: object, beatSeconds = 0.5) {
    const out = tempDir("narrate-guard-");
    const warnings: string[] = [];
    try {
      const recorder = new PlaywrightRecorder(out.dir, ConfigSchema.parse({}), (m) =>
        warnings.push(m),
      );
      let error: unknown;
      try {
        await recorder.record(SceneSchema.parse(scene), { a: beatSeconds });
      } catch (err) {
        error = err;
      }
      const videoDir = join(out.dir, "video");
      const videos = existsSync(videoDir) ? readdirSync(videoDir) : [];
      return { error, warnings, videos };
    } finally {
      out.cleanup();
    }
  }

  const guarded = (path: string, steps: object[] = []) => ({
    site: `${app.url}${path}`,
    allowedOrigins: [app.url],
    beats: [{ id: "a", say: "x", do: steps }],
  });

  test("blocks requests to other origins without failing the render", async () => {
    other.hits.length = 0;
    const r = await record(guarded("/with-image"));
    assert.equal(r.error, undefined);
    assert.deepEqual(other.hits, []);
    assert.ok(
      r.warnings.some((w) => w.includes(`${other.url}/pixel.png`)),
      r.warnings.join("\n"),
    );
  });

  test("follows a redirect that stays on the site", async () => {
    const r = await record(guarded("/inside"));
    assert.equal(r.error, undefined);
    assert.equal(r.videos.length, 1);
  });

  for (const [name, path, steps, seconds] of [
    [
      "a server 3xx to another origin",
      "/",
      [{ action: "navigate", url: `PLACEHOLDER/redirect-out` }],
      0.5,
    ],
    ["a link click to another origin", "/", [{ action: "click", selector: "#out" }], 0.5],
    ["a timed client redirect during a beat", "/timed", [], 3],
  ] as const) {
    test(`${name} fails the render and leaves no video`, async () => {
      other.hits.length = 0;
      const resolved = steps.map((s) =>
        "url" in s ? { ...s, url: s.url.replace("PLACEHOLDER", app.url) } : s,
      );
      const r = await record(guarded(path, resolved), seconds);
      assert.ok(r.error instanceof OriginGuardError, String(r.error));
      assert.match((r.error as Error).message, /beat "a"/);
      assert.ok((r.error as OriginGuardError).blockedUrl.startsWith(other.url));
      assert.deepEqual(other.hits, [], "the other server must receive no request");
      assert.deepEqual(r.videos, [], "no recording may be left behind");
    });
  }

  test("without allowedOrigins, behaviour is unchanged", async () => {
    other.hits.length = 0;
    const r = await record({
      site: `${app.url}/`,
      beats: [{ id: "a", say: "x", do: [{ action: "click", selector: "#out" }] }],
    });
    assert.equal(r.error, undefined);
    assert.deepEqual(other.hits, ["/"]);
  });
});
