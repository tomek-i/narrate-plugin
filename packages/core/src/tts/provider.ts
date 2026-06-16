export interface SynthResult {
  audio: Buffer;
  /** File extension of the returned bytes (any ffmpeg-readable container); normalised to WAV downstream. */
  ext: string;
}

export interface SynthOptions {
  /** Per-beat voice override (provider-specific id/name). */
  voice?: string;
}

export interface TTSProvider {
  readonly name: string;
  synth(text: string, opts?: SynthOptions): Promise<SynthResult>;
}
