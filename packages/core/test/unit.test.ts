import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRate, pcmToWav } from "../src/audio/wav.js";
import { MockProvider } from "../src/tts/mock.js";
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

test("ConfigSchema defaults to gemini/Kore", () => {
  const cfg = ConfigSchema.parse({});
  assert.equal(cfg.tts.provider, "gemini");
  assert.equal(cfg.tts.voice, "Kore");
  assert.equal(cfg.output.format, "mp4");
});
