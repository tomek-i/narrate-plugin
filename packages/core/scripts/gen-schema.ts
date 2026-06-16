import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ConfigSchema, SceneSchema } from "../src/types.js";

// Repo root = two levels up from packages/core/scripts.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const targets = [
  { schema: ConfigSchema, name: "Config", file: "narrate.schema.json" },
  { schema: SceneSchema, name: "Scene", file: "narrate.scene.schema.json" },
] as const;

for (const t of targets) {
  const json = zodToJsonSchema(t.schema, { name: t.name, $refStrategy: "none" });
  const out = join(repoRoot, t.file);
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote ${t.file}`);
}
