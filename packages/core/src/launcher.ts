import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalSettingsPath } from "./config.js";

/**
 * A stable way to run the CLI outside Claude Code. The plugin's own copy lives
 * under a versioned cache folder (`…/plugins/cache/<marketplace>/narrate/<version>/`),
 * so `~/.narrate/bin/` holds small launchers that forward to it instead:
 * `narrate.mjs` (run with node), plus `narrate` (sh) and `narrate.cmd` (Windows).
 * Whenever the plugin's CLI runs it points them at itself, so after a plugin
 * update they follow the new version as soon as it runs once.
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

function launcherFiles(target: string): Record<string, string> {
  return {
    "narrate.mjs": `#!/usr/bin/env node
// Written by narrate: forwards to the installed CLI, so this path stays the same
// across plugin updates. Rewritten whenever the plugin's CLI runs; don't edit.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const target = ${JSON.stringify(target)};
if (!existsSync(target)) {
  console.error(
    \`narrate: \${target} no longer exists (the plugin was updated or removed). Use any narrate skill in Claude Code once, or run the new version's \\\`narrate setup\\\`, to update this launcher.\`,
  );
  process.exit(1);
}
await import(pathToFileURL(target).href);
`,
    narrate: `#!/bin/sh
exec node "$(dirname "$0")/narrate.mjs" "$@"
`,
    "narrate.cmd": `@echo off\r\nnode "%~dp0narrate.mjs" %*\r\n`,
  };
}

/**
 * Write the launchers so they run `target` (an absolute path to the CLI bundle).
 * Files that are already up to date are left alone. Returns whether any changed.
 */
export function writeLaunchers(target: string, dir = launcherDir()): boolean {
  let changed = false;
  for (const [name, content] of Object.entries(launcherFiles(target))) {
    const file = join(dir, name);
    if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, content);
    if (name !== "narrate.cmd") chmodSync(file, 0o755);
    changed = true;
  }
  return changed;
}

/**
 * Point the launchers at this CLI if it's the installed plugin. Best effort and
 * silent: it runs before every command, so it must never fail one or print
 * (`render --json` keeps stdout to its result).
 */
export function refreshLaunchers(): void {
  const bundle = runningBundle();
  if (!bundle || !isInstalledPlugin(bundle)) return;
  try {
    writeLaunchers(bundle);
  } catch {
    // A read-only or missing home folder only costs the stable path, not the command.
  }
}
