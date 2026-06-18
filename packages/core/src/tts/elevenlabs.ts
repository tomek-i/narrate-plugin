import type { SynthOptions, SynthResult, TTSProvider } from "./provider.js";

const DEFAULT_MODEL = "eleven_multilingual_v2";
// "Aria" — a current ElevenLabs default/premade voice (free-tier accessible via
// API; the legacy "Rachel" id is deprecated). Override via config.tts.elevenlabs.voice.
const DEFAULT_VOICE = "9BWtsMINqrJLrRacOk9x";

/** ElevenLabs text-to-speech (returns MP3). Bring your own API key. */
export class ElevenLabsProvider implements TTSProvider {
  readonly name = "elevenlabs";

  constructor(
    private key: string,
    private voice = DEFAULT_VOICE,
    private model = DEFAULT_MODEL,
  ) {}

  async synth(text: string, opts?: SynthOptions): Promise<SynthResult> {
    const voiceId = opts?.voice ?? this.voice;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: this.model }),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${await res.text()}`);
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, ext: "mp3" };
  }
}
