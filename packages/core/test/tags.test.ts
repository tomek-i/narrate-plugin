import assert from "node:assert/strict";
import { test } from "node:test";
import { ElevenLabsProvider } from "../src/tts/elevenlabs.js";
import { GeminiProvider } from "../src/tts/gemini.js";
import { MockProvider } from "../src/tts/mock.js";
import { OsTtsProvider } from "../src/tts/os.js";
import { stripVoiceTags } from "../src/tts/tags.js";
import { SceneSchema } from "../src/types.js";
import { sceneProblems } from "../src/validate.js";
import { buildVtt } from "../src/vtt.js";

test("stripVoiceTags removes [cues] and tidies the spacing", () => {
  assert.equal(stripVoiceTags("[excited] Welcome to Aurora!"), "Welcome to Aurora!");
  assert.equal(
    stripVoiceTags("It's fast [short pause] and it's free [laughs]."),
    "It's fast and it's free.",
  );
  assert.equal(stripVoiceTags("No tags here."), "No tags here.");
  // Not tags: numbers, empty brackets, very long bracketed text.
  assert.equal(stripVoiceTags("Item [1] of [ ]"), "Item [1] of [ ]");
  const long = `[${"a".repeat(41)}]`;
  assert.equal(stripVoiceTags(long), long);
  assert.equal(stripVoiceTags("[sighs]"), "");
});

test("keys, UI labels and links are not tags", () => {
  for (const text of [
    "Press [Enter] to submit.",
    "Hit [Ctrl] + [S] to save.",
    "Click [Save], then [Cancel].",
    "Choose option [A] or [B].",
    "[Beta] features are here.",
    "See [the docs](https://example.com) for more.",
  ]) {
    assert.equal(stripVoiceTags(text), text);
  }
});

test("tags in any script are recognised", () => {
  assert.equal(stripVoiceTags("[fröhlich] Willkommen!"), "Willkommen!");
  assert.equal(stripVoiceTags("[émue] Bonjour."), "Bonjour.");
  assert.equal(stripVoiceTags("[взволнованно] Привет!"), "Привет!");
});

test("text without tags is left exactly as written", () => {
  for (const text of ["Bonjour ! Ça va ?", "Ratio 3 : 1", "Wait ... there's more"]) {
    assert.equal(stripVoiceTags(text), text);
  }
  assert.equal(stripVoiceTags('"[excited] Go!"'), '"Go!"');
  assert.equal(stripVoiceTags("[a] [b] Hi"), "Hi");
});

test("only voices that act on tags receive them", () => {
  assert.equal(new GeminiProvider("k").voiceTags, true);
  assert.equal(new ElevenLabsProvider("k", "v", "eleven_v3").voiceTags, true);
  assert.equal(new ElevenLabsProvider("k").voiceTags, false, "multilingual_v2 reads them out");
  assert.ok(!new OsTtsProvider().voiceTags);
  assert.ok(!new MockProvider().voiceTags);
});

test("captions never show voice tags", () => {
  const vtt = buildVtt([{ id: "a", say: "[warmly] Hello there.", do: [] } as never], { a: 1 });
  assert.match(vtt, /\nHello there\.\n/);
  assert.doesNotMatch(vtt, /warmly/);
});

test("a beat with only voice tags has nothing to say", () => {
  const scene = SceneSchema.parse({
    site: "http://localhost:3000",
    beats: [
      { id: "a", say: "[excited] Hi." },
      { id: "b", say: "[pause]" },
    ],
  });
  assert.deepEqual(
    sceneProblems(scene).map((p) => p.path),
    ["beats[1].say"],
  );
  // An empty `say` (an action-only beat) is still allowed.
  const empty = SceneSchema.parse({
    site: "http://localhost:3000",
    beats: [{ id: "a", say: "" }],
  });
  assert.deepEqual(sceneProblems(empty), []);
});
