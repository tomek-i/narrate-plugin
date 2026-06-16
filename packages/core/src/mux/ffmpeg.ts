import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const fwd = (p: string) => p.replace(/\\/g, "/");

/** Per-OS hint for installing ffmpeg, shown when the preflight check fails. */
function ffmpegInstallHint(): string {
  switch (process.platform) {
    case "win32":
      return "Install it with `winget install Gyan.FFmpeg` (or `choco install ffmpeg`).";
    case "darwin":
      return "Install it with `brew install ffmpeg`.";
    default:
      return "Install it with your package manager, e.g. `sudo apt install ffmpeg`.";
  }
}

/** Verify ffmpeg + ffprobe are on PATH before a render; throw a friendly error if not. */
export function ensureFfmpeg(): void {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    try {
      execFileSync(bin, ["-version"], { stdio: "ignore" });
    } catch {
      throw new Error(`"${bin}" was not found on your PATH. ${ffmpegInstallHint()}`);
    }
  }
}

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
 *
 * The video is trimmed with a `trim`+`setpts` filter (not an input `-ss` seek):
 * browser `recordVideo` webms (Chromium, and especially Edge/Chrome channels)
 * have irregular start timestamps, and an input seek combined with `-shortest`
 * could drop the muxed audio entirely. Trimming via filter rebases the video to
 * PTS 0 so it aligns with the narration (input 1) regardless of the source.
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
  const trim = `[0:v]trim=start=${leadInSec.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[v]`;
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      video,
      "-i",
      audio,
      "-filter_complex",
      trim,
      "-map",
      "[v]",
      "-map",
      "1:a",
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
