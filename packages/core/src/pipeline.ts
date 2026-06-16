import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  concatWavs,
  ensureFfmpeg,
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
  const log = opts.onLog ?? (() => {});

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
  log(`Generating narration with "${provider.name}" (voice: ${config.tts.voice})…`);
  const durations: Durations = {};
  const wavs: string[] = [];
  for (const beat of scene.beats) {
    const res = await provider.synth(beat.say, { voice: beat.voice });
    const rawPath = join(audioDir, `${beat.id}.${res.ext}`);
    writeFileSync(rawPath, res.audio);
    const wavPath = join(audioDir, `${beat.id}.norm.wav`);
    normalizeToWav(rawPath, wavPath);
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

  // 3. Concatenate narration and overlay onto the trimmed video.
  log("Muxing narration onto video…");
  const narration = join(outDir, "narration.wav");
  concatWavs(wavs, narration, join(outDir, "audio.txt"));
  const finalOut = join(outDir, `${scene.name}.${config.output.format}`);
  muxNarration({
    video: videoPath,
    audio: narration,
    leadInSec: leadInMs / 1000,
    fps: config.output.fps,
    format: config.output.format,
    output: finalOut,
  });

  return finalOut;
}

export type { Scene, Config, Durations };
