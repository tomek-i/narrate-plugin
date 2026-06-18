import { join } from "node:path";
import type { Browser, BrowserType, Page } from "playwright";
import { installChromium } from "../setup.js";
import type { Config, Durations, OverlayConfig, Scene, Step } from "../types.js";
import { OVERLAY_SCRIPT } from "./overlay.js";
import type { RecordResult, Recorder } from "./recorder.js";

/** Shape of the in-page overlay API injected by OVERLAY_SCRIPT. */
interface NarrateOverlay {
  pointAt(selector: string, durMs: number): boolean;
  ripple(selector?: string | null): void;
  highlight(selector: string, opts: { style?: string; label?: string; hold?: number }): boolean;
  unhighlight(selector?: string | null): void;
}
declare global {
  interface Window {
    __narrate?: NarrateOverlay;
    __NARRATE_COLOR?: string;
  }
}

type HighlightStyle = "ring" | "glow" | "spotlight";

/**
 * Load Playwright lazily so the bundled CLI can run TTS-only paths (and `narrate
 * setup`) without it installed. Throws a friendly error pointing at setup.
 */
/**
 * Launch a Chromium-based browser, preferring one already installed on the
 * machine (Edge, then Chrome) so we avoid downloading Playwright's Chromium.
 * Falls back to downloading Chromium only if no system browser is found.
 */
async function launchBrowser(chromium: BrowserType): Promise<Browser> {
  const attempts: Array<{ channel?: "msedge" | "chrome" }> = [
    {}, // Playwright's Chromium, if already downloaded
    { channel: "msedge" }, // preinstalled on Windows
    { channel: "chrome" },
  ];
  let lastErr: unknown;
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch (err) {
      lastErr = err;
    }
  }
  try {
    installChromium();
    return await chromium.launch();
  } catch {
    throw lastErr;
  }
}

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
    const browser = await launchBrowser(chromium);
    const context = await browser.newContext({
      viewport: size,
      recordVideo: { dir: join(this.outDir, "video"), size },
      deviceScaleFactor: 1,
      // Emulate the OS/browser color scheme (the standard `prefers-color-scheme`).
      // Sites with a manual toggle should drive it with a click/menu step instead.
      ...(scene.theme ? { colorScheme: COLOR_SCHEME[scene.theme] } : {}),
    });
    // Inject the synthetic-cursor + highlight overlay (if either is enabled) so
    // it's present on every page/navigation. It's inert until the steps call it.
    const fx = this.config.overlay;
    if (fx.cursor || fx.highlight) {
      await context.addInitScript(`window.__NARRATE_COLOR=${JSON.stringify(fx.color)};`);
      await context.addInitScript(OVERLAY_SCRIPT);
    }

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
        // Briefly pulse the beat's focus element (auto-fades after holdMs).
        if (fx.highlight && beat.focus) {
          await applyHighlight(
            page,
            beat.focus,
            beat.focusStyle ?? fx.style,
            fx.holdMs,
            beat.focusLabel,
          );
        }
        for (const step of beat.do) await runStep(page, step, fx);
        // Pad (or warn) so the beat ends exactly on the audio boundary.
        const remaining = targetEnd - (Date.now() - t0);
        if (remaining > 0) await page.waitForTimeout(remaining);
        else if (remaining < -150) {
          // visuals overran the narration — sync will drift for later beats
          console.warn(
            `[narrate] beat "${beat.id}" visuals overran narration by ${-remaining}ms; shorten its steps or lengthen the narration.`,
          );
        }
        // Clear everything between beats for a predictable, clean slate.
        if (fx.highlight) await clearHighlight(page);
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

// --- overlay drivers (call the injected window.__narrate API) -----------------

const POINT_MS = 450; // synthetic-cursor glide duration

/** Glide the synthetic cursor onto a selector and wait for the animation. */
async function pointTo(page: Page, selector: string): Promise<void> {
  const moved = await page
    .evaluate(([sel, dur]) => Boolean(window.__narrate?.pointAt(sel as string, dur as number)), [
      selector,
      POINT_MS,
    ] as const)
    .catch(() => false);
  if (moved) await page.waitForTimeout(POINT_MS + 30);
}

/** Emit a click ripple at a selector (or the cursor's last position). */
async function ripple(page: Page, selector?: string): Promise<void> {
  await page.evaluate((sel) => window.__narrate?.ripple(sel), selector ?? null).catch(() => {});
}

async function applyHighlight(
  page: Page,
  selector: string,
  style: HighlightStyle,
  holdMs: number,
  label?: string,
): Promise<void> {
  await page
    .evaluate(
      (o) =>
        window.__narrate?.highlight(o.selector, { style: o.style, label: o.label, hold: o.hold }),
      { selector, style, label, hold: holdMs },
    )
    .catch(() => {});
}

/** Clear one highlight (by selector) or all of them. */
async function clearHighlight(page: Page, selector?: string): Promise<void> {
  await page
    .evaluate((sel) => window.__narrate?.unhighlight(sel), selector ?? null)
    .catch(() => {});
}

async function runStep(page: Page, step: Step, fx: OverlayConfig): Promise<void> {
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
      if (fx.cursor) await pointTo(page, step.selector);
      await page.click(step.selector);
      if (fx.cursor) await ripple(page, step.selector);
      await settle(page);
      return;
    case "dblclick":
      if (fx.cursor) await pointTo(page, step.selector);
      await page.dblclick(step.selector);
      if (fx.cursor) await ripple(page, step.selector);
      await settle(page);
      return;
    case "hover":
      if (fx.cursor) await pointTo(page, step.selector);
      await page.hover(step.selector);
      return;
    case "dragTo":
      if (fx.cursor) await pointTo(page, step.from);
      await page.dragAndDrop(step.from, step.to);
      return;

    // --- keyboard / forms ---
    case "fill":
      if (fx.cursor) await pointTo(page, step.selector);
      await page.fill(step.selector, step.text);
      return;
    case "type":
      if (fx.cursor) await pointTo(page, step.selector);
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
      if (fx.cursor) await pointTo(page, step.selector);
      await page.selectOption(
        step.selector,
        step.label !== undefined ? { label: step.label } : { value: step.value ?? "" },
      );
      return;
    case "check":
      if (fx.cursor) await pointTo(page, step.selector);
      await page.check(step.selector);
      return;
    case "uncheck":
      if (fx.cursor) await pointTo(page, step.selector);
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

    // --- highlighting / pointer ---
    case "highlight":
      if (fx.highlight) {
        await applyHighlight(
          page,
          step.selector,
          step.style ?? fx.style,
          step.hold ?? fx.holdMs,
          step.label,
        );
      }
      return;
    case "unhighlight":
      if (fx.highlight) await clearHighlight(page, step.selector);
      return;
    case "point":
      if (fx.cursor) await pointTo(page, step.selector);
      return;

    // --- convenience / escape hatch ---
    case "menu":
      if (fx.cursor) await pointTo(page, step.trigger);
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
