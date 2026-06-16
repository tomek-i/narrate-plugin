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
  do: z.array(StepSchema).default([]),
});
export type Beat = z.infer<typeof BeatSchema>;

/** A full walkthrough: where to go, how big, and the ordered beats. */
export const SceneSchema = z.object({
  name: z.string().default("scene"),
  site: z.string(),
  viewport: z
    .object({ width: z.number().default(1440), height: z.number().default(900) })
    .default({ width: 1440, height: 900 }),
  theme: z.enum(["light", "dark", "system"]).optional(),
  beats: z.array(BeatSchema).min(1),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ConfigSchema = z.object({
  tts: z
    .object({
      provider: z.enum(["gemini", "elevenlabs", "os", "mock"]).default("gemini"),
      voice: z.string().default("Kore"),
      model: z.string().optional(),
      /** Override the env var name the API key is read from. */
      apiKeyEnv: z.string().optional(),
    })
    .default({ provider: "gemini", voice: "Kore" }),
  output: z
    .object({
      dir: z.string().default("out"),
      width: z.number().default(1440),
      height: z.number().default(900),
      fps: z.number().default(25),
      format: z.enum(["mp4", "webm"]).default("mp4"),
      /** Encode quality (x264/vp9 CRF). Lower = higher quality/less banding. */
      crf: z.number().default(16),
    })
    .default({ dir: "out", width: 1440, height: 900, fps: 25, format: "mp4", crf: 16 }),
});
export type Config = z.infer<typeof ConfigSchema>;

export type Durations = Record<string, number>; // beatId -> seconds
