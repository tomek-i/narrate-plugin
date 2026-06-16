import type { Durations, Scene } from "../types.js";

export interface RecordResult {
  /** Path to the raw recorded video (webm). */
  videoPath: string;
  /** Milliseconds of recording before the first beat (to be trimmed off). */
  leadInMs: number;
}

export interface Recorder {
  /**
   * Record the scene continuously, holding each beat on screen for exactly its
   * narration duration so the concatenated audio lines up with no syncing.
   */
  record(scene: Scene, durations: Durations): Promise<RecordResult>;
}
