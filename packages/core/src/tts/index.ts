import { resolveApiKey } from "../config.js";
import type { Config } from "../types.js";
import { ElevenLabsProvider } from "./elevenlabs.js";
import { GeminiProvider } from "./gemini.js";
import { MockProvider } from "./mock.js";
import { OsTtsProvider } from "./os.js";
import type { TTSProvider } from "./provider.js";

export type { TTSProvider, SynthResult, SynthOptions } from "./provider.js";
export { GeminiProvider } from "./gemini.js";
export { ElevenLabsProvider } from "./elevenlabs.js";
export { OsTtsProvider } from "./os.js";
export { MockProvider } from "./mock.js";

export function makeProvider(config: Config): TTSProvider {
  const { provider, voice, model } = config.tts;
  switch (provider) {
    case "gemini":
      return new GeminiProvider(resolveApiKey(config), voice, model);
    case "elevenlabs":
      // "Kore" is the Gemini default and isn't a valid ElevenLabs voice id, so
      // fall back to the provider's own default rather than sending it.
      return new ElevenLabsProvider(
        resolveApiKey(config),
        voice === "Kore" ? undefined : voice,
        model,
      );
    case "os":
      return new OsTtsProvider();
    case "mock":
      return new MockProvider();
  }
}
