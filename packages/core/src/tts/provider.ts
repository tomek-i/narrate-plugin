export interface SynthResult {
  audio: Buffer;
  /** Container of the returned bytes; normalised to WAV downstream. */
  ext: "wav" | "mp3";
}

export interface SynthOptions {
  /** Per-beat voice override (provider-specific id/name). */
  voice?: string;
}

export interface TTSProvider {
  readonly name: string;
  synth(text: string, opts?: SynthOptions): Promise<SynthResult>;
}
