import { stripVoiceTags } from "./tts/tags.js";
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
 * narration durations. Each beat occupies its `durations` slot (speech plus the
 * pause after it), offset by `leadInSec` so cues line up with the muxed audio,
 * which starts after the recorder's lead-in. With `spoken`, a cue ends when the
 * speech ends rather than at the end of the pause. The beat id becomes the cue
 * id; voice tags such as `[excited]` are left out of the caption text.
 */
export function buildVtt(
  beats: Beat[],
  durations: Durations,
  leadInSec = 0,
  spoken?: Durations,
): string {
  const lines = ["WEBVTT", ""];
  let t = leadInSec;
  for (const beat of beats) {
    const start = t;
    const slot = durations[beat.id] ?? 0;
    t = start + slot;
    const end = start + Math.min(slot, spoken?.[beat.id] ?? slot);
    lines.push(beat.id, `${timestamp(start)} --> ${timestamp(end)}`, stripVoiceTags(beat.say), "");
  }
  return `${lines.join("\n")}\n`;
}
