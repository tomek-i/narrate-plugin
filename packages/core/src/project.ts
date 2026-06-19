import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS_FILE, hasApiKey, settingsPath } from "./config.js";
import { ensureFfmpeg } from "./mux/ffmpeg.js";
import { type Config, ConfigSchema } from "./types.js";

/**
 * Hosted JSON Schema for editor autocomplete. A relative path can't work: the
 * plugin may be installed at user/global scope, so the schema file isn't next to
 * the user's project. A remote URL resolves anywhere and degrades silently if
 * unreachable (no "schema not found" squiggle).
 */
const SCHEMA_URL =
  "https://raw.githubusercontent.com/tomek-i/narrate-plugin/main/narrate.schema.json";

/** The on-disk shape of settings.local.json (config + an editor `$schema`). */
function settingsTemplate(): Record<string, unknown> {
  return {
    $schema: SCHEMA_URL,
    ...ConfigSchema.parse({}),
  };
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
  /** True if settings.local.json was just created (→ run onboarding). */
  created: boolean;
  path: string;
}

/**
 * Scaffold `.narrate/settings.local.json` (config + API keys in one file) and
 * make sure `.narrate/` is gitignored. Idempotent — never overwrites an existing
 * file. `created` tells the caller whether this is a first-time setup so it can
 * run onboarding; on later runs the file exists and onboarding is skipped.
 */
export function initProject(cwd: string, log: (msg: string) => void = console.log): InitResult {
  const dir = join(cwd, ".narrate");
  mkdirSync(dir, { recursive: true });

  const path = settingsPath(cwd);
  let created = false;
  if (existsSync(path)) {
    log(`exists: ${path}`);
  } else {
    writeFileSync(path, `${JSON.stringify(settingsTemplate(), null, 2)}\n`);
    created = true;
    log(`created: ${path}`);
  }

  ensureGitignore(cwd, ".narrate/");
  log(`\`.narrate/\` is gitignored. Edit .narrate/${SETTINGS_FILE} (config + keys).`);
  return { created, path };
}

/**
 * Write an API key into `.narrate/settings.local.json` and switch the active
 * provider to it. Used by onboarding so keys never have to be hand-edited into
 * JSON. Creates the file from defaults if it doesn't exist yet.
 */
export function setKey(
  cwd: string,
  provider: "gemini" | "elevenlabs",
  key: string,
  log: (msg: string) => void = console.log,
): string {
  const dir = join(cwd, ".narrate");
  mkdirSync(dir, { recursive: true });
  const path = settingsPath(cwd);

  const raw: Record<string, unknown> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : settingsTemplate();

  const tts = { ...(raw.tts as Record<string, unknown> | undefined) };
  const block = { ...(tts[provider] as Record<string, unknown> | undefined) };
  block.key = key.trim();
  tts[provider] = block;
  tts.provider = provider;
  raw.tts = tts;

  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  ensureGitignore(cwd, ".narrate/");
  log(`set tts.${provider}.key and tts.provider="${provider}" in ${path}`);
  return path;
}

/**
 * Set the voice for the currently-active provider (gemini/elevenlabs) in
 * `.narrate/settings.local.json`. Used after `narrate voices` to lock in a voice
 * the key can actually use.
 */
export function setVoice(
  cwd: string,
  voice: string,
  log: (msg: string) => void = console.log,
): string {
  const path = settingsPath(cwd);
  const raw: Record<string, unknown> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : settingsTemplate();
  const tts = { ...(raw.tts as Record<string, unknown> | undefined) };
  const provider = (tts.provider as string) ?? "os";
  if (provider !== "gemini" && provider !== "elevenlabs") {
    throw new Error(
      `Active provider is "${provider}", which has no configurable voice id. Switch first with \`narrate set-key <gemini|elevenlabs> <key>\`.`,
    );
  }
  const block = { ...(tts[provider] as Record<string, unknown> | undefined) };
  block.voice = voice.trim();
  tts[provider] = block;
  raw.tts = tts;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
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
export function checkEnv(config: Config): CheckResult {
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
  lines.push(
    `config:  provider=${provider}, voice=${voice}, format=${config.output.format}, crf=${config.output.crf}`,
  );

  if (provider === "os" || provider === "mock") {
    lines.push(`TTS key: not required (provider "${provider}")`);
  } else if (hasApiKey(config)) {
    lines.push(`TTS key: OK (tts.${provider}.key set in .narrate/${SETTINGS_FILE})`);
  } else {
    ok = false;
    lines.push(
      `TTS key: MISSING — add it under tts.${provider}.key in .narrate/${SETTINGS_FILE} ` +
        `(or run \`narrate set-key ${provider} <key>\`; or use --provider os for the OS voice / mock for silent)`,
    );
  }

  lines.push(`RESULT:  ${ok ? "PASS" : "FAIL"}`);
  return { ok, lines };
}
