import { execFileSync, spawnSync } from "node:child_process";
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

/**
 * Re-encode raw provider audio bytes to a uniform WAV (48kHz stereo) so clips
 * concat cleanly. Reads from stdin so no raw intermediate file is needed;
 * ffmpeg detects the input container (wav/mp3/aiff/…) from the byte stream.
 */
export function normalizeToWav(input: Buffer, output: string): void {
  execFileSync("ffmpeg", ["-y", "-i", "pipe:0", "-ar", "48000", "-ac", "2", output], {
    input,
    stdio: ["pipe", "ignore", "ignore"],
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
 * Both streams are routed through the filtergraph and mapped by label — the
 * video is trimmed + rebased to PTS 0, and the audio is re-timed with
 * `aresample`. Browser `recordVideo` webms (Chromium, and especially the
 * Edge/Chrome channels) have irregular start timestamps; direct-mapping the
 * audio alongside a filtered video drops it on those recordings. Mapping the
 * audio through the graph (the approach that works in the reference POC) keeps
 * it. Verify afterwards with `hasAudioStream`.
 */
export function muxNarration(opts: {
  video: string;
  audio: string;
  leadInSec: number;
  fps: number;
  format: "mp4" | "webm";
  output: string;
}): { command: string; stderr: string } {
  const { video, audio, leadInSec, fps, format, output } = opts;
  const vcodec =
    format === "webm"
      ? ["libvpx-vp9", "-b:v", "0", "-crf", "30"]
      : ["libx264", "-preset", "medium", "-crf", "20"];
  const acodec = format === "webm" ? ["libopus"] : ["aac", "-b:a", "192k"];
  const filter = [
    `[0:v]trim=start=${leadInSec.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},format=yuv420p[v]`,
    "[1:a]aresample=async=1:first_pts=0[a]",
  ].join(";");
  const args = [
    "-y",
    "-i",
    video,
    "-i",
    audio,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    ...vcodec,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    ...acodec,
    "-shortest",
    // Move the moov atom to the front so streaming/preview players (browsers,
    // IDE preview panes) play audio+video immediately instead of dropping audio.
    ...(format === "mp4" ? ["-movflags", "+faststart"] : []),
    output,
  ];
  const command = `ffmpeg ${args.map((a) => (/[\s;]/.test(a) ? `"${a}"` : a)).join(" ")}`;
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    const tail = (r.stderr ?? "").split("\n").slice(-25).join("\n");
    throw new Error(`ffmpeg mux failed (exit ${r.status}):\n${tail}`);
  }
  return { command, stderr: r.stderr ?? "" };
}

/** Mean volume of a file's audio in dB (e.g. "-23.3 dB"), or null if undetectable. */
export function meanVolume(file: string): string | null {
  const r = spawnSync("ffmpeg", ["-i", file, "-af", "volumedetect", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const m = /mean_volume:\s*(\S+ dB)/.exec(r.stderr ?? "");
  return m ? m[1] : null;
}

/** True if the file has at least one audio stream (post-mux sanity check). */
export function hasAudioStream(file: string): boolean {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  return out.trim().length > 0;
}
