import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ConfigLayer,
  SETTINGS_FILE,
  globalSettingsPath,
  hasApiKey,
  loadConfig,
  settingOrigin,
  settingsPath,
} from "./config.js";
import { ensureFfmpeg } from "./mux/ffmpeg.js";
import { maskKey } from "./secret.js";
import type { Config } from "./types.js";

/**
 * Hosted JSON Schema for editor autocomplete. A relative path can't work: the
 * plugin may be installed at user/global scope, so the schema file isn't next to
 * the user's project. A remote URL resolves anywhere and degrades silently if
 * unreachable (no "schema not found" squiggle).
 */
const SCHEMA_URL =
  "https://raw.githubusercontent.com/tomek-i/narrate-plugin/main/narrate.schema.json";

/** Where a settings write goes: the user's global file (default) or this project's. */
export type SettingsScope = "global" | "project";

/**
 * A fresh settings file holds only `$schema`. Every other field falls through to
 * the layer below (project → global → defaults), so scaffolding never pins
 * default values that would mask the user's global settings.
 */
function settingsTemplate(): Record<string, unknown> {
  return { $schema: SCHEMA_URL };
}

/** Path of the settings file for a scope. */
export function scopePath(cwd: string, scope: SettingsScope): string {
  return scope === "global" ? globalSettingsPath() : settingsPath(cwd);
}

/** Read a settings file for editing (or a fresh template), creating its dir. */
function readForEdit(path: string): Record<string, unknown> {
  mkdirSync(dirname(path), { recursive: true });
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : settingsTemplate();
}

/** Write an edited settings file; project files also get `.narrate/` gitignored. */
function writeSettings(
  cwd: string,
  scope: SettingsScope,
  path: string,
  raw: Record<string, unknown>,
): void {
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  if (scope === "project") ensureGitignore(cwd, ".narrate/");
}

/** Append a line to (or create) the project .gitignore if it's not already there. */
export function ensureGitignore(cwd: string, entry: string): void {
  const p = join(cwd, ".gitignore");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (existing.split(/\r?\n/).some((l) => l.trim() === entry)) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(p, `${existing}${prefix}${entry}\n`);
}

export interface InitResult {
  /** True if the settings file was just created (→ run onboarding). */
  created: boolean;
  path: string;
}

/**
 * Scaffold a settings file. For a project (the default), that's an override-only
 * `.narrate/settings.local.json` plus a gitignored `.narrate/`; with
 * `scope: "global"`, it's `~/.narrate/settings.json`. Idempotent — never
 * overwrites an existing file. `created` tells the caller whether this is a
 * first-time setup so it can run onboarding.
 */
export function initProject(
  cwd: string,
  log: (msg: string) => void = console.log,
  scope: SettingsScope = "project",
): InitResult {
  const path = scopePath(cwd, scope);
  mkdirSync(dirname(path), { recursive: true });

  let created = false;
  if (existsSync(path)) {
    log(`exists: ${path}`);
  } else {
    writeFileSync(path, `${JSON.stringify(settingsTemplate(), null, 2)}\n`);
    created = true;
    log(`created: ${path}`);
  }

  if (scope === "project") {
    ensureGitignore(cwd, ".narrate/");
    log(
      `\`.narrate/\` is gitignored. Settings come from ${globalSettingsPath()}; ` +
        `put project-only overrides in .narrate/${SETTINGS_FILE}.`,
    );
  }
  return { created, path };
}

/**
 * Write an API key and switch the active provider to it. Goes to the global
 * settings by default, so it's set once for every project; `scope: "project"`
 * stores a project-only override instead. Creates the file if needed.
 */
export function setKey(
  cwd: string,
  provider: "gemini" | "elevenlabs",
  key: string,
  log: (msg: string) => void = console.log,
  scope: SettingsScope = "global",
): string {
  const path = scopePath(cwd, scope);
  const raw = readForEdit(path);

  const tts = { ...(raw.tts as Record<string, unknown> | undefined) };
  const block = { ...(tts[provider] as Record<string, unknown> | undefined) };
  block.key = key.trim();
  tts[provider] = block;
  tts.provider = provider;
  raw.tts = tts;

  writeSettings(cwd, scope, path, raw);
  log(
    `set tts.${provider}.key (${maskKey(block.key as string)}) and tts.provider="${provider}" in ${path}`,
  );
  return path;
}

/**
 * Set the voice for the currently-active provider (gemini/elevenlabs). The active
 * provider is read from the effective (merged) config, so a provider chosen
 * globally works with a project-scoped voice. Used after `narrate voices`.
 */
export function setVoice(
  cwd: string,
  voice: string,
  log: (msg: string) => void = console.log,
  scope: SettingsScope = "global",
): string {
  const provider = loadConfig(cwd).tts.provider;
  if (provider !== "gemini" && provider !== "elevenlabs") {
    throw new Error(
      `Active provider is "${provider}", which has no configurable voice id. Switch first with \`narrate set-key <gemini|elevenlabs> <key>\`.`,
    );
  }
  const path = scopePath(cwd, scope);
  const raw = readForEdit(path);
  const tts = { ...(raw.tts as Record<string, unknown> | undefined) };
  const block = { ...(tts[provider] as Record<string, unknown> | undefined) };
  block.voice = voice.trim();
  tts[provider] = block;
  raw.tts = tts;
  writeSettings(cwd, scope, path, raw);
  log(`set tts.${provider}.voice="${voice.trim()}" in ${path}`);
  return path;
}

export interface CheckResult {
  ok: boolean;
  lines: string[];
}

/**
 * Deterministic preflight: ffmpeg present, config readable, and an API key set
 * for the configured provider (os/mock need none). No LLM, no network.
 */
export function checkEnv(config: Config, layers: ConfigLayer[] = []): CheckResult {
  const lines: string[] = [];
  let ok = true;

  try {
    ensureFfmpeg();
    lines.push("ffmpeg:  OK");
  } catch (err) {
    ok = false;
    lines.push(`ffmpeg:  MISSING — ${err instanceof Error ? err.message : err}`);
  }

  const provider = config.tts.provider;
  const voice =
    provider === "gemini"
      ? config.tts.gemini.voice
      : provider === "elevenlabs"
        ? config.tts.elevenlabs.voice
        : "—";
  const from = (keyPath: string) => settingOrigin(layers, keyPath);
  const voiceFrom =
    provider === "gemini" || provider === "elevenlabs" ? from(`tts.${provider}.voice`) : null;
  lines.push(
    `config:  provider=${provider} (${from("tts.provider")}), voice=${voice}${voiceFrom ? ` (${voiceFrom})` : ""}, ` +
      `format=${config.output.format}, crf=${config.output.crf}`,
  );
  lines.push(
    `files:   ${layers.length ? layers.map((l) => `${l.scope}=${l.path}`).join(", ") : "none (all defaults)"}`,
  );

  if (provider === "os" || provider === "mock") {
    lines.push(`TTS key: not required (provider "${provider}")`);
  } else if (hasApiKey(config)) {
    const keyFrom = from(`tts.${provider}.key`);
    lines.push(
      `TTS key: OK (${keyFrom === "default" ? "from env" : `tts.${provider}.key, ${keyFrom}`})`,
    );
  } else {
    ok = false;
    lines.push(
      `TTS key: MISSING — run \`narrate set-key ${provider} <key>\` (saves to ${globalSettingsPath()}; add --project for a project-only key in .narrate/${SETTINGS_FILE}), or use --provider os for the OS voice / mock for silent`,
    );
  }

  lines.push(`RESULT:  ${ok ? "PASS" : "FAIL"}`);
  return { ok, lines };
}
