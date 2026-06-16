import { join } from "node:path";
import type { Browser, Page } from "playwright";
import type { Config, Durations, Scene, Step } from "../types.js";
import type { RecordResult, Recorder } from "./recorder.js";

/**
 * Load Playwright lazily so the bundled CLI can run TTS-only paths (and `narrate
 * setup`) without it installed. Throws a friendly error pointing at setup.
 */
async function loadChromium() {
  try {
    const pw = await import("playwright");
    return pw.chromium;
  } catch {
    throw new Error(
      "Playwright is not installed. Run `narrate setup` once to install it " +
        "and the Chromium browser, then retry.",
    );
  }
}

/**
 * Records the whole scene in ONE continuous browser session — no Claude in the
 * loop, no inter-call gaps — so the video timeline tracks wall-clock and each
 * beat occupies exactly its narration duration. That makes audio sync trivial.
 */
export class PlaywrightRecorder implements Recorder {
  constructor(
    private outDir: string,
    private config: Config,
  ) {}

  async record(scene: Scene, durations: Durations): Promise<RecordResult> {
    const size = { width: scene.viewport.width, height: scene.viewport.height };
    const chromium = await loadChromium();
    const browser: Browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: size,
      recordVideo: { dir: join(this.outDir, "video"), size },
      deviceScaleFactor: 1,
    });
    const contextStart = Date.now();
    const page = await context.newPage();

    try {
      await page.goto(scene.site, { waitUntil: "networkidle" });
      if (scene.theme) await applyTheme(page, scene.theme);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400); // let fonts/layout settle

      // Timeline origin: everything before this is lead-in to be trimmed.
      const t0 = Date.now();
      const leadInMs = t0 - contextStart;

      let targetEnd = 0; // cumulative ms from t0 each beat must END at
      for (const beat of scene.beats) {
        const durMs = Math.round((durations[beat.id] ?? 3) * 1000);
        targetEnd += durMs;
        for (const step of beat.do) await runStep(page, step);
        // Pad (or warn) so the beat ends exactly on the audio boundary.
        const remaining = targetEnd - (Date.now() - t0);
        if (remaining > 0) await page.waitForTimeout(remaining);
        else if (remaining < -150) {
          // visuals overran the narration — sync will drift for later beats
          console.warn(
            `[narrate] beat "${beat.id}" visuals overran narration by ${-remaining}ms; shorten its steps or lengthen the narration.`,
          );
        }
      }

      const video = page.video();
      await context.close(); // finalizes the webm
      const videoPath = video ? await video.path() : "";
      return { videoPath, leadInMs };
    } finally {
      await browser.close();
    }
  }
}

async function applyTheme(page: Page, theme: "light" | "dark" | "system"): Promise<void> {
  await page.evaluate((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
    const el = document.documentElement;
    el.classList.remove("light", "dark");
    if (t !== "system") el.classList.add(t);
    (el.style as CSSStyleDeclaration).colorScheme = t;
  }, theme);
}

async function runStep(page: Page, step: Step): Promise<void> {
  switch (step.action) {
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
    case "navigate":
      await page.goto(step.url, { waitUntil: "networkidle" });
      return;
    case "click":
      await page.click(step.selector);
      await page.waitForLoadState("networkidle").catch(() => {});
      return;
    case "scrollTo":
      await smoothScrollTo(page, step.y, step.over);
      return;
    case "scrollThrough": {
      const target = await page.evaluate((sel) => {
        if (sel) {
          const el = document.querySelector(sel);
          if (el) return el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
        }
        return document.body.scrollHeight - window.innerHeight;
      }, step.selector);
      await smoothScrollTo(page, Math.max(0, target), step.over);
      return;
    }
    case "menu":
      await page.click(step.trigger);
      await page.waitForTimeout(450);
      await page.getByRole("menuitem", { name: step.item }).click();
      await page.waitForTimeout(300);
      return;
    case "eval":
      // Scene config is local & trusted; `new Function` runs the step body in-page.
      await page.evaluate((body) => new Function(`return (async () => { ${body} })()`)(), step.fn);
      return;
  }
}

async function smoothScrollTo(page: Page, targetY: number, overMs: number): Promise<void> {
  await page.evaluate(
    async ({ targetY, overMs }) => {
      const start = window.scrollY;
      const dist = targetY - start;
      if (overMs <= 0) {
        window.scrollTo(0, targetY);
        return;
      }
      const steps = Math.max(1, Math.round(overMs / 40));
      for (let i = 1; i <= steps; i++) {
        window.scrollTo(0, start + dist * (i / steps));
        await new Promise((r) => setTimeout(r, overMs / steps));
      }
    },
    { targetY, overMs },
  );
}
