import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
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
      const result = await recorder.record(SceneSchema.parse(scene), { a: 0.5 });
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
    assert.deepEqual(warnings, []);
    assert.ok(app.hits.includes("/poll"), "the page should have polled");
    assert.ok(ms < 15000, `took ${ms}ms`);
  });

  test("the default (networkidle) still renders, with a warning instead of a failure", async () => {
    const { result, warnings } = await record(
      { site: app.url, beats: [{ id: "a", say: "x", do: [{ action: "reload" }] }] },
      { record: { navigationTimeoutMs: 1500 } },
    );
    assert.ok(result.videoPath);
    assert.equal(warnings.filter((w) => /never went idle/.test(w)).length, 2, warnings.join("\n"));
    assert.match(warnings[0], /Opening the site/);
    assert.match(warnings[1], /reload/);
  });
});
