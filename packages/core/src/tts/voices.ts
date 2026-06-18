import { resolveApiKey } from "../config.js";
import type { Config } from "../types.js";

export interface VoiceInfo {
  id: string;
  name: string;
  /** ElevenLabs category: premade | cloned | generated | professional. */
  category?: string;
}

export interface VoiceList {
  provider: string;
  voices: VoiceInfo[];
  note?: string;
}

/**
 * List the TTS voices available to the configured provider/key. For ElevenLabs
 * this hits `GET /v1/voices`, which returns exactly the voices the account can
 * use — the reliable way to pick a voice that won't 402 on the free tier.
 */
export async function listVoices(config: Config): Promise<VoiceList> {
  const provider = config.tts.provider;
  if (provider === "elevenlabs") {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": resolveApiKey(config) },
    });
    if (!res.ok) throw new Error(`ElevenLabs voices HTTP ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      voices?: Array<{ voice_id: string; name: string; category?: string }>;
    };
    const voices = (json.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
    return {
      provider,
      voices,
      note: "Voices your key can use. 'premade' voices are the safe choice on the free tier.",
    };
  }
  if (provider === "gemini") {
    return {
      provider,
      voices: [],
      note: "Gemini uses named prebuilt voices (e.g. Kore, Puck, Charon, Aoede, Fenrir, Leda). See https://ai.google.dev/gemini-api/docs/speech-generation",
    };
  }
  return {
    provider,
    voices: [],
    note: `Provider "${provider}" needs no voice list — set tts.provider to gemini or elevenlabs first.`,
  };
}
