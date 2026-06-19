import type { Beat, Durations } from "./types.js";

/** Format seconds as a WebVTT timestamp: `HH:MM:SS.mmm`. */
function timestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/**
 * Build a WebVTT caption track from the scene's beats and their *measured*
 * narration durations. Cues run back-to-back (each beat is held for exactly its
 * narration length), offset by `leadInSec` so they line up with the muxed audio,
 * which starts after the recorder's lead-in. The beat id becomes the cue id.
 */
export function buildVtt(beats: Beat[], durations: Durations, leadInSec = 0): string {
  const lines = ["WEBVTT", ""];
  let t = leadInSec;
  for (const beat of beats) {
    const start = t;
    const end = t + (durations[beat.id] ?? 0);
    t = end;
    lines.push(beat.id, `${timestamp(start)} --> ${timestamp(end)}`, beat.say.trim(), "");
  }
  return `${lines.join("\n")}\n`;
}
