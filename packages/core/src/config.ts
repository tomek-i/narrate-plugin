import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { type Config, ConfigSchema, type Scene, SceneSchema } from "./types.js";

/** Default env var per provider; overridable via config.tts.apiKeyEnv. */
const KEY_ENV: Record<string, string | null> = {
  gemini: "NARRATE_GEMINI_API_KEY",
  elevenlabs: "NARRATE_ELEVENLABS_API_KEY",
  mock: null,
};

/** Load .env.narrate (gitignored) from the working dir, if present. */
export function loadEnv(cwd: string): void {
  const p = resolve(cwd, ".env.narrate");
  if (existsSync(p)) dotenv.config({ path: p });
}

export function loadConfig(cwd: string, configPath?: string): Config {
  const candidates = configPath
    ? [resolve(cwd, configPath)]
    : [resolve(cwd, "narrate.config.json")];
  for (const p of candidates) {
    if (existsSync(p)) {
      // zod strips unknown keys, so an editor-only `$schema` is dropped here.
      return ConfigSchema.parse(JSON.parse(readFileSync(p, "utf8")));
    }
  }
  // No file? Fall back to all-defaults (Gemini/Kore).
  return ConfigSchema.parse({});
}

export function loadScene(cwd: string, scenePath: string): Scene {
  const p = resolve(cwd, scenePath);
  if (!existsSync(p)) throw new Error(`Scene file not found: ${p}`);
  return SceneSchema.parse(JSON.parse(readFileSync(p, "utf8")));
}

/** Resolve the API key for the configured provider, with a clear error if missing. */
export function resolveApiKey(config: Config): string {
  const envName = config.tts.apiKeyEnv ?? KEY_ENV[config.tts.provider];
  if (!envName) return ""; // e.g. mock provider
  const key = process.env[envName]?.trim();
  if (!key) {
    throw new Error(
      `Missing API key for provider "${config.tts.provider}". ` +
        `Set ${envName} in .env.narrate or your environment.`,
    );
  }
  return key;
}
