import { originOf } from "./record/origin-guard.js";
import type { Scene } from "./types.js";

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

/** Format problems as one indented line each, for an error message. */
export function formatProblems(problems: Problem[]): string {
  return problems.map((p) => `  ${p.path}: ${p.message}`).join("\n");
}
