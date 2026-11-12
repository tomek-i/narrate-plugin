import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseRate, pcmToWav } from "../src/audio/wav.js";
import {
  hasApiKey,
  loadConfigLayers,
  loadScene,
  mergeSettings,
  resolveApiKey,
  settingOrigin,
  settingsFilesChecked,
} from "../src/config.js";
import { interpolateEnv } from "../src/env.js";
import { render } from "../src/pipeline.js";
import { OriginGuard, originOf } from "../src/record/origin-guard.js";
import { maskKey } from "../src/secret.js";
import { MockProvider } from "../src/tts/mock.js";
import { OsTtsProvider } from "../src/tts/os.js";
import { ConfigSchema, SceneSchema } from "../src/types.js";
import { untrustedProblems } from "../src/validate.js";
import { buildVtt } from "../src/vtt.js";

test("pcmToWav writes a valid 44-byte WAV header", () => {
  const pcm = Buffer.alloc(100);
  const wav = pcmToWav(pcm, 24000);
  assert.equal(wav.length, 44 + 100);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 24000); // sample rate
  assert.equal(wav.readUInt32LE(40), 100); // data length
});

test("parseRate reads the rate from a mime, else falls back", () => {
  assert.equal(parseRate("audio/L16;codec=pcm;rate=16000"), 16000);
  assert.equal(parseRate(undefined), 24000);
  assert.equal(parseRate("audio/wav", 8000), 8000);
});

test("MockProvider returns silent WAV sized to the text", async () => {
  const p = new MockProvider();
  const short = await p.synth("one two");
  const long = await p.synth("one two three four five six seven eight nine ten");
  assert.equal(short.ext, "wav");
  assert.equal(short.audio.toString("ascii", 0, 4), "RIFF");
  assert.ok(long.audio.length > short.audio.length);
});

test("OsTtsProvider returns audio (real, or silent if no OS voice)", async () => {
  const res = await new OsTtsProvider().synth("Testing the operating system voice.");
  assert.ok(Buffer.isBuffer(res.audio) && res.audio.length > 0);
  assert.equal(typeof res.ext, "string");
});

test("SceneSchema applies defaults and requires at least one beat", () => {
  const scene = SceneSchema.parse({
    site: "http://localhost:3000",
    beats: [{ id: "a", say: "hi" }],
  });
  assert.equal(scene.name, "scene");
  assert.deepEqual(scene.viewport, { width: 1440, height: 900 });
  assert.deepEqual(scene.beats[0].do, []);
  assert.throws(() => SceneSchema.parse({ site: "x", beats: [] }));
});

test("SceneSchema accepts form-interaction steps with defaults", () => {
  const scene = SceneSchema.parse({
    site: "http://localhost:3000",
    beats: [
      {
        id: "signup",
        say: "We sign up.",
        do: [
          { action: "fill", selector: "#email", text: "a@b.com" },
          { action: "press", key: "Enter" },
          { action: "waitFor", selector: ".dashboard" },
        ],
      },
    ],
  });
  const steps = scene.beats[0].do;
  assert.equal(steps[0].action, "fill");
  assert.equal(steps[2].action, "waitFor");
  // waitFor defaults state to "visible".
  assert.equal(steps[2].action === "waitFor" && steps[2].state, "visible");
});

test("ConfigSchema defaults to the keyless OS voice with nested provider blocks", () => {
  const cfg = ConfigSchema.parse({});
  // Default to a no-key provider so a fresh install works out of the box.
  assert.equal(cfg.tts.provider, "os");
  // Per-provider settings are nested, each with its own voice/model.
  assert.equal(cfg.tts.gemini.voice, "Kore");
  assert.equal(cfg.tts.elevenlabs.model, "eleven_multilingual_v2");
  assert.equal(cfg.output.format, "mp4");
});

test("interpolateEnv substitutes set vars, escapes $${}, and throws on missing", () => {
  const env = { USER_NAME: "ada", PASS: "s3cret" };
  assert.equal(interpolateEnv("${USER_NAME} / ${PASS}", env), "ada / s3cret");
  // `$${...}` is an escape for a literal `${...}` (no lookup).
  assert.equal(interpolateEnv("price is $${TOTAL}", env), "price is ${TOTAL}");
  // A referenced-but-unset var fails loudly rather than typing a literal placeholder.
  assert.throws(() => interpolateEnv("${MISSING}", env), /not set/);
  // Plain text is untouched.
  assert.equal(interpolateEnv("just text", env), "just text");
});

test("buildVtt emits lead-in-offset, back-to-back cues per beat", () => {
  const beats = [
    { id: "intro", say: " Hello there. ", do: [] },
    { id: "next", say: "Now the dashboard.", do: [] },
  ];
  const vtt = buildVtt(beats, { intro: 2, next: 3 }, 1);
  assert.ok(vtt.startsWith("WEBVTT\n"));
  // Cues are offset by the 1s lead-in and run consecutively (1→3, 3→6).
  assert.match(vtt, /intro\n00:00:01\.000 --> 00:00:03\.000\nHello there\./);
  assert.match(vtt, /next\n00:00:03\.000 --> 00:00:06\.000\nNow the dashboard\./);
});

test("os/mock providers need no key; resolveApiKey returns empty", () => {
  for (const provider of ["os", "mock"] as const) {
    const cfg = ConfigSchema.parse({ tts: { provider } });
    assert.equal(hasApiKey(cfg), true);
    assert.equal(resolveApiKey(cfg), "");
  }
});

test("a nested provider key is used and beats the env fallback", () => {
  const cfg = ConfigSchema.parse({
    tts: { provider: "gemini", gemini: { key: "file-key" } },
  });
  assert.equal(hasApiKey(cfg), true);
  assert.equal(resolveApiKey(cfg), "file-key");
});

test("a partial tts block still gets every provider block's defaults", () => {
  const cfg = ConfigSchema.parse({ tts: { provider: "gemini" } });
  assert.equal(cfg.tts.gemini.voice, "Kore");
  assert.equal(cfg.tts.elevenlabs.voice, "bIHbv24MWmeRgasZH58o");
});

test("mergeSettings deep-merges objects and replaces scalars/arrays", () => {
  const merged = mergeSettings(
    { tts: { provider: "gemini", gemini: { key: "g", voice: "Kore" } }, list: [1, 2] },
    { tts: { gemini: { voice: "Puck" } }, list: [3] },
  );
  assert.deepEqual(merged, {
    tts: { provider: "gemini", gemini: { key: "g", voice: "Puck" } },
    list: [3],
  });
});

test("loadConfigLayers layers project settings over global without default clobbering", () => {
  const root = mkdtempSync(join(tmpdir(), "narrate-cfg-"));
  try {
    const globalPath = join(root, "home", "settings.json");
    mkdirSync(dirname(globalPath), { recursive: true });
    writeFileSync(
      globalPath,
      JSON.stringify({
        tts: { provider: "elevenlabs", elevenlabs: { key: "global-key", voice: "g-voice" } },
        output: { crf: 14 },
      }),
    );
    const cwd = join(root, "proj");
    mkdirSync(join(cwd, ".narrate"), { recursive: true });

    // No project file → global applies as-is.
    let { config, layers } = loadConfigLayers(cwd, undefined, globalPath);
    assert.equal(config.tts.provider, "elevenlabs");
    assert.equal(config.tts.elevenlabs.key, "global-key");
    assert.deepEqual(
      layers.map((l) => l.scope),
      ["global"],
    );

    // Project overrides only the voice; everything else still comes from global.
    writeFileSync(
      join(cwd, ".narrate", "settings.local.json"),
      JSON.stringify({ $schema: "x", tts: { elevenlabs: { voice: "p-voice" } } }),
    );
    ({ config, layers } = loadConfigLayers(cwd, undefined, globalPath));
    assert.equal(config.tts.provider, "elevenlabs");
    assert.equal(config.tts.elevenlabs.key, "global-key");
    assert.equal(config.tts.elevenlabs.voice, "p-voice");
    assert.equal(config.output.crf, 14);
    assert.equal(config.output.format, "mp4"); // untouched → schema default
    assert.equal(settingOrigin(layers, "tts.elevenlabs.voice"), "project");
    assert.equal(settingOrigin(layers, "tts.provider"), "global");
    assert.equal(settingOrigin(layers, "output.fps"), "default");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing key reports not-configured and resolveApiKey throws", () => {
  // apiKeyEnv points at a var that isn't set, and no key is in the config.
  const cfg = ConfigSchema.parse({
    tts: { provider: "gemini", gemini: { apiKeyEnv: "NARRATE_UNSET_TEST_KEY" } },
  });
  assert.equal(hasApiKey(cfg), false);
  assert.throws(() => resolveApiKey(cfg), /No Gemini key/);
});

test("a missing key error names every place that was checked", () => {
  const root = mkdtempSync(join(tmpdir(), "narrate-key-"));
  try {
    const globalPath = join(root, "home", "settings.json");
    mkdirSync(dirname(globalPath), { recursive: true });
    writeFileSync(globalPath, JSON.stringify({ tts: { provider: "elevenlabs" } }));
    const cwd = join(root, "proj");
    const files = settingsFilesChecked(cwd, undefined, globalPath);
    assert.deepEqual(files, [globalPath, join(cwd, ".narrate", "settings.local.json")]);

    const cfg = ConfigSchema.parse({
      tts: { provider: "elevenlabs", elevenlabs: { apiKeyEnv: "NARRATE_UNSET_TEST_KEY" } },
    });
    assert.throws(
      () => resolveApiKey(cfg, files),
      (err: Error) => {
        assert.match(err.message, /^No ElevenLabs key: checked /);
        assert.ok(err.message.includes(`${globalPath} (no tts.elevenlabs.key)`), err.message);
        assert.ok(err.message.includes(`${files[1]} (not found)`), err.message);
        assert.ok(err.message.includes("$NARRATE_UNSET_TEST_KEY (not set)"), err.message);
        return true;
      },
    );

    // A blank key in a file is reported as such (it hides keys in earlier files),
    // and a variable that is set but blank is "empty", not "not set".
    mkdirSync(dirname(files[1]), { recursive: true });
    writeFileSync(files[1], JSON.stringify({ tts: { elevenlabs: { key: " " } } }));
    process.env.NARRATE_UNSET_TEST_KEY = "";
    try {
      assert.throws(
        () => resolveApiKey(cfg, files),
        (err: Error) =>
          err.message.includes(`${files[1]} (tts.elevenlabs.key is empty)`) &&
          err.message.includes("$NARRATE_UNSET_TEST_KEY (empty)"),
      );
    } finally {
      Reflect.deleteProperty(process.env, "NARRATE_UNSET_TEST_KEY");
    }

    // --config pointing at the global file lists it once.
    assert.deepEqual(settingsFilesChecked(cwd, globalPath, globalPath), [globalPath]);

    // An explicit --config path is reported instead of the default project file.
    assert.deepEqual(settingsFilesChecked(cwd, "custom.json", globalPath), [
      globalPath,
      join(cwd, "custom.json"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the origin guard compares origins, treats local files as one, and allows inline schemes", () => {
  assert.equal(originOf("http://localhost:3000/a/b?c"), "http://localhost:3000");
  assert.equal(originOf("file:///C:/x/index.html"), "file://");
  const guard = new OriginGuard(["http://localhost:3000/start"]);
  assert.ok(guard.allows("http://localhost:3000/other"));
  assert.ok(!guard.allows("http://localhost:3001/"));
  assert.ok(!guard.allows("https://localhost:3000/"));
  assert.ok(guard.allows("about:blank"));
  assert.ok(guard.allows("data:text/plain,hi"));
  assert.ok(!guard.allows("not a url"));
  assert.throws(
    () =>
      SceneSchema.parse({
        site: "x",
        allowedOrigins: ["localhost"],
        beats: [{ id: "a", say: "" }],
      }),
    /absolute URL/,
  );
});

test("maskKey shows only the prefix and last four characters", () => {
  assert.equal(maskKey("sk_aaaaaaaaaaaaaaaaaaaad286"), "sk_…d286");
  assert.equal(maskKey("short"), "…");
});

const unsafeScene = (steps: object[], extra: object = {}) =>
  SceneSchema.parse({
    site: "http://localhost:3000/app",
    ...extra,
    beats: [{ id: "intro", say: "x", do: steps }],
  });

test("untrusted mode rejects eval, uploadFile and off-origin navigate, naming beat and step", () => {
  const problems = untrustedProblems(
    unsafeScene([
      { action: "eval", fn: "1" },
      { action: "uploadFile", selector: "input", files: ["/etc/passwd"] },
      { action: "navigate", url: "https://evil.example/" },
      { action: "navigate", url: "/settings" }, // relative → same origin, fine
      { action: "navigate", url: "http://localhost:3000/x" },
      { action: "click", selector: "a" },
    ]),
  );
  assert.deepEqual(
    problems.map((p) => p.path),
    ["beats[0].do[0]", "beats[0].do[1]", "beats[0].do[2].url"],
  );
  assert.match(problems[0].message, /beat "intro" step 1: eval/);
  assert.match(problems[2].message, /https:\/\/evil\.example\//);
  // The caller's allowed origins widen what navigate may reach; the scene's own don't.
  const toDocs = unsafeScene([{ action: "navigate", url: "https://docs.example/a" }], {
    allowedOrigins: ["https://docs.example"],
  });
  assert.deepEqual(
    untrustedProblems(toDocs).map((p) => p.path),
    ["beats[0].do[0].url"],
  );
  assert.deepEqual(untrustedProblems(toDocs, { allowedOrigins: ["https://docs.example"] }), []);
});

test("untrusted mode requires an http(s) site, rejects file: navigates and unsafe names", () => {
  const scene = SceneSchema.parse({
    name: "../../Videos/important",
    site: "file:///C:/Users/me/.ssh/id_rsa",
    beats: [
      { id: "../../x", say: "x", do: [{ action: "navigate", url: "file:///etc/passwd" }] },
      { id: "ok_id-1.2", say: "y" },
    ],
  });
  assert.deepEqual(
    untrustedProblems(scene).map((p) => p.path),
    ["site", "name", "beats[0].id", "beats[0].do[0].url"],
  );
});

test(
  "the Windows OS voice treats the voice name as data, never as PowerShell code",
  {
    skip: process.platform !== "win32" && "Windows only",
  },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "narrate-voice-"));
    try {
      const marker = join(dir, "pwned.txt");
      // PowerShell treats curly quotes as single quotes, so this closes the old
      // quoted string; the path is curly-quoted too, which ASCII-quote escaping misses.
      const voice = `x’);Set-Content -Path ‘${marker}’ -Value 1;#`;
      const res = await new OsTtsProvider().synth("Hello.", { voice });
      assert.ok(res.audio.length > 0);
      assert.ok(!existsSync(marker), "the voice name ran as code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("the OS voice removes its scratch folder even when the voice fails", async () => {
  // A private temp folder, so nothing else on the machine can add to what we check.
  const temp = mkdtempSync(join(tmpdir(), "narrate-scratch-test-"));
  // No PowerShell, `say` or espeak can be found, so synthesis fails (and falls back to silence).
  const saved = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  process.env.PATH = "";
  process.env.Path = "";
  process.env.SystemRoot = join(temp, "no-windows-here");
  process.env.TMPDIR = temp;
  process.env.TEMP = temp;
  process.env.TMP = temp;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const res = await new OsTtsProvider().synth("Hello.");
    assert.ok(res.audio.length > 0, "falls back to silent audio");
  } finally {
    console.warn = warn;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = v;
    }
  }
  try {
    assert.deepEqual(readdirSync(temp), [], "scratch folders left in the temp dir");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("render in untrusted mode rejects a scene before any work, from the flag or the scene", async () => {
  const root = mkdtempSync(join(tmpdir(), "narrate-untrusted-"));
  try {
    const config = ConfigSchema.parse({ tts: { provider: "mock" }, output: { dir: "out" } });
    const scene = unsafeScene([{ action: "eval", fn: "1" }]);
    await assert.rejects(render(scene, config, { cwd: root, untrusted: true }), (err: Error) => {
      assert.match(err.message, /Scene rejected \(untrusted mode\)/);
      assert.match(err.message, /beats\[0\]\.do\[0\]: beat "intro" step 1: eval/);
      return true;
    });
    await assert.rejects(
      render({ ...scene, untrusted: true }, config, { cwd: root }),
      /Scene rejected/,
    );
    assert.ok(!existsSync(join(root, "out")), "nothing may be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("render rejects duplicate beat ids before any TTS, in normal mode too", async () => {
  const root = mkdtempSync(join(tmpdir(), "narrate-dup-"));
  try {
    const config = ConfigSchema.parse({ tts: { provider: "mock" }, output: { dir: "out" } });
    const scene = SceneSchema.parse({
      site: "http://localhost:3000",
      beats: [
        { id: "a", say: "x" },
        { id: "a", say: "y" },
      ],
    });
    await assert.rejects(
      render(scene, config, { cwd: root }),
      /Scene rejected:\n {2}beats\[1\]\.id/,
    );
    assert.ok(!existsSync(join(root, "out")), "nothing may be written");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadScene reports each schema problem with its path", () => {
  const root = mkdtempSync(join(tmpdir(), "narrate-scene-"));
  try {
    const file = join(root, "s.json");
    writeFileSync(
      file,
      JSON.stringify({
        site: "x",
        beats: [{ id: "a", say: "x", do: [{ action: "wait", ms: -1 }] }],
      }),
    );
    assert.throws(
      () => loadScene(root, file),
      /Invalid scene .*s\.json:\n {2}beats\[0\]\.do\[0\]\.ms: /,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
