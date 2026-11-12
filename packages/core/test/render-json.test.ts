import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { audioProblem } from "../src/pipeline.js";
import { type TestServer, browserSkipReason, html, serve, tempDir } from "./helpers.js";

// `narrate render --json`: one JSON object on stdout, whatever happens. Runs the
// TypeScript source through tsx, the same way the tests themselves run.
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// Resolved here: the child runs in a temp dir, where `tsx` can't be found by name.
const tsx = import.meta.resolve("tsx");

const tmp = tempDir("narrate-render-json-");
// An empty settings home, so the developer's own keys and settings never leak in.
const home = join(tmp.dir, "home");
mkdirSync(home);

/** Run `render --json`; the result must be exactly one JSON line on stdout. */
async function runRender(...args: string[]) {
  return runRenderWith({}, ...args);
}

async function runRenderWith(extraEnv: NodeJS.ProcessEnv, ...args: string[]) {
  const { status, stdout, stderr } = await runCli(extraEnv, "--json", ...args);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1, `stdout must be exactly one line:\n${stdout}\nstderr:\n${stderr}`);
  return { status, out: JSON.parse(lines[0]), stderr };
}

/** Run the CLI asynchronously: the test server lives in this process and must keep answering. */
async function runCli(extraEnv: NodeJS.ProcessEnv, ...args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/API_KEY/i.test(k)),
  ) as NodeJS.ProcessEnv;
  const child = spawn(process.execPath, ["--import", tsx, cli, "render", ...args], {
    cwd: tmp.dir,
    env: { ...env, NARRATE_HOME: home, ...extraEnv },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d;
  });
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const [status] = (await once(child, "close")) as [number | null];
  return { status, stdout, stderr };
}

function sceneFile(name: string, scene: unknown): string {
  const p = join(tmp.dir, name);
  writeFileSync(p, JSON.stringify(scene));
  return p;
}

const unreachable = (name: string) => ({
  name,
  site: "http://127.0.0.1:1",
  beats: [{ id: "intro", say: "Hello there." }],
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("render --json", () => {
  let site: TestServer;
  let browserSkip: string | false = "not probed";
  before(async () => {
    site = await serve((_req, res) => html(res, "<h1>Hello</h1>"));
    browserSkip = hasFfmpeg ? await browserSkipReason() : "ffmpeg is not on PATH";
  });
  after(async () => {
    await site.close();
    tmp.cleanup();
  });

  test("an invalid scene fails at stage validate, writing no log", async () => {
    const scene = sceneFile("dup.json", {
      site: "http://127.0.0.1:1",
      beats: [
        { id: "a", say: "x" },
        { id: "a", say: "y" },
      ],
    });
    const r = await runRender("--scene", scene, "--provider", "mock", "--out", "out-dup");
    assert.equal(r.status, 1);
    assert.equal(r.out.ok, false);
    assert.equal(r.out.stage, "validate");
    assert.match(r.out.error, /duplicate beat id/);
    assert.equal(r.out.log, null);
    assert.ok(!existsSync(join(tmp.dir, "out-dup")), "a rejected scene writes nothing");
  });

  test("a missing scene file is a validate failure too", async () => {
    const r = await runRender("--scene", "nope.json");
    assert.equal(r.status, 1);
    assert.deepEqual([r.out.ok, r.out.stage, r.out.log], [false, "validate", null]);
  });

  test("with --log, an error before the render starts is still logged there", async () => {
    const scene = sceneFile("cfg.json", unreachable("cfg"));
    const r = await runRender("--scene", scene, "--config", "nope.json", "--log", "logs/cfg.log");
    assert.equal(r.status, 1);
    assert.equal(r.out.stage, "validate");
    assert.equal(r.out.log, join(tmp.dir, "logs", "cfg.log"));
    assert.match(readFileSync(r.out.log, "utf8"), /nope\.json/);
  });

  test("a rejected scene with --log writes the log there", async () => {
    const scene = sceneFile("dup-log.json", {
      site: "http://127.0.0.1:1",
      beats: [
        { id: "a", say: "x" },
        { id: "a", say: "y" },
      ],
    });
    const r = await runRender("--scene", scene, "--provider", "mock", "--log", "logs/dup.log");
    assert.equal(r.out.stage, "validate");
    assert.equal(r.out.log, join(tmp.dir, "logs", "dup.log"));
    assert.match(readFileSync(r.out.log, "utf8"), /duplicate beat id/);
  });

  test("unknown scene keys are warned about on stderr and in the log, $schema is not", async () => {
    const scene = sceneFile("unknown-keys.json", {
      $schema: "https://example.com/scene.schema.json",
      site: "http://127.0.0.1:1",
      untrused: true,
      beats: [
        { id: "a", say: "x", focusLable: "Name" },
        // A duplicate id, so the render stops at validate without a browser.
        { id: "a", say: "y" },
      ],
    });
    const r = await runRender("--scene", scene, "--provider", "mock", "--log", "logs/unknown.log");
    assert.equal(r.out.stage, "validate");
    const log = readFileSync(r.out.log, "utf8");
    for (const out of [r.stderr, log]) {
      assert.match(out, /Unknown scene key untrused \(ignored\)/);
      assert.match(out, /Unknown scene key beats\[0\]\.focusLable \(ignored\)/);
      assert.doesNotMatch(out, /\$schema/);
    }
  });

  test("without ffmpeg on PATH the failure is stage setup", async () => {
    const scene = sceneFile("setup.json", unreachable("setup"));
    const r = await runRenderWith(
      { PATH: "", Path: "" },
      "--scene",
      scene,
      "--provider",
      "mock",
      "--out",
      "out-setup",
    );
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.out.stage, "setup");
    assert.match(r.out.error, /ffmpeg/);
  });

  test("without --json a failure is printed once and exits 1", async () => {
    const scene = sceneFile("tts-text.json", unreachable("tts-text"));
    const r = await runCli({}, "--scene", scene, "--provider", "gemini", "--out", "out-text");
    assert.equal(r.status, 1);
    const all = r.stdout + r.stderr;
    assert.equal(all.split("No Gemini key").length - 1, 1, all);
  });

  test("a TTS failure reports stage tts and writes the log to --log", async () => {
    const scene = sceneFile("tts.json", unreachable("tts"));
    const r = await runRender("--scene", scene, "--provider", "gemini", "--log", "logs/tts.log");
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.out.ok, false);
    assert.equal(r.out.stage, "tts");
    assert.match(r.out.error, /key/i);
    assert.equal(r.out.log, join(tmp.dir, "logs", "tts.log"));
    assert.ok(existsSync(r.out.log), "the log file must exist");
  });

  test("a site that can't be reached fails at stage record", async (t) => {
    if (browserSkip) return t.skip(browserSkip);
    const scene = sceneFile("record.json", unreachable("record"));
    const r = await runRender("--scene", scene, "--provider", "mock", "--out", "out-record");
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.out.stage, "record");
    assert.equal(r.out.log, join(tmp.dir, "out-record", "narrate.log"));
    assert.ok(existsSync(r.out.log));
  });

  test("a successful render reports absolute paths and the audio check", async (t) => {
    if (browserSkip) return t.skip(browserSkip);
    const scene = sceneFile("ok.json", {
      name: "ok",
      site: site.url,
      beats: unreachable("").beats,
    });
    const r = await runRender("--scene", scene, "--provider", "mock", "--out", "out-ok");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out.ok, true);
    assert.ok(isAbsolute(r.out.video) && existsSync(r.out.video), r.out.video);
    assert.ok(existsSync(r.out.log), r.out.log);
    assert.ok(r.out.durationSec > 0);
    // Mock narration is silent by design, so it passes with silent: true.
    assert.equal(r.out.audio.present, true);
    assert.equal(r.out.audio.silent, true);
  });
});

test("audioProblem: no stream, silence and unmeasurable volume are problems", () => {
  assert.match(audioProblem(false, "-20.0 dB") ?? "", /NO audio stream/);
  assert.match(audioProblem(true, "-inf dB") ?? "", /silent/);
  assert.match(audioProblem(true, "-91.0 dB") ?? "", /silent/);
  assert.match(audioProblem(true, "-120.5 dB") ?? "", /silent/);
  assert.match(audioProblem(true, null) ?? "", /silent/);
  assert.equal(audioProblem(true, "-24.7 dB"), null);
});
