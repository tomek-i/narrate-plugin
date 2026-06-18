import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  concatWavs,
  ensureFfmpeg,
  hasAudioStream,
  meanVolume,
  muxNarration,
  normalizeToWav,
  probeDuration,
} from "./mux/ffmpeg.js";
import { PlaywrightRecorder } from "./record/playwright.js";
import { hasPlaywright, installChromium, installPlaywrightPackage } from "./setup.js";
import { makeProvider } from "./tts/index.js";
import type { Config, Durations, Scene } from "./types.js";

export interface RenderOptions {
  cwd: string;
  onLog?: (msg: string) => void;
}

/** A `site` that isn't a URL is treated as a local file path → `file://` URL. */
function resolveSite(site: string, cwd: string): string {
  if (/^(https?|file):\/\//i.test(site)) return site;
  return pathToFileURL(resolve(cwd, site)).href;
}

/**
 * Full render: TTS → continuous recording (paced to narration) → mux.
 * Returns the path to the finished video.
 */
export async function render(scene: Scene, config: Config, opts: RenderOptions): Promise<string> {
  // Collect every log line so we can also write a diagnostic file to the out dir.
  const logLines: string[] = [];
  const log = (msg: string) => {
    logLines.push(msg);
    opts.onLog?.(msg);
  };
  log(
    `narrate render — scene "${scene.name}", provider "${config.tts.provider}", platform ${process.platform}`,
  );

  // Preflight: ffmpeg must be on PATH; Playwright + Chromium are auto-provisioned
  // on first run so the only manual dependency is ffmpeg.
  ensureFfmpeg();
  if (!(await hasPlaywright())) {
    log("First run: provisioning the headless browser (one-time)…");
    installPlaywrightPackage(log);
    installChromium(log);
  }

  const outDir = resolve(opts.cwd, config.output.dir);
  const audioDir = join(outDir, "audio");
  mkdirSync(audioDir, { recursive: true });

  // 1. TTS — synth each beat and measure its real duration.
  const provider = makeProvider(config);
  const activeVoice =
    config.tts.provider === "gemini"
      ? config.tts.gemini.voice
      : config.tts.provider === "elevenlabs"
        ? config.tts.elevenlabs.voice
        : provider.name;
  log(`Generating narration with "${provider.name}" (voice: ${activeVoice})…`);
  const durations: Durations = {};
  const wavs: string[] = [];
  for (const beat of scene.beats) {
    const res = await provider.synth(beat.say, { voice: beat.voice });
    // Normalize the provider bytes straight to a single 48kHz-stereo WAV (piped
    // through ffmpeg, so no raw intermediate file is written) for clean concat.
    const wavPath = join(audioDir, `${beat.id}.wav`);
    normalizeToWav(res.audio, wavPath);
    durations[beat.id] = probeDuration(wavPath);
    wavs.push(wavPath);
    log(`  ${beat.id}: ${durations[beat.id].toFixed(2)}s`);
  }

  // 2. Record the scene continuously, each beat paced to its narration length.
  log("Recording walkthrough (headless)…");
  const recorder = new PlaywrightRecorder(outDir, config);
  const sceneToRecord = { ...scene, site: resolveSite(scene.site, opts.cwd) };
  const { videoPath, leadInMs } = await recorder.record(sceneToRecord, durations);
  if (!videoPath) throw new Error("Recording produced no video file.");
  log(`Recorded video: ${videoPath} (lead-in ${(leadInMs / 1000).toFixed(3)}s)`);

  // 3. Concatenate narration and overlay onto the trimmed video.
  log("Muxing narration onto video…");
  const narration = join(outDir, "narration.wav");
  concatWavs(wavs, narration, join(outDir, "audio.txt"));
  log(`Combined narration: ${narration} (mean volume ${meanVolume(narration) ?? "n/a"})`);
  const finalOut = join(outDir, `${scene.name}.${config.output.format}`);
  const mux = muxNarration({
    video: videoPath,
    audio: narration,
    leadInSec: leadInMs / 1000,
    fps: config.output.fps,
    format: config.output.format,
    crf: config.output.crf,
    output: finalOut,
  });
  log(`Mux command:\n${mux.command}`);
  log(`ffmpeg mux output (tail):\n${mux.stderr.trim().split("\n").slice(-12).join("\n")}`);

  // Verify the muxed video actually carries audible audio.
  const audioOk = hasAudioStream(finalOut);
  const finalVol = meanVolume(finalOut);
  log(`Final video: ${finalOut}`);
  log(`Final audio: stream=${audioOk ? "present" : "MISSING"}, mean volume ${finalVol ?? "n/a"}`);
  const silent = !finalVol || /-(9\d(\.\d+)?|inf) dB/.test(finalVol);
  if (!audioOk || silent) {
    log(
      audioOk
        ? "⚠️  Warning: the final video's audio track is silent (near -inf dB) even though narration.wav had sound — the mux lost the audio content."
        : "⚠️  Warning: the final video has NO audio stream — the mux dropped the narration entirely.",
    );
  }

  // Always write a diagnostic log next to the output for easy copy/paste.
  try {
    writeFileSync(join(outDir, "narrate.log"), `${logLines.join("\n")}\n`);
    opts.onLog?.(`Diagnostic log: ${join(outDir, "narrate.log")}`);
  } catch {}

  return finalOut;
}

export type { Scene, Config, Durations };
