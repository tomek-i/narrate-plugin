import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { hasAudioStream, muxNarration, padWav, probeDuration } from "../src/mux/ffmpeg.js";

const noFfmpeg = spawnSync("ffmpeg", ["-version"]).status !== 0;

/** Generate a test input with an ffmpeg lavfi source (a tone or a solid color). */
function lavfi(source: string, out: string, extra: string[] = []): string {
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", source, ...extra, out], { stdio: "ignore" });
  return out;
}

describe("mux timing", { skip: noFfmpeg && "ffmpeg is not on PATH" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "narrate-mux-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("padWav appends the requested silence", () => {
    const wav = lavfi("sine=frequency=440:duration=1", join(dir, "beat.wav"), [
      "-ar",
      "48000",
      "-ac",
      "2",
    ]);
    padWav(wav, 0.6);
    assert.ok(Math.abs(probeDuration(wav) - 1.6) < 0.05, `got ${probeDuration(wav)}s`);
    // 0 is a no-op.
    padWav(wav, 0);
    assert.ok(Math.abs(probeDuration(wav) - 1.6) < 0.05);
  });

  test("a recording shorter than the narration doesn't cut the audio off", async () => {
    const video = lavfi("color=c=gray:s=320x240:r=25:d=2", join(dir, "rec.webm"), [
      "-c:v",
      "libvpx-vp9",
    ]);
    const audio = lavfi("sine=frequency=440:duration=3", join(dir, "narration.wav"));
    const output = join(dir, "out.mp4");
    await muxNarration({
      video,
      audio,
      audioSec: probeDuration(audio),
      leadInSec: 0,
      fps: 25,
      format: "mp4",
      crf: 30,
      output,
    });
    assert.ok(hasAudioStream(output));
    // The video's last frame is held, so the output runs the full 3s of narration.
    const dur = probeDuration(output);
    assert.ok(Math.abs(dur - 3) < 0.1, `expected ~3s, got ${dur}s`);
  });
});
