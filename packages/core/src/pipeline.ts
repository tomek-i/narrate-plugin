import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { settingsFilesChecked } from "./config.js";
import {
  concatWavs,
  ensureFfmpeg,
  hasAudioStream,
  meanVolume,
  muxNarration,
  normalizeToWav,
  probeDuration,
} from "./mux/ffmpeg.js";
import { originOf } from "./record/origin-guard.js";
import { PlaywrightRecorder } from "./record/playwright.js";
import { hasPlaywright, installChromium, installPlaywrightPackage } from "./setup.js";
import { makeProvider } from "./tts/index.js";
import type { Config, Durations, Scene } from "./types.js";
import { formatProblems, untrustedProblems } from "./validate.js";
import { buildVtt } from "./vtt.js";

export interface RenderOptions {
  cwd: string;
  onLog?: (msg: string) => void;
  /** Path the scene was loaded from — used by `output.keepScene` to retain a copy. */
  scenePath?: string;
  /**
   * Safe mode for generated scenes (also on when the scene sets `untrusted`):
   * rejects `eval`, `uploadFile` and off-origin `navigate` before anything runs,
   * types `${NAME}` literally, ignores the scene's `auth.storageState` (only
   * `storageState` below is used) and turns on the same-origin guard.
   */
  untrusted?: boolean;
  /** Expand `${NAME}` in `fill`/`type` text (default true; `--no-env` sets false). */
  expandEnv?: boolean;
  /**
   * Origins the caller allows besides the site's own (`--allow-origin`); turns on
   * the same-origin guard. In untrusted mode these are the only extra origins:
   * the scene's own `allowedOrigins` is ignored.
   */
  allowedOrigins?: string[];
  /** A storage-state file chosen by the caller; overrides the scene's `auth`. */
  storageState?: string;
  /** Settings files consulted for this run; named in a missing-key error. */
  settingsFiles?: string[];
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

  // Safe mode: reject dangerous steps before spending anything on TTS or recording.
  const untrusted = Boolean(opts.untrusted || scene.untrusted);
  if (untrusted) {
    const problems = untrustedProblems(
      { ...scene, site: resolveSite(scene.site, opts.cwd) },
      { allowedOrigins: opts.allowedOrigins },
    );
    if (problems.length) {
      throw new Error(`Scene rejected (untrusted mode):\n${formatProblems(problems)}`);
    }
    log("Untrusted mode: on (no eval/uploadFile/off-site navigate, ${NAME} typed literally)");
  }
  const expandEnv = !untrusted && opts.expandEnv !== false;

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
  const provider = makeProvider(config, opts.settingsFiles ?? settingsFilesChecked(opts.cwd));
  const activeVoice =
    config.tts.provider === "gemini"
      ? config.tts.gemini.voice
      : config.tts.provider === "elevenlabs"
        ? config.tts.elevenlabs.voice
        : provider.name;
  log(`Generating narration with "${provider.name}" (voice: ${activeVoice})…`);
  const durations: Durations = {};
  const wavs: string[] = [];
  for (const [i, beat] of scene.beats.entries()) {
    const res = await provider.synth(beat.say, { voice: beat.voice });
    // Normalize the provider bytes straight to a single 48kHz-stereo WAV (piped
    // through ffmpeg, so no raw intermediate file is written) for clean concat.
    // Named by position, not id: an id is free text and mustn't become a path.
    const wavPath = join(audioDir, `beat-${String(i + 1).padStart(3, "0")}.wav`);
    normalizeToWav(res.audio, wavPath);
    durations[beat.id] = probeDuration(wavPath);
    wavs.push(wavPath);
    log(`  ${beat.id}: ${durations[beat.id].toFixed(2)}s`);
  }

  // 2. Record the scene continuously, each beat paced to its narration length.
  log("Recording walkthrough (headless)…");
  const recorder = new PlaywrightRecorder(outDir, config, log);
  // Resolve an auth storage-state path (if any) up front so the recorder gets an
  // absolute path and a missing file fails here with a clear, actionable message.
  // In untrusted mode the scene can't pick which saved session to load.
  if (untrusted && scene.allowedOrigins?.length) {
    log(
      `⚠️  Untrusted mode: ignoring the scene's allowedOrigins (${scene.allowedOrigins.join(", ")}); pass --allow-origin to allow more origins.`,
    );
  }
  if (untrusted && scene.auth?.storageState && !opts.storageState) {
    log(
      `⚠️  Untrusted mode: ignoring the scene's auth.storageState (${scene.auth.storageState}); pass --storage-state to start signed in.`,
    );
  }
  const statePathIn = opts.storageState ?? (untrusted ? undefined : scene.auth?.storageState);
  let auth = statePathIn ? { storageState: statePathIn } : undefined;
  if (auth?.storageState) {
    const statePath = resolve(opts.cwd, auth.storageState);
    if (!existsSync(statePath)) {
      throw new Error(
        `Auth storage state not found: ${statePath}. Capture it once with \`narrate auth <login-url> --out ${auth.storageState}\` (a browser opens; log in, then close it), then re-run. (The file holds session tokens — keep it gitignored.)`,
      );
    }
    auth = { storageState: statePath };
    log(`Auth: loading storage state from ${statePath} (starting signed in)`);
  }
  const sceneToRecord = {
    ...scene,
    site: resolveSite(scene.site, opts.cwd),
    auth,
    // Untrusted scenes always record with the guard on, and can't widen it.
    allowedOrigins: untrusted
      ? (opts.allowedOrigins ?? [])
      : (opts.allowedOrigins ?? scene.allowedOrigins),
  };
  if (sceneToRecord.allowedOrigins) {
    // If the guard fails, no video may be left at the output path — not even an
    // older one a caller could mistake for this run's.
    rmSync(join(outDir, `${scene.name}.${config.output.format}`), { force: true });
    log(
      `Same-origin guard: on (allowed: ${[sceneToRecord.site, ...sceneToRecord.allowedOrigins].map(originOf).join(", ")})`,
    );
  }
  const { videoPath, leadInMs } = await recorder.record(sceneToRecord, durations, { expandEnv });
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

  // Optional sidecars next to the video: a caption track and/or the scene file.
  if (config.output.vtt) {
    const vttPath = join(outDir, `${scene.name}.vtt`);
    writeFileSync(vttPath, buildVtt(scene.beats, durations, leadInMs / 1000));
    log(`Captions: ${vttPath}`);
  }
  if (config.output.keepScene && opts.scenePath) {
    const src = resolve(opts.cwd, opts.scenePath);
    const dest = join(outDir, `${scene.name}.scene.json`);
    // The scene may already live in the out dir (src === dest) — then it's
    // retained simply by not being deleted, so there's nothing to copy.
    if (src === dest) {
      log(`Scene retained: ${dest} (already in out dir)`);
    } else {
      try {
        copyFileSync(src, dest);
        log(`Scene retained: ${dest}`);
      } catch (err) {
        log(`⚠️  Could not retain scene file: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Always write a diagnostic log next to the output for easy copy/paste.
  try {
    writeFileSync(join(outDir, "narrate.log"), `${logLines.join("\n")}\n`);
    opts.onLog?.(`Diagnostic log: ${join(outDir, "narrate.log")}`);
  } catch {}

  return finalOut;
}

export type { Scene, Config, Durations };
