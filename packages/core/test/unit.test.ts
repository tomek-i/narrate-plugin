import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRate, pcmToWav } from "../src/audio/wav.js";
import { hasApiKey, resolveApiKey } from "../src/config.js";
import { MockProvider } from "../src/tts/mock.js";
import { OsTtsProvider } from "../src/tts/os.js";
import { ConfigSchema, SceneSchema } from "../src/types.js";

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

test("a missing key reports not-configured and resolveApiKey throws", () => {
  // apiKeyEnv points at a var that isn't set, and no key is in the config.
  const cfg = ConfigSchema.parse({
    tts: { provider: "gemini", gemini: { apiKeyEnv: "NARRATE_UNSET_TEST_KEY" } },
  });
  assert.equal(hasApiKey(cfg), false);
  assert.throws(() => resolveApiKey(cfg), /Missing API key/);
});
