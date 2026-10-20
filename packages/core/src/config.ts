import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Config, ConfigSchema, type Scene, SceneSchema } from "./types.js";

/** The project config file. Lives in `.narrate/` (gitignored); overrides global. */
export const SETTINGS_FILE = "settings.local.json";

/** The user-wide config file, in `~/.narrate/`. Shared by every project. */
export const GLOBAL_SETTINGS_FILE = "settings.json";

/** Absolute path to the project's settings file. */
export function settingsPath(cwd: string): string {
  return resolve(cwd, ".narrate", SETTINGS_FILE);
}

/** Absolute path to the user's global settings file. `NARRATE_HOME` relocates
 *  the `.narrate` dir (handy for tests/CI); defaults to `~/.narrate`. */
export function globalSettingsPath(): string {
  const home = process.env.NARRATE_HOME?.trim() || resolve(homedir(), ".narrate");
  return resolve(home, GLOBAL_SETTINGS_FILE);
}

/** Default env var per provider — used only as a fallback when no key is in the
 *  settings file (handy for CI). Overridable via config.tts.apiKeyEnv. */
const KEY_ENV: Record<string, string | null> = {
  gemini: "NARRATE_GEMINI_API_KEY",
  elevenlabs: "NARRATE_ELEVENLABS_API_KEY",
  os: null,
  mock: null,
};

type Raw = Record<string, unknown>;

function isPlainObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge `over` onto `base`: nested objects merge key by key; anything else
 *  (scalars, arrays) in `over` replaces the base value. */
export function mergeSettings(base: Raw, over: Raw): Raw {
  const out: Raw = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k] as Raw, v) : v;
  }
  return out;
}

/** One settings file that contributed to the effective config. */
export interface ConfigLayer {
  scope: "global" | "project";
  path: string;
  raw: Raw;
}

export interface LoadedConfig {
  config: Config;
  /** Files that were found, lowest priority first. */
  layers: ConfigLayer[];
}

function readRaw(path: string): Raw {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isPlainObject(raw)) throw new Error(`Settings file is not a JSON object: ${path}`);
  return raw;
}

/** The project settings file in use, if any (an explicit --config, else the
 *  first existing default/legacy location). */
function projectSettingsFile(cwd: string, configPath?: string): string | undefined {
  if (configPath) {
    const p = resolve(cwd, configPath);
    if (!existsSync(p)) throw new Error(`Config file not found: ${p}`);
    return p;
  }
  return [
    settingsPath(cwd),
    // legacy locations, still honored so older projects keep working
    resolve(cwd, ".narrate", "narrate.config.json"),
    resolve(cwd, "narrate.config.json"),
  ].find((p) => existsSync(p));
}

/**
 * Load the effective config: defaults ← global `~/.narrate/settings.json` ←
 * project `.narrate/settings.local.json` (or `--config`). The raw JSON layers are
 * merged *before* parsing, so the schema's defaults only fill what neither file
 * sets — a project file never clobbers global values with defaults.
 */
export function loadConfigLayers(
  cwd: string,
  configPath?: string,
  globalPath: string = globalSettingsPath(),
): LoadedConfig {
  const layers: ConfigLayer[] = [];
  if (existsSync(globalPath)) {
    layers.push({ scope: "global", path: globalPath, raw: readRaw(globalPath) });
  }
  const projectPath = projectSettingsFile(cwd, configPath);
  if (projectPath && resolve(projectPath) !== resolve(globalPath)) {
    layers.push({ scope: "project", path: projectPath, raw: readRaw(projectPath) });
  }
  const merged = layers.reduce<Raw>((acc, l) => mergeSettings(acc, l.raw), {});
  // zod strips unknown keys, so an editor-only `$schema` is dropped here.
  return { config: ConfigSchema.parse(merged), layers };
}

export function loadConfig(cwd: string, configPath?: string): Config {
  return loadConfigLayers(cwd, configPath).config;
}

/** Which layer set a dotted key path (e.g. "tts.provider"), or "default". */
export function settingOrigin(
  layers: ConfigLayer[],
  keyPath: string,
): "global" | "project" | "default" {
  for (const layer of [...layers].reverse()) {
    let node: unknown = layer.raw;
    for (const part of keyPath.split(".")) {
      node = isPlainObject(node) ? node[part] : undefined;
    }
    if (node !== undefined) return layer.scope;
  }
  return "default";
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
 *  Precedence: the key in the settings (project over global), then the env fallback. */
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
      `Run \`narrate set-key ${provider} <key>\` to save it in your global settings ` +
      `(~/.narrate/${GLOBAL_SETTINGS_FILE})${envName ? `, or set ${envName}` : ""}.`,
  );
}
