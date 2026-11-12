import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pcmToWav } from "../audio/wav.js";
import type { SynthOptions, SynthResult, TTSProvider } from "./provider.js";

/**
 * No-API-key fallback that uses the operating system's built-in text-to-speech:
 * Windows SAPI (PowerShell System.Speech), macOS `say`, or Linux espeak(-ng).
 * If the platform's tool isn't available, it degrades to silent narration so a
 * render still succeeds — with a one-time warning pointing at a real provider.
 */
export class OsTtsProvider implements TTSProvider {
  readonly name = "os";
  private warned = false;

  async synth(text: string, opts?: SynthOptions): Promise<SynthResult> {
    try {
      switch (process.platform) {
        case "win32":
          return withScratch((s) => windows(s, text, opts?.voice));
        case "darwin":
          return withScratch((s) => macos(s, text, opts?.voice));
        default:
          return withScratch((s) => linux(s, text, opts?.voice));
      }
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[narrate] OS text-to-speech is unavailable (${reason}); falling back to silent narration. Set a TTS API key (e.g. NARRATE_GEMINI_API_KEY) for real audio.`,
        );
      }
      return silent(text);
    }
  }
}

/** Run a command, throwing if the binary is missing or it fails. */
function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync(cmd, args, { stdio: "ignore", ...(env ? { env: { ...process.env, ...env } } : {}) });
}

type Scratch = { dir: string; txt: string; out: (ext: string) => string; clean: () => void };

/** Run `fn` with a scratch folder that's removed afterwards, also when `fn` fails. */
function withScratch<T>(fn: (s: Scratch) => T): T {
  const s = scratch();
  try {
    return fn(s);
  } finally {
    s.clean();
  }
}

function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "narrate-os-"));
  return {
    dir,
    txt: join(dir, "in.txt"),
    out: (ext) => join(dir, `out.${ext}`),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function windows(s: Scratch, text: string, voice?: string): SynthResult {
  const wav = s.out("wav");
  writeFileSync(s.txt, text, "utf8");
  // The voice (scene input) and the paths (which can contain quotes, e.g. a user
  // named O'Brien) reach PowerShell as environment variables, so they're only
  // ever data: nothing from them is parsed as code. Quoting isn't enough here,
  // because PowerShell also treats the curly quotes ‘ ’ as string delimiters.
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    "$t=[IO.File]::ReadAllText($env:NARRATE_TTS_IN,[Text.Encoding]::UTF8);",
    "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    voice ? "$s.SelectVoice($env:NARRATE_TTS_VOICE);" : "",
    "$s.SetOutputToWaveFile($env:NARRATE_TTS_OUT);$s.Speak($t);$s.Dispose();",
  ].join("");
  const env = { NARRATE_TTS_IN: s.txt, NARRATE_TTS_OUT: wav, NARRATE_TTS_VOICE: voice ?? "" };
  const args = ["-NoProfile", "-NonInteractive", "-Command", ps];
  // Resolve powershell.exe by absolute path first — when this runs from a
  // spawned shell (e.g. Git Bash) System32 isn't always on PATH.
  const sysRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  const candidates = [
    join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    "powershell",
    "pwsh",
  ];
  let ran = false;
  let lastErr: unknown;
  for (const exe of candidates) {
    try {
      run(exe, args, env);
      ran = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!ran) throw lastErr ?? new Error("no PowerShell found");
  const audio = readFileSync(wav);
  if (audio.length <= 44) throw new Error("PowerShell TTS produced an empty WAV");
  return { audio, ext: "wav" };
}

function macos(s: Scratch, text: string, voice?: string): SynthResult {
  const aiff = s.out("aiff");
  writeFileSync(s.txt, text, "utf8");
  const args = ["-f", s.txt, "-o", aiff];
  if (voice) args.unshift("-v", voice);
  run("say", args);
  return { audio: readFileSync(aiff), ext: "aiff" };
}

function linux(s: Scratch, text: string, voice?: string): SynthResult {
  const wav = s.out("wav");
  writeFileSync(s.txt, text, "utf8");
  const bin = ["espeak-ng", "espeak"].find((b) => {
    try {
      run(b, ["--version"]);
      return true;
    } catch {
      return false;
    }
  });
  if (!bin) throw new Error("no espeak-ng/espeak on PATH");
  const args = ["-w", wav, "-f", s.txt];
  if (voice) args.push("-v", voice);
  run(bin, args);
  return { audio: readFileSync(wav), ext: "wav" };
}

/** Silent WAV sized to the text — same shaping as the mock provider. */
function silent(text: string): SynthResult {
  const rate = 24000;
  const words = text.trim().split(/\s+/).length;
  const seconds = Math.max(1.5, words * 0.38);
  return { audio: pcmToWav(Buffer.alloc(Math.round(rate * seconds) * 2), rate), ext: "wav" };
}
