import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalSettingsPath } from "./config.js";
import { packageVersion } from "./setup.js";

/**
 * A stable way to run the CLI outside Claude Code. The plugin's own copy lives
 * under a versioned cache folder (`…/plugins/cache/<marketplace>/narrate/<version>/`),
 * so `~/.narrate/bin/` holds small launchers that forward to it instead:
 * `narrate.mjs` (run with node), plus `narrate` (sh) and `narrate.cmd` (Windows).
 *
 * At run time `narrate.mjs` asks Claude Code which narrate version is installed
 * (`~/.claude/plugins/installed_plugins.json`), so an update takes effect at
 * once. If that record can't be read, it runs the bundle it was written for.
 * The plugin's CLI rewrites the launchers when it is newer than that bundle.
 */
export function launcherDir(): string {
  return join(dirname(globalSettingsPath()), "bin");
}

/** The CLI bundle this code is running from, or null when run from source. */
export function runningBundle(): string | null {
  const self = fileURLToPath(import.meta.url);
  return self.endsWith(".mjs") || self.endsWith(".js") ? self : null;
}

/** True for a bundle inside Claude Code's plugin cache (not a dev checkout). */
export function isInstalledPlugin(bundle: string): boolean {
  return /[\\/]plugins[\\/]cache[\\/]/.test(bundle);
}

/** -1, 0 or 1 comparing dotted version numbers (`0.9.0` < `0.23.0`). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Single-quote a string for sh: `'` becomes `'\''`. */
function shQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function launcherFiles(target: string, version: string, dir: string): Record<string, string> {
  return {
    "narrate.mjs": `#!/usr/bin/env node
// Written by narrate ${version}: runs the narrate CLI that Claude Code has
// installed, so this path stays the same across plugin updates. Don't edit;
// the plugin rewrites it.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const fallback = ${JSON.stringify(target)};

/** The installed plugin's bundle, per Claude Code's own install record. */
function installed() {
  try {
    const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
    const record = JSON.parse(readFileSync(join(home, "plugins", "installed_plugins.json"), "utf8"));
    const installs = Object.entries(record.plugins ?? {})
      .filter(([key, list]) => key.startsWith("narrate@") && Array.isArray(list))
      .flatMap(([, list]) => list)
      .sort((a, b) => (a?.scope === "user" ? 0 : 1) - (b?.scope === "user" ? 0 : 1));
    for (const install of installs) {
      if (typeof install?.installPath !== "string") continue;
      const bundle = join(install.installPath, "bin", "narrate.mjs");
      if (existsSync(bundle)) return bundle;
    }
  } catch {
    // No readable record: use the bundle this launcher was written for.
  }
  return null;
}

const target = installed() ?? fallback;
if (!existsSync(target)) {
  console.error(
    \`narrate: \${target} no longer exists (the plugin was updated or removed). Run any narrate command or skill from Claude Code once to update this launcher.\`,
  );
  process.exit(1);
}
await import(pathToFileURL(target).href);
`,
    // The launcher folder is written in, so a symlink to this script still works.
    narrate: `#!/bin/sh
exec node ${shQuote(join(dir, "narrate.mjs"))} "$@"
`,
    "narrate.cmd": `@echo off\r\nnode "%~dp0narrate.mjs" %*\r\n`,
  };
}

/**
 * Write a file atomically (temp file + rename), so a narrate run starting at the
 * same moment never reads a half-written launcher. Falls back to a direct write
 * where the rename is refused (e.g. antivirus holding the file on Windows).
 */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  } catch {
    rmSync(tmp, { force: true });
    writeFileSync(file, content);
  }
}

/**
 * Write the launchers so they fall back to `target` (an absolute path to the CLI
 * bundle, at `version`). Files already up to date are left alone. Returns
 * whether any changed.
 */
export function writeLaunchers(target: string, version: string, dir = launcherDir()): boolean {
  let changed = false;
  for (const [name, content] of Object.entries(launcherFiles(target, version, dir))) {
    const file = join(dir, name);
    if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
    mkdirSync(dir, { recursive: true });
    writeAtomic(file, content);
    if (name !== "narrate.cmd") chmodSync(file, 0o755);
    changed = true;
  }
  return changed;
}

/** The bundle and version an existing `narrate.mjs` launcher was written for. */
export function launcherTarget(dir = launcherDir()): { target: string; version: string } | null {
  try {
    const text = readFileSync(join(dir, "narrate.mjs"), "utf8");
    const version = /Written by narrate (\S+):/.exec(text)?.[1];
    const target = /^const fallback = (".*");$/m.exec(text)?.[1];
    return version && target ? { target: JSON.parse(target), version } : null;
  } catch {
    return null;
  }
}

/**
 * Whether a CLI at `version` should take over the launchers: when there are
 * none, they're from an older narrate, or their bundle is gone. An older version
 * still running (e.g. in a Claude Code session started before an update) must
 * not take them back.
 */
export function shouldRefresh(version: string, dir = launcherDir()): boolean {
  const current = launcherTarget(dir);
  if (!current || !existsSync(current.target)) return true;
  return compareVersions(version, current.version) >= 0;
}

/**
 * Point the launchers at this CLI if it's the installed plugin and not older
 * than what they run. Best effort and silent: it runs before every command, so
 * it must never fail one or print (`render --json` keeps stdout to its result).
 */
export function refreshLaunchers(dir = launcherDir()): void {
  const bundle = runningBundle();
  if (!bundle || !isInstalledPlugin(bundle)) return;
  try {
    const version = packageVersion();
    if (shouldRefresh(version, dir)) writeLaunchers(bundle, version, dir);
  } catch {
    // A read-only or missing home folder only costs the stable path, not the command.
  }
}
