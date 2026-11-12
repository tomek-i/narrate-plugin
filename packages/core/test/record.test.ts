import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
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
  const fileDir = tempDir("narrate-file-site-");
  const dashCookies: string[] = [];
  const methods307: string[] = [];
  const secondCookies: string[] = [];
  let second: TestServer;
  before(async () => {
    other = await serve((_req, res) => html(res, "<h1>Another site</h1>"));
    // A second *allowed* origin on another host name, so the browser's own
    // cookie jar wouldn't send it the site's cookies.
    second = await serve((req, res) => {
      secondCookies.push(req.headers.cookie ?? "");
      html(res, "<h1>second</h1>");
    }, "localhost");
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
        case "/hop1":
          res.writeHead(302, { location: "/hop2" });
          res.end();
          return;
        case "/hop2":
          res.writeHead(302, { location: `${other.url}/chain` });
          res.end();
          return;
        case "/login":
          html(res, `<form method="post" action="/do-login"><button id="go">go</button></form>`);
          return;
        case "/do-login":
          res.writeHead(303, { location: "/dash", "set-cookie": "session=s1; Path=/" });
          res.end();
          return;
        case "/dash":
          dashCookies.push(req.headers.cookie ?? "");
          html(res, "<h1>dashboard</h1>");
          return;
        case "/post307":
          html(
            res,
            `<form method="post" action="/p307"><input name="n" value="1"><button id="go307">go</button></form>`,
          );
          return;
        case "/p307":
          res.writeHead(307, { location: "/p307b" });
          res.end();
          return;
        case "/p307b":
          methods307.push(req.method ?? "");
          html(res, "<h1>posted</h1>");
          return;
        case "/cookie-home":
          res.writeHead(200, { "content-type": "text/html", "set-cookie": "sid=A; Path=/" });
          res.end("<h1>home</h1>");
          return;
        case "/to-second":
          res.writeHead(302, { location: `${second.url}/landing` });
          res.end();
          return;
        case "/refused":
          req.socket.destroy();
          return;
        case "/popup":
          html(res, `<a id="pop" target="_blank" href="${other.url}/popped">pop</a>`);
          return;
        case "/inside":
          res.writeHead(302, { location: "/with-image" });
          res.end();
          return;
        case "/timed":
          html(
            res,
            `<script>setTimeout(() => { location.href = "${other.url}/"; }, 2500);</script>`,
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
    await second.close();
    fileDir.cleanup();
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
    other.hits.length = 0;
    const r = await record(guarded("/inside"));
    assert.equal(r.error, undefined);
    assert.equal(r.videos.length, 1);
    assert.deepEqual(other.hits, []);
  });

  test("a form POST that redirects keeps its cookie and lands on the page", async () => {
    const r = await record(guarded("/login", [{ action: "click", selector: "#go" }]));
    assert.equal(r.error, undefined, String(r.error));
    assert.ok(dashCookies.length > 0, "the dashboard was never loaded");
    assert.ok(
      dashCookies.every((c) => c.includes("session=s1")),
      dashCookies.join(" | "),
    );
  });

  test("a 307 keeps the POST through the guard", async () => {
    const r = await record(guarded("/post307", [{ action: "click", selector: "#go307" }]));
    assert.equal(r.error, undefined, String(r.error));
    assert.ok(methods307.length > 0, "the 307 target was never reached");
    assert.ok(
      methods307.every((m) => m === "POST"),
      methods307.join(),
    );
  });

  test("redirect hops to another allowed origin don't carry the site's cookies", async () => {
    secondCookies.length = 0;
    const r = await record({
      site: `${app.url}/cookie-home`,
      allowedOrigins: [second.url],
      beats: [{ id: "a", say: "x", do: [{ action: "navigate", url: `${app.url}/to-second` }] }],
    });
    assert.equal(r.error, undefined, String(r.error));
    assert.ok(secondCookies.length > 0, "the second origin was never reached");
    assert.ok(
      secondCookies.every((c) => !c.includes("sid=A")),
      secondCookies.join(" | "),
    );
  });

  test("a network error on an allowed URL is reported as such, not as leaving the site", async () => {
    const r = await record(guarded("/", [{ action: "navigate", url: `${app.url}/refused` }]));
    assert.ok(r.error instanceof Error, "the render should fail");
    assert.ok(!(r.error instanceof OriginGuardError), String(r.error));
    assert.ok(
      r.warnings.every((w) => !/cookie/i.test(w)),
      r.warnings.join("\n"),
    );
  });

  test("a popup to another origin is blocked and doesn't crash the render", async () => {
    other.hits.length = 0;
    const r = await record(guarded("/popup", [{ action: "click", selector: "#pop" }]));
    assert.equal(r.error, undefined, String(r.error));
    assert.deepEqual(other.hits, []);
  });

  test("works for a local file site", async () => {
    const file = join(fileDir.dir, "page.html");
    writeFileSync(file, "<h1>local</h1>");
    const r = await record({
      site: pathToFileURL(file).href,
      allowedOrigins: [],
      beats: [{ id: "a", say: "x" }],
    });
    assert.equal(r.error, undefined, String(r.error));
  });

  for (const [name, path, steps, seconds] of [
    [
      "a server 3xx to another origin",
      "/",
      [{ action: "navigate", url: "PLACEHOLDER/redirect-out" }],
      0.5,
    ],
    ["a link click to another origin", "/", [{ action: "click", selector: "#out" }], 0.5],
    [
      "a two-hop redirect that ends on another origin",
      "/",
      [{ action: "navigate", url: "PLACEHOLDER/hop1" }],
      0.5,
    ],
    ["a timed client redirect during a beat", "/timed", [], 5],
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
