import { parseRate, pcmToWav } from "../audio/wav.js";
import type { SynthOptions, SynthResult, TTSProvider } from "./provider.js";

const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";

/** Google Gemini text-to-speech (returns 24kHz mono PCM, wrapped to WAV). */
export class GeminiProvider implements TTSProvider {
  readonly name = "gemini";
  readonly voiceTags = true;

  constructor(
    private key: string,
    private voice = "Kore",
    private model = DEFAULT_MODEL,
  ) {}

  async synth(text: string, opts?: SynthOptions): Promise<SynthResult> {
    const voice = opts?.voice ?? this.voice;
    // The key goes in a header, not the query string, so it never shows up in URLs that
    // proxies, request logs or error messages record.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.key },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as GeminiResponse;
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part?.inlineData) {
      throw new Error(`Gemini TTS: no audio in response: ${JSON.stringify(json).slice(0, 400)}`);
    }
    const pcm = Buffer.from(part.inlineData.data, "base64");
    const rate = parseRate(part.inlineData.mimeType);
    return { audio: pcmToWav(pcm, rate), ext: "wav" };
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data: string; mimeType?: string } }> };
  }>;
}
