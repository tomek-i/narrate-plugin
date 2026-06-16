import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { installChromium } from "../setup.js";
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
    let browser: Browser;
    try {
      browser = await chromium.launch();
    } catch (err) {
      // Package present but the browser binary is missing — fetch it and retry once.
      if (/Executable doesn't exist|playwright install/i.test(String(err))) {
        installChromium();
        browser = await chromium.launch();
      } else throw err;
    }
    const context = await browser.newContext({
      viewport: size,
      recordVideo: { dir: join(this.outDir, "video"), size },
      deviceScaleFactor: 1,
      // Emulate the OS/browser color scheme (the standard `prefers-color-scheme`).
      // Sites with a manual toggle should drive it with a click/menu step instead.
      ...(scene.theme ? { colorScheme: COLOR_SCHEME[scene.theme] } : {}),
    });
    const contextStart = Date.now();
    const page = await context.newPage();

    try {
      await page.goto(scene.site, { waitUntil: "networkidle" });
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

/** Map a scene `theme` to Playwright's `prefers-color-scheme` emulation value. */
const COLOR_SCHEME = {
  light: "light",
  dark: "dark",
  system: "no-preference",
} as const;

// Steps that may trigger a navigation; swallow networkidle timeouts on SPAs.
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function runStep(page: Page, step: Step): Promise<void> {
  switch (step.action) {
    // --- timing ---
    case "wait":
      await page.waitForTimeout(step.ms);
      return;
    case "waitFor":
      await page.waitForSelector(step.selector, { state: step.state });
      return;
    case "waitForUrl":
      await page.waitForURL(step.url);
      return;

    // --- navigation ---
    case "navigate":
      await page.goto(step.url, { waitUntil: "networkidle" });
      return;
    case "back":
      await page.goBack().catch(() => {});
      await settle(page);
      return;
    case "forward":
      await page.goForward().catch(() => {});
      await settle(page);
      return;
    case "reload":
      await page.reload({ waitUntil: "networkidle" });
      return;

    // --- mouse ---
    case "click":
      await page.click(step.selector);
      await settle(page);
      return;
    case "dblclick":
      await page.dblclick(step.selector);
      await settle(page);
      return;
    case "hover":
      await page.hover(step.selector);
      return;
    case "dragTo":
      await page.dragAndDrop(step.from, step.to);
      return;

    // --- keyboard / forms ---
    case "fill":
      await page.fill(step.selector, step.text);
      return;
    case "type":
      await page.locator(step.selector).pressSequentially(step.text, { delay: step.delay });
      return;
    case "clear":
      await page.fill(step.selector, "");
      return;
    case "press":
      if (step.selector) await page.press(step.selector, step.key);
      else await page.keyboard.press(step.key);
      await settle(page);
      return;
    case "selectOption":
      await page.selectOption(
        step.selector,
        step.label !== undefined ? { label: step.label } : { value: step.value ?? "" },
      );
      return;
    case "check":
      await page.check(step.selector);
      return;
    case "uncheck":
      await page.uncheck(step.selector);
      return;
    case "focus":
      await page.focus(step.selector);
      return;
    case "blur":
      await page.locator(step.selector).blur();
      return;
    case "uploadFile":
      await page.setInputFiles(step.selector, step.files);
      return;

    // --- scrolling ---
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
    case "scrollIntoView": {
      const target = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.top + window.scrollY - (window.innerHeight - r.height) / 2;
      }, step.selector);
      if (target !== null) await smoothScrollTo(page, Math.max(0, target), step.over);
      return;
    }

    // --- convenience / escape hatch ---
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
