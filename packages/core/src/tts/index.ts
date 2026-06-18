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
  switch (config.tts.provider) {
    case "gemini": {
      const g = config.tts.gemini;
      return new GeminiProvider(resolveApiKey(config), g.voice, g.model);
    }
    case "elevenlabs": {
      const e = config.tts.elevenlabs;
      return new ElevenLabsProvider(resolveApiKey(config), e.voice, e.model);
    }
    case "os":
      return new OsTtsProvider();
    case "mock":
      return new MockProvider();
  }
}
