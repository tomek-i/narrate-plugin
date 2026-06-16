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
          return windows(text, opts?.voice);
        case "darwin":
          return macos(text, opts?.voice);
        default:
          return linux(text, opts?.voice);
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
function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: "ignore" });
}

function scratch(): { dir: string; txt: string; out: (ext: string) => string; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "narrate-os-"));
  return {
    dir,
    txt: join(dir, "in.txt"),
    out: (ext) => join(dir, `out.${ext}`),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function windows(text: string, voice?: string): SynthResult {
  const s = scratch();
  const wav = s.out("wav");
  writeFileSync(s.txt, text, "utf8");
  // Single-quoted PowerShell strings treat backslashes literally, so raw paths
  // are fine; temp paths never contain single quotes.
  const selectVoice = voice ? `$s.SelectVoice('${voice.replace(/'/g, "''")}');` : "";
  const ps = [
    "Add-Type -AssemblyName System.Speech;",
    `$t=[IO.File]::ReadAllText('${s.txt}',[Text.Encoding]::UTF8);`,
    "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    selectVoice,
    `$s.SetOutputToWaveFile('${wav}');$s.Speak($t);$s.Dispose();`,
  ].join("");
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
      run(exe, args);
      ran = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!ran) throw lastErr ?? new Error("no PowerShell found");
  const audio = readFileSync(wav);
  s.clean();
  if (audio.length <= 44) throw new Error("PowerShell TTS produced an empty WAV");
  return { audio, ext: "wav" };
}

function macos(text: string, voice?: string): SynthResult {
  const s = scratch();
  const aiff = s.out("aiff");
  writeFileSync(s.txt, text, "utf8");
  const args = ["-f", s.txt, "-o", aiff];
  if (voice) args.unshift("-v", voice);
  run("say", args);
  const audio = readFileSync(aiff);
  s.clean();
  return { audio, ext: "aiff" };
}

function linux(text: string, voice?: string): SynthResult {
  const s = scratch();
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
  const audio = readFileSync(wav);
  s.clean();
  return { audio, ext: "wav" };
}

/** Silent WAV sized to the text — same shaping as the mock provider. */
function silent(text: string): SynthResult {
  const rate = 24000;
  const words = text.trim().split(/\s+/).length;
  const seconds = Math.max(1.5, words * 0.38);
  return { audio: pcmToWav(Buffer.alloc(Math.round(rate * seconds) * 2), rate), ext: "wav" };
}
