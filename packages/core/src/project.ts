import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiKeyEnvName } from "./config.js";
import { ensureFfmpeg } from "./mux/ffmpeg.js";
import { type Config, ConfigSchema } from "./types.js";

const ENV_TEMPLATE = `# Narrate API keys — this file lives in .narrate/ which is gitignored, so keys here
# are never committed. Fill in the key for the provider you use.

# Gemini (default provider) — get a free key at https://aistudio.google.com/apikey
NARRATE_GEMINI_API_KEY=

# ElevenLabs — also set tts.provider="elevenlabs" in narrate.config.json
# NARRATE_ELEVENLABS_API_KEY=
`;

/** Append a line to (or create) the project .gitignore if it's not already there. */
function ensureGitignore(cwd: string, entry: string): void {
  const p = join(cwd, ".gitignore");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (existing.split(/\r?\n/).some((l) => l.trim() === entry)) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(p, `${existing}${prefix}${entry}\n`);
}

/**
 * Scaffold `.narrate/` in the project: an `.env.narrate` key template and a
 * `narrate.config.json` with current defaults, and make sure `.narrate/` is
 * gitignored. Idempotent — never overwrites existing files.
 */
export function initProject(cwd: string, log: (msg: string) => void = console.log): void {
  const dir = join(cwd, ".narrate");
  mkdirSync(dir, { recursive: true });

  const envPath = join(dir, ".env.narrate");
  if (existsSync(envPath)) log(`exists: ${envPath}`);
  else {
    writeFileSync(envPath, ENV_TEMPLATE);
    log(`created: ${envPath}`);
  }

  const cfgPath = join(dir, "narrate.config.json");
  if (existsSync(cfgPath)) log(`exists: ${cfgPath}`);
  else {
    writeFileSync(cfgPath, `${JSON.stringify(ConfigSchema.parse({}), null, 2)}\n`);
    log(`created: ${cfgPath}`);
  }

  ensureGitignore(cwd, ".narrate/");
  log(
    "`.narrate/` is gitignored. Edit .narrate/.env.narrate (keys) and narrate.config.json (settings).",
  );
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

  lines.push(
    `config:  provider=${config.tts.provider}, voice=${config.tts.voice}, format=${config.output.format}, crf=${config.output.crf}`,
  );

  const envName = apiKeyEnvName(config);
  if (!envName) {
    lines.push(`TTS key: not required (provider "${config.tts.provider}")`);
  } else if (process.env[envName]?.trim()) {
    lines.push(`TTS key: OK (${envName} is set)`);
  } else {
    ok = false;
    lines.push(
      `TTS key: MISSING — set ${envName} in .narrate/.env.narrate (or use --provider os for the OS voice / --provider mock for silent)`,
    );
  }

  lines.push(`RESULT:  ${ok ? "PASS" : "FAIL"}`);
  return { ok, lines };
}
