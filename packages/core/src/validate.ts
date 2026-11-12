import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { z } from "zod";
import { formatPath, resolveSceneSite } from "./config.js";
import { originOf } from "./record/origin-guard.js";
import { SCENE_SCHEMA_VERSION, type Scene, SceneSchema } from "./types.js";

/** One thing wrong with a scene, located by its JSON path (e.g. `beats[2].do[0]`). */
export interface Problem {
  path: string;
  message: string;
}

/** Origin of a URL, or null if it isn't an absolute URL. */
function safeOrigin(url: string): string | null {
  try {
    return originOf(url);
  } catch {
    return null;
  }
}

/** Names that are safe as a single file name: no separators, no `..`, no control characters. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The rules for an untrusted (generated) scene — `render --untrusted`. Anything
 * that could run code, read local files, write outside the output folder or
 * leave the site is rejected before anything is synthesized or recorded:
 * - `site` must be an http(s) URL (a `file:` site can show any local file);
 * - `name` and beat `id`s must be plain names (they end up in file names and captions);
 * - `eval` runs arbitrary JavaScript in the page;
 * - `uploadFile` reads any local file into the page;
 * - `navigate` to an origin other than `site`'s (or the caller's `allowedOrigins`).
 * The scene's own `allowedOrigins` don't count: a scene can't widen its own
 * allowlist. `site` must already be resolved to an absolute URL (as `loadScene` does).
 */
export function untrustedProblems(
  scene: Scene,
  opts: { allowedOrigins?: string[] } = {},
): Problem[] {
  const problems: Problem[] = [];
  if (!/^https?:\/\//i.test(scene.site)) {
    problems.push({
      path: "site",
      message: `an untrusted scene must use an http(s) site, not ${scene.site}`,
    });
  }
  if (!SAFE_NAME.test(scene.name)) {
    problems.push({
      path: "name",
      message: "must be a plain file name (letters, digits, . _ -) in an untrusted scene",
    });
  }
  scene.beats.forEach((beat, b) => {
    if (!SAFE_NAME.test(beat.id)) {
      problems.push({
        path: `beats[${b}].id`,
        message: "must be a plain name (letters, digits, . _ -) in an untrusted scene",
      });
    }
  });
  const allowed = new Set(
    [scene.site, ...(opts.allowedOrigins ?? [])]
      .map(safeOrigin)
      .filter((o): o is string => o !== null && o !== "file://"),
  );
  scene.beats.forEach((beat, b) => {
    beat.do.forEach((step, s) => {
      const path = `beats[${b}].do[${s}]`;
      const where = `beat "${beat.id}" step ${s + 1}`;
      if (step.action === "eval") {
        problems.push({
          path,
          message: `${where}: eval runs arbitrary JavaScript; not allowed in an untrusted scene`,
        });
      } else if (step.action === "uploadFile") {
        problems.push({
          path,
          message: `${where}: uploadFile reads local files; not allowed in an untrusted scene`,
        });
      } else if (step.action === "navigate") {
        let target: string | null = null;
        try {
          target = new URL(step.url, scene.site).href;
        } catch {
          // reported below as not allowed
        }
        const origin = target && safeOrigin(target);
        if (!origin || !allowed.has(origin)) {
          problems.push({
            path: `${path}.url`,
            message: `${where}: navigate to ${step.url} leaves the site's origin (${[...allowed].join(", ") || "none"}); not allowed in an untrusted scene`,
          });
        }
      }
    });
  });
  return problems;
}

/** Schema errors as problems, one per zod issue. */
export function schemaProblems(error: z.ZodError): Problem[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

/**
 * Checks beyond the schema that `render` applies to every scene: beat ids must
 * be unique (each beat's audio is stored and timed by its id), plus the
 * untrusted-mode rules when `untrusted` is on (or the scene sets it).
 */
export function sceneProblems(
  scene: Scene,
  opts: { untrusted?: boolean; allowedOrigins?: string[] } = {},
): Problem[] {
  const problems: Problem[] = [];
  const seen = new Map<string, number>();
  scene.beats.forEach((beat, b) => {
    const first = seen.get(beat.id);
    if (first !== undefined) {
      problems.push({
        path: `beats[${b}].id`,
        message: `duplicate beat id "${beat.id}" (also beats[${first}]); beat ids must be unique`,
      });
    } else {
      seen.set(beat.id, b);
    }
  });
  if (opts.untrusted || scene.untrusted) problems.push(...untrustedProblems(scene, opts));
  return problems;
}

export interface ValidationResult {
  ok: boolean;
  /** Bumped on incompatible scene-format changes, so callers can detect them. */
  schemaVersion: number;
  problems: Problem[];
}

/**
 * Validate a scene file the way `render` would, without a browser, ffmpeg, TTS
 * or any network access: JSON syntax, the scene schema, then `sceneProblems`.
 */
export function validateSceneFile(
  cwd: string,
  file: string,
  opts: { untrusted?: boolean; allowedOrigins?: string[] } = {},
): ValidationResult {
  const result = (problems: Problem[]): ValidationResult => ({
    ok: problems.length === 0,
    schemaVersion: SCENE_SCHEMA_VERSION,
    problems,
  });
  const p = resolve(cwd, file);
  if (!existsSync(p)) return result([{ path: "", message: `scene file not found: ${p}` }]);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    return result([
      { path: "", message: `not valid JSON: ${err instanceof Error ? err.message : err}` },
    ]);
  }
  const parsed = SceneSchema.safeParse(raw);
  if (!parsed.success) return result(schemaProblems(parsed.error));
  return result(sceneProblems(resolveSceneSite(parsed.data, p), opts));
}

/** Format problems as one indented line each, for an error message. */
export function formatProblems(problems: Problem[]): string {
  return problems.map((p) => `  ${p.path}: ${p.message}`).join("\n");
}
