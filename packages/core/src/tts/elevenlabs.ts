import type { SynthOptions, SynthResult, TTSProvider } from "./provider.js";

const DEFAULT_MODEL = "eleven_multilingual_v2";
// "Will" — a default voice confirmed usable on the free API tier. Override via
// config.tts.elevenlabs.voice; `narrate voices` lists what a key can use.
const DEFAULT_VOICE = "bIHbv24MWmeRgasZH58o";

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
    if (!res.ok) {
      const body = await res.text();
      // Free plans can't use *library* voices via the API (402) and some voices
      // need a paid tier (401/403). Point the user at a way to find a usable one.
      if (res.status === 402 || res.status === 401 || res.status === 403) {
        throw new Error(
          `ElevenLabs HTTP ${res.status} for voice "${voiceId}": ${body}\nOn the free plan only certain (premade) voices work via the API. Run \`narrate voices\` to list voices your key can use, then \`narrate set-voice <id>\` (or set tts.elevenlabs.voice). Or use \`--provider os\` for the keyless OS voice.`,
        );
      }
      throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${body}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    return { audio, ext: "mp3" };
  }
}
