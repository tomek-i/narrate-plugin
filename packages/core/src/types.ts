import { z } from "zod";

/** A single timed action performed within a beat. */
export const StepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("wait"), ms: z.number().positive() }),
  z.object({ action: z.literal("navigate"), url: z.string() }),
  z.object({ action: z.literal("click"), selector: z.string() }),
  z.object({ action: z.literal("scrollTo"), y: z.number(), over: z.number().min(0).default(0) }),
  z.object({
    action: z.literal("scrollThrough"),
    selector: z.string().optional(),
    over: z.number().positive().default(4000),
  }),
  // Click a trigger, then click a menu item by visible text (e.g. a theme dropdown).
  z.object({ action: z.literal("menu"), trigger: z.string(), item: z.string() }),
  // Escape hatch: run arbitrary JS in the page (body of an async function).
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
      provider: z.enum(["gemini", "elevenlabs", "mock"]).default("gemini"),
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
    })
    .default({ dir: "out", width: 1440, height: 900, fps: 25, format: "mp4" }),
});
export type Config = z.infer<typeof ConfigSchema>;

export type Durations = Record<string, number>; // beatId -> seconds
