import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConfigSchema, SceneSchema } from "../src/types.js";

// Repo root = two levels up from packages/core/scripts.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const targets = [
  { schema: ConfigSchema, file: "narrate.schema.json" },
  { schema: SceneSchema, file: "narrate.scene.schema.json" },
] as const;

for (const t of targets) {
  // `io: "input"` describes what a user may write: fields with defaults are optional.
  const json = z.toJSONSchema(t.schema, {
    target: "draft-7",
    io: "input",
    // Input mode leaves objects open (zod strips unknown keys rather than
    // rejecting them); close them so editors flag typo'd keys.
    override: (ctx) => {
      if (ctx.jsonSchema.type === "object" && ctx.jsonSchema.properties) {
        ctx.jsonSchema.additionalProperties = false;
      }
    },
  });
  const out = join(repoRoot, t.file);
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote ${t.file}`);
}
