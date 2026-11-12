import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { settingsFilesChecked } from "./config.js";
import { interrupted, onInterrupt } from "./interrupt.js";
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
import { formatProblems, sceneProblems } from "./validate.js";
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
  /** Where to write the diagnostic log (relative to `cwd`); default `<out>/narrate.log`. */
  logFile?: string;
  /**
   * Fail (stage `mux`) if the finished video has no audio stream or a silent
   * one, instead of only logging a warning. Ignored for the `mock` provider,
   * whose narration is silent by design.
   */
  requireAudio?: boolean;
}

/** Where a render failed: checking the input, preparing tools, speech, browser, or ffmpeg. */
export type RenderStage = "validate" | "setup" | "tts" | "record" | "mux";

/** A failed render: the stage it failed in, and the diagnostic log if one was written. */
export class RenderError extends Error {
  constructor(
    message: string,
    readonly stage: RenderStage,
    /** Absolute path of the diagnostic log, or null if it couldn't be written. */
    readonly log: string | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RenderError";
  }
}

export interface RenderResult {
  /** Absolute path of the video that was written. */
  video: string;
  /** Absolute path of the `.vtt` captions, or null when `output.vtt` is off. */
  captions: string | null;
  durationSec: number;
  audio: {
    present: boolean;
    /** Mean volume of the final audio (dB); null if it couldn't be measured or is -inf. */
    meanVolumeDb: number | null;
    /** No stream, or a near-silent one (≤ -90 dB). */
    silent: boolean;
  };
  /** Absolute path of the diagnostic log, or null if it couldn't be written. */
  log: string | null;
}

/** A `site` that isn't a URL is treated as a local file path → `file://` URL. */
function resolveSite(site: string, cwd: string): string {
  if (/^(https?|file):\/\//i.test(site)) return site;
  return pathToFileURL(resolve(cwd, site)).href;
}

/** "-24.7 dB" → -24.7; anything unmeasurable (or -inf) → null. */
export function parseDb(volume: string | null): number | null {
  const n = Number.parseFloat(volume ?? "");
  return Number.isFinite(n) ? n : null;
}

/**
 * What's wrong with the final video's audio, or null if it's fine: no stream,
 * or a mean volume that's unmeasurable or near silence (≤ -90 dB, or -inf).
 */
export function audioProblem(present: boolean, meanVolume: string | null): string | null {
  if (!present) {
    return "the final video has NO audio stream — the mux dropped the narration entirely";
  }
  const db = parseDb(meanVolume);
  if (db === null || db <= -90) {
    return `the final video's audio track is silent (mean volume ${meanVolume ?? "unmeasurable"})`;
  }
  return null;
}

/**
 * Full render: TTS → continuous recording (paced to narration) → mux.
 * Returns the path to the finished video. See `renderScene` for the details.
 */
export async function render(scene: Scene, config: Config, opts: RenderOptions): Promise<string> {
  return (await renderScene(scene, config, opts)).video;
}

/**
 * Full render, returning what was produced. A failure is thrown as a
 * `RenderError` naming the stage it failed in. The diagnostic log is written
 * either way (to `opts.logFile`, default `<out>/narrate.log`), except that a
 * scene rejected before the render starts only writes it to `opts.logFile`.
 */
export async function renderScene(
  scene: Scene,
  config: Config,
  opts: RenderOptions,
): Promise<RenderResult> {
  // Collect every log line so we can also write a diagnostic file.
  const logLines: string[] = [];
  const log = (msg: string) => {
    logLines.push(msg);
    opts.onLog?.(msg);
  };
  const outDir = resolve(opts.cwd, config.output.dir);
  const logPath = opts.logFile ? resolve(opts.cwd, opts.logFile) : join(outDir, "narrate.log");
  const writeLog = (): string | null => {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      writeFileSync(logPath, `${logLines.join("\n")}\n`);
      opts.onLog?.(`Diagnostic log: ${logPath}`);
      return logPath;
    } catch (err) {
      opts.onLog?.(
        `⚠️  Could not write the diagnostic log ${logPath}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  };

  let stage: RenderStage = "validate";
  try {
    const result = await run();
    return { ...result, log: writeLog() };
  } catch (err) {
    // Interrupted: the failure is only the teardown, not something to report.
    if (interrupted()) throw err;
    const message = err instanceof Error ? err.message : String(err);
    log(`❌ Failed while ${STAGE_LABEL[stage]}: ${message}`);
    // A rejected scene writes nothing to the output folder, so a generated scene
    // can't create files there; the log goes only where the caller asked for it.
    const logged = stage === "validate" && !opts.logFile ? null : writeLog();
    throw new RenderError(message, stage, logged, { cause: err });
  }

  async function run(): Promise<Omit<RenderResult, "log">> {
    log(
      `narrate render — scene "${scene.name}", provider "${config.tts.provider}", platform ${process.platform}`,
    );

    // Check the scene (and, in safe mode, reject dangerous steps) before spending
    // anything on TTS or recording.
    const untrusted = Boolean(opts.untrusted || scene.untrusted);
    const problems = sceneProblems(
      { ...scene, site: resolveSite(scene.site, opts.cwd) },
      { untrusted, allowedOrigins: opts.allowedOrigins },
    );
    if (problems.length) {
      throw new Error(
        `Scene rejected${untrusted ? " (untrusted mode)" : ""}:\n${formatProblems(problems)}`,
      );
    }
    if (untrusted) {
      log("Untrusted mode: on (no eval/uploadFile/off-site navigate, ${NAME} typed literally)");
    }
    const expandEnv = !untrusted && opts.expandEnv !== false;

    // Resolve an auth storage-state path (if any) up front so the recorder gets an
    // absolute path and a missing file fails here, before any TTS is spent.
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

    // The TTS provider first: a missing key fails before any tool is provisioned.
    stage = "tts";
    const provider = makeProvider(config, opts.settingsFiles ?? settingsFilesChecked(opts.cwd));

    // Preflight: ffmpeg must be on PATH; Playwright + Chromium are auto-provisioned
    // on first run so the only manual dependency is ffmpeg.
    stage = "setup";
    ensureFfmpeg();
    if (!(await hasPlaywright())) {
      log("First run: provisioning the headless browser (one-time)…");
      installPlaywrightPackage(log);
      installChromium(log);
    }

    // 1. TTS — synth each beat and measure its real duration.
    stage = "tts";
    const audioDir = join(outDir, "audio");
    mkdirSync(audioDir, { recursive: true });
    // A caller that requires audio must not wait for a whole recording to learn
    // the voice was silent (the OS voice falls back to silence when unavailable).
    const requireAudio = Boolean(opts.requireAudio) && config.tts.provider !== "mock";
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
      const beatVolume = requireAudio ? meanVolume(wavPath) : null;
      if (requireAudio && audioProblem(true, beatVolume)) {
        throw new Error(
          `beat "${beat.id}": the "${provider.name}" voice produced silent narration (mean volume ${beatVolume ?? "unmeasurable"})`,
        );
      }
      durations[beat.id] = probeDuration(wavPath);
      wavs.push(wavPath);
      log(`  ${beat.id}: ${durations[beat.id].toFixed(2)}s`);
    }

    // 2. Record the scene continuously, each beat paced to its narration length.
    stage = "record";
    log("Recording walkthrough (headless)…");
    const recorder = new PlaywrightRecorder(outDir, config, log);
    const sceneToRecord = {
      ...scene,
      site: resolveSite(scene.site, opts.cwd),
      auth,
      // Untrusted scenes always record with the guard on, and can't widen it.
      allowedOrigins: untrusted
        ? (opts.allowedOrigins ?? [])
        : (opts.allowedOrigins ?? scene.allowedOrigins),
    };
    const finalOut = join(outDir, `${scene.name}.${config.output.format}`);
    if (sceneToRecord.allowedOrigins) {
      // If the guard fails, no video may be left at the output path — not even an
      // older one a caller could mistake for this run's.
      rmSync(finalOut, { force: true });
      log(
        `Same-origin guard: on (allowed: ${[sceneToRecord.site, ...sceneToRecord.allowedOrigins].map(originOf).join(", ")})`,
      );
    }
    const { videoPath, leadInMs } = await recorder.record(sceneToRecord, durations, { expandEnv });
    if (!videoPath) throw new Error("Recording produced no video file.");
    log(`Recorded video: ${videoPath} (lead-in ${(leadInMs / 1000).toFixed(3)}s)`);

    // 3. Concatenate narration and overlay onto the trimmed video.
    stage = "mux";
    // An interrupt during the recording's last moments can let it finish: don't
    // start ffmpeg for a render that is being torn down.
    if (interrupted()) throw new Error("interrupted");
    log("Muxing narration onto video…");
    const narration = join(outDir, "narration.wav");
    concatWavs(wavs, narration, join(outDir, "audio.txt"));
    log(`Combined narration: ${narration} (mean volume ${meanVolume(narration) ?? "n/a"})`);
    // From here a video is being written at finalOut: an interrupt or a failed
    // mux must not leave a partial one behind.
    const removePartial = () => rmSync(finalOut, { force: true, maxRetries: 10, retryDelay: 100 });
    const offInterrupt = onInterrupt(removePartial);
    const mux = await muxNarration({
      video: videoPath,
      audio: narration,
      leadInSec: leadInMs / 1000,
      fps: config.output.fps,
      format: config.output.format,
      crf: config.output.crf,
      output: finalOut,
    }).catch((err) => {
      offInterrupt();
      removePartial();
      throw err;
    });
    offInterrupt();
    log(`Mux command:\n${mux.command}`);
    log(`ffmpeg mux output (tail):\n${mux.stderr.trim().split("\n").slice(-12).join("\n")}`);

    // Verify the muxed video actually carries audible audio.
    const audioOk = hasAudioStream(finalOut);
    const finalVol = meanVolume(finalOut);
    log(`Final video: ${finalOut}`);
    log(`Final audio: stream=${audioOk ? "present" : "MISSING"}, mean volume ${finalVol ?? "n/a"}`);
    const problem = audioProblem(audioOk, finalVol);
    const silent = problem !== null;
    if (problem) {
      if (requireAudio) {
        // Don't leave a "narrated" video without narration where a caller might publish it.
        rmSync(finalOut, { force: true });
        throw new Error(`${problem}; the video was removed.`);
      }
      log(`⚠️  Warning: ${problem}.`);
    }

    // Optional sidecars next to the video: a caption track and/or the scene file.
    let captions: string | null = null;
    if (config.output.vtt) {
      captions = join(outDir, `${scene.name}.vtt`);
      writeFileSync(captions, buildVtt(scene.beats, durations, leadInMs / 1000));
      log(`Captions: ${captions}`);
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

    return {
      video: finalOut,
      captions,
      durationSec: probeDuration(finalOut),
      audio: { present: audioOk, meanVolumeDb: parseDb(finalVol), silent },
    };
  }
}

const STAGE_LABEL: Record<RenderStage, string> = {
  validate: "checking the scene",
  setup: "preparing ffmpeg and the browser",
  tts: "generating narration",
  record: "recording the browser",
  mux: "muxing the video",
};

export type { Scene, Config, Durations };
