import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Config, ConfigSchema, type Scene, SceneSchema } from "./types.js";

/** The single project config file. Lives in `.narrate/` (gitignored). */
export const SETTINGS_FILE = "settings.local.json";

/** Absolute path to the project's settings file. */
export function settingsPath(cwd: string): string {
  return resolve(cwd, ".narrate", SETTINGS_FILE);
}

/** Default env var per provider — used only as a fallback when no key is in the
 *  settings file (handy for CI). Overridable via config.tts.apiKeyEnv. */
const KEY_ENV: Record<string, string | null> = {
  gemini: "NARRATE_GEMINI_API_KEY",
  elevenlabs: "NARRATE_ELEVENLABS_API_KEY",
  os: null,
  mock: null,
};

export function loadConfig(cwd: string, configPath?: string): Config {
  const candidates = configPath
    ? [resolve(cwd, configPath)]
    : [
        settingsPath(cwd),
        // legacy locations, still honored so older projects keep working
        resolve(cwd, ".narrate", "narrate.config.json"),
        resolve(cwd, "narrate.config.json"),
      ];
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
  const scene = SceneSchema.parse(JSON.parse(readFileSync(p, "utf8")));
  // A `site` that isn't a URL is a local file path, resolved relative to the
  // scene file so example/demo scenes stay portable wherever the repo lives.
  if (!/^(https?|file):\/\//i.test(scene.site)) {
    scene.site = pathToFileURL(resolve(dirname(p), scene.site)).href;
  }
  return scene;
}

/** Providers whose settings (incl. key) live in the config file. */
export type KeyedProvider = "gemini" | "elevenlabs";

/** The active provider's settings block, or null for os/mock (no key needed). */
function providerSettings(config: Config): Config["tts"]["gemini"] | null {
  const p = config.tts.provider;
  if (p === "gemini") return config.tts.gemini;
  if (p === "elevenlabs") return config.tts.elevenlabs;
  return null;
}

/** The fallback env var the provider's key is read from, or null if none. */
export function apiKeyEnvName(config: Config): string | null {
  const s = providerSettings(config);
  if (!s) return null;
  return s.apiKeyEnv ?? KEY_ENV[config.tts.provider];
}

/** Whether a usable key is available for the configured provider (file or env). */
export function hasApiKey(config: Config): boolean {
  const s = providerSettings(config);
  if (!s) return true; // os/mock need no key
  if (s.key?.trim()) return true;
  const envName = apiKeyEnvName(config);
  return Boolean(envName && process.env[envName]?.trim());
}

/** Resolve the API key for the configured provider, with a clear error if missing.
 *  Precedence: the key in `.narrate/settings.local.json`, then the env fallback. */
export function resolveApiKey(config: Config): string {
  const s = providerSettings(config);
  if (!s) return ""; // os/mock
  const fromFile = s.key?.trim();
  if (fromFile) return fromFile;
  const envName = apiKeyEnvName(config);
  const fromEnv = envName ? process.env[envName]?.trim() : undefined;
  if (fromEnv) return fromEnv;
  const provider = config.tts.provider;
  throw new Error(
    `Missing API key for provider "${provider}". ` +
      `Add it under tts.${provider}.key in .narrate/${SETTINGS_FILE} ` +
      `(run \`narrate set-key ${provider} <key>\`)${envName ? ` or set ${envName}` : ""}.`,
  );
}
