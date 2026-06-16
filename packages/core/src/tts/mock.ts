import { pcmToWav } from "../audio/wav.js";
import type { SynthResult, TTSProvider } from "./provider.js";

/**
 * Generates silent WAV sized to the text length — lets you exercise the full
 * pipeline (recording, timing, mux) without any API key.
 */
export class MockProvider implements TTSProvider {
  readonly name = "mock";
  private rate = 24000;

  async synth(text: string): Promise<SynthResult> {
    const words = text.trim().split(/\s+/).length;
    const seconds = Math.max(1.5, words * 0.38); // ~158 wpm
    const samples = Math.round(this.rate * seconds);
    const pcm = Buffer.alloc(samples * 2); // zeros = silence
    return { audio: pcmToWav(pcm, this.rate), ext: "wav" };
  }
}
