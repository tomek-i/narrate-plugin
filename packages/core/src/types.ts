import { z } from "zod";

/**
 * A single timed action performed within a beat. Selectors are real Playwright
 * selectors (CSS, text=, role=, etc.). This set aims to cover most flows so the
 * `eval` escape hatch is rarely needed.
 */
export const StepSchema = z.discriminatedUnion("action", [
  // --- timing ---
  z.object({ action: z.literal("wait"), ms: z.number().positive() }),
  z.object({
    action: z.literal("waitFor"),
    selector: z.string(),
    state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible"),
  }),
  z.object({ action: z.literal("waitForUrl"), url: z.string() }), // string or glob

  // --- navigation ---
  z.object({ action: z.literal("navigate"), url: z.string() }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("forward") }),
  z.object({ action: z.literal("reload") }),

  // --- mouse ---
  z.object({ action: z.literal("click"), selector: z.string() }),
  z.object({ action: z.literal("dblclick"), selector: z.string() }),
  z.object({ action: z.literal("hover"), selector: z.string() }),
  z.object({ action: z.literal("dragTo"), from: z.string(), to: z.string() }),

  // --- keyboard / forms ---
  // fill = set value instantly; type = key-by-key (more lifelike for demos).
  z.object({ action: z.literal("fill"), selector: z.string(), text: z.string() }),
  z.object({
    action: z.literal("type"),
    selector: z.string(),
    text: z.string(),
    delay: z.number().min(0).default(60),
  }),
  z.object({ action: z.literal("clear"), selector: z.string() }),
  z.object({ action: z.literal("press"), key: z.string(), selector: z.string().optional() }),
  z.object({
    action: z.literal("selectOption"),
    selector: z.string(),
    value: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({ action: z.literal("check"), selector: z.string() }),
  z.object({ action: z.literal("uncheck"), selector: z.string() }),
  z.object({ action: z.literal("focus"), selector: z.string() }),
  z.object({ action: z.literal("blur"), selector: z.string() }),
  z.object({
    action: z.literal("uploadFile"),
    selector: z.string(),
    files: z.array(z.string()).min(1),
  }),

  // --- scrolling (smoothly animated over `over` ms) ---
  z.object({ action: z.literal("scrollTo"), y: z.number(), over: z.number().min(0).default(0) }),
  z.object({
    action: z.literal("scrollThrough"),
    selector: z.string().optional(),
    over: z.number().positive().default(4000),
  }),
  z.object({
    action: z.literal("scrollIntoView"),
    selector: z.string(),
    over: z.number().min(0).default(800),
  }),

  // --- highlighting / pointer (injected overlay; see config.overlay) ---
  // Draw attention to an element. `style` overrides the config default; `label`
  // adds a small caption. Stays until an `unhighlight` step or the beat ends.
  z.object({
    action: z.literal("highlight"),
    selector: z.string(),
    style: z.enum(["ring", "glow", "spotlight"]).optional(),
    label: z.string().optional(),
    /** ms to show before auto-fading (default: config.overlay.holdMs). 0 = until
     *  `unhighlight` or the beat ends. */
    hold: z.number().min(0).optional(),
  }),
  // Remove a specific highlight (by selector) or all of them (no selector).
  z.object({ action: z.literal("unhighlight"), selector: z.string().optional() }),
  // Glide the synthetic cursor onto an element (no click).
  z.object({ action: z.literal("point"), selector: z.string() }),

  // --- convenience / escape hatch ---
  // Click a trigger, then a menu item by visible text (e.g. a theme dropdown).
  z.object({ action: z.literal("menu"), trigger: z.string(), item: z.string() }),
  // Run arbitrary JS in the page (body of an async function).
  z.object({ action: z.literal("eval"), fn: z.string() }),
]);
export type Step = z.infer<typeof StepSchema>;

/** A narrated segment: one line of speech + the visuals shown while it plays. */
export const BeatSchema = z.object({
  id: z.string(),
  say: z.string(),
  /** Optional per-beat voice override (provider-specific id/name). */
  voice: z.string().optional(),
  /**
   * Selector to highlight for this beat's whole duration (auto-cleared at the
   * end). The natural way to spotlight the thing the narration is talking about.
   */
  focus: z.string().optional(),
  /** Override the highlight style for `focus` (else uses config.overlay.style). */
  focusStyle: z.enum(["ring", "glow", "spotlight"]).optional(),
  /** Optional caption shown next to the focused element. */
  focusLabel: z.string().optional(),
  do: z.array(StepSchema).default([]),
});
export type Beat = z.infer<typeof BeatSchema>;

/**
 * Authenticated walkthroughs. Point `storageState` at a Playwright storage-state
 * JSON (cookies + localStorage) captured once by logging in yourself — the
 * recorder loads it so it starts already signed in and never sees the login
 * screen or any credential. The file holds session tokens, so keep it gitignored
 * (e.g. under `.narrate/`). This is the safe alternative to typing real
 * credentials into a scene; see the `${ENV_VAR}` support on `fill`/`type` for the
 * cases where you do want to drive a login form without putting secrets in the file.
 */
export const AuthSchema = z.object({
  /** Path to a Playwright storageState JSON, resolved relative to the cwd. */
  storageState: z.string(),
});
export type Auth = z.infer<typeof AuthSchema>;

/** A full walkthrough: where to go, how big, and the ordered beats. */
export const SceneSchema = z.object({
  name: z.string().default("scene"),
  site: z.string(),
  viewport: z
    .object({ width: z.number().default(1440), height: z.number().default(900) })
    .default({ width: 1440, height: 900 }),
  theme: z.enum(["light", "dark", "system"]).optional(),
  /** Start already authenticated by loading a saved Playwright storage state. */
  auth: AuthSchema.optional(),
  beats: z.array(BeatSchema).min(1),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ConfigSchema = z.object({
  /**
   * TTS settings. `provider` selects the engine; per-provider settings (voice,
   * model, key, …) are nested under their own block so each can differ. Keys live
   * here too — `.narrate/` is gitignored, so they're never committed. Only the
   * active provider's block is used; the others may sit pre-filled but unused.
   */
  tts: z
    .object({
      // Default to the OS's built-in voice so a fresh install works with no key.
      // Upgrade to a cloud voice (gemini/elevenlabs) via `narrate set-key`.
      provider: z.enum(["gemini", "elevenlabs", "os", "mock"]).default("os"),
      gemini: z
        .object({
          key: z.string().optional(),
          voice: z.string().default("Kore"),
          model: z.string().default("gemini-2.5-flash-preview-tts"),
          /** Env var to read the key from if `key` is empty (CI fallback). */
          apiKeyEnv: z.string().optional(),
        })
        .default({}),
      elevenlabs: z
        .object({
          key: z.string().optional(),
          // "Will" — a default voice confirmed usable on the free API tier. (Many
          // other "default" ids, e.g. Aria, 402 on free plans.) Run `narrate voices`
          // to list what your key can use.
          voice: z.string().default("bIHbv24MWmeRgasZH58o"),
          model: z.string().default("eleven_multilingual_v2"),
          /** Env var to read the key from if `key` is empty (CI fallback). */
          apiKeyEnv: z.string().optional(),
        })
        .default({}),
    })
    .default({ provider: "os" }),
  output: z
    .object({
      dir: z.string().default("out"),
      width: z.number().default(1440),
      height: z.number().default(900),
      fps: z.number().default(25),
      format: z.enum(["mp4", "webm"]).default("mp4"),
      /** Encode quality (x264/vp9 CRF). Lower = higher quality/less banding. */
      crf: z.number().default(16),
      /**
       * Also write a WebVTT caption track (`<name>.vtt`) next to the video, one
       * cue per beat timed to the narration. Useful as subtitles or a readable
       * transcript of what was said. Off by default.
       */
      vtt: z.boolean().default(false),
      /**
       * Keep a copy of the scene file (`<name>.scene.json`) next to the video so
       * the walkthrough can be re-rendered or edited later. Off by default.
       */
      keepScene: z.boolean().default(false),
    })
    .default({
      dir: "out",
      width: 1440,
      height: 900,
      fps: 25,
      format: "mp4",
      crf: 16,
      vtt: false,
      keepScene: false,
    }),
  /**
   * On-screen overlays injected into the recorded page (never the real cursor).
   * All on by default for a richer demo; flip any flag off to disable it.
   */
  overlay: z
    .object({
      /** Glide a synthetic cursor onto elements before click/hover/type. */
      cursor: z.boolean().default(true),
      /** Enable element highlighting (`highlight` step + beat `focus`). */
      highlight: z.boolean().default(true),
      /** Default highlight style when a step/beat doesn't specify one. */
      style: z.enum(["ring", "glow", "spotlight"]).default("ring"),
      /**
       * How long a highlight/focus stays before fading back to the clean page
       * (ms). Short by design — a brief pulse grabs attention without obscuring
       * the page for the whole beat. Per-`highlight`-step `hold` overrides it.
       */
      holdMs: z.number().min(0).default(3000),
      /** Accent color (CSS) for the cursor, ripple, and highlights. */
      color: z.string().default("#6366f1"),
    })
    .default({ cursor: true, highlight: true, style: "ring", holdMs: 3000, color: "#6366f1" }),
});
export type Config = z.infer<typeof ConfigSchema>;
export type OverlayConfig = Config["overlay"];

export type Durations = Record<string, number>; // beatId -> seconds
