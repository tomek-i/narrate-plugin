import assert from "node:assert/strict";
import { test } from "node:test";
import { GeminiProvider } from "../src/tts/gemini.js";

test("Gemini sends the API key in a header, never in the URL", async () => {
  const key = "AIza-test-key-123";
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const pcm = Buffer.alloc(480).toString("base64");
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ inlineData: { data: pcm, mimeType: "audio/L16;rate=24000" } }] } },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const res = await new GeminiProvider(key).synth("Hello.");
    assert.equal(res.ext, "wav");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes(key), `key leaked into the URL: ${calls[0].url}`);
  assert.ok(!calls[0].url.includes("key="), `URL still has a key parameter: ${calls[0].url}`);
  assert.equal(calls[0].headers["x-goog-api-key"], key);
});
