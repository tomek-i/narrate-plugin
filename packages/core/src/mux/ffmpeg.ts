import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const fwd = (p: string) => p.replace(/\\/g, "/");

/** Duration of a media file in seconds (requires ffprobe on PATH). */
export function probeDuration(file: string): number {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]).toString();
  return Number(out.trim());
}

/** Re-encode any audio to a uniform WAV (48kHz stereo) so clips concat cleanly. */
export function normalizeToWav(input: string, output: string): void {
  execFileSync("ffmpeg", ["-y", "-i", input, "-ar", "48000", "-ac", "2", output], {
    stdio: "ignore",
  });
}

/** Concatenate same-format WAVs into one track. */
export function concatWavs(files: string[], output: string, listPath: string): void {
  writeFileSync(listPath, files.map((f) => `file '${fwd(f)}'`).join("\n"));
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output],
    { stdio: "ignore" },
  );
}

/**
 * Trim the lead-in from the front of the recording and overlay the narration.
 * Audio is shorter than the (paced) video, so -shortest clips the tail.
 */
export function muxNarration(opts: {
  video: string;
  audio: string;
  leadInSec: number;
  fps: number;
  format: "mp4" | "webm";
  output: string;
}): void {
  const { video, audio, leadInSec, fps, format, output } = opts;
  const vcodec =
    format === "webm"
      ? ["libvpx-vp9", "-b:v", "0", "-crf", "30"]
      : ["libx264", "-preset", "medium", "-crf", "20"];
  const acodec = format === "webm" ? ["libopus"] : ["aac", "-b:a", "192k"];
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-ss",
      leadInSec.toFixed(3),
      "-i",
      video,
      "-i",
      audio,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-vf",
      `fps=${fps},format=yuv420p`,
      "-c:v",
      ...vcodec,
      "-c:a",
      ...acodec,
      "-shortest",
      output,
    ],
    { stdio: "inherit" },
  );
}
