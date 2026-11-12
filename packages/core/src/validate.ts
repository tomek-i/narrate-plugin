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

/**
 * The rules for an untrusted (generated) scene — `render --untrusted`. Steps that
 * can run code, read local files or leave the site are rejected before anything
 * is synthesized or recorded:
 * - `eval` runs arbitrary JavaScript in the page;
 * - `uploadFile` reads any local file into the page;
 * - `navigate` to an origin other than `site` (or `allowedOrigins`).
 * `site` must already be resolved to an absolute URL (as `loadScene` does).
 */
export function untrustedProblems(scene: Scene): Problem[] {
  const problems: Problem[] = [];
  const allowed = new Set(
    [scene.site, ...(scene.allowedOrigins ?? [])]
      .map(safeOrigin)
      .filter((o): o is string => o !== null),
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
