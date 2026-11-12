import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCENE_SCHEMA_VERSION } from "../src/types.js";
import { validateSceneFile } from "../src/validate.js";
import { tempDir } from "./helpers.js";

const tmp = tempDir("narrate-validate-");
after(() => tmp.cleanup());

function sceneFile(name: string, content: unknown): string {
  const p = join(tmp.dir, name);
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
  return p;
}

const valid = {
  $schema: "https://example.com/schema.json",
  site: "demo/index.html",
  beats: [{ id: "intro", say: "Hello", do: [{ action: "wait", ms: 500 }] }],
};

test("a valid scene has no problems and reports the schema version", () => {
  const r = validateSceneFile(tmp.dir, sceneFile("ok.json", valid));
  assert.deepEqual(r, { ok: true, schemaVersion: SCENE_SCHEMA_VERSION, problems: [] });
});

const invalid: Array<[string, unknown, string[]]> = [
  ["bad JSON", "{ nope", [""]],
  ["no beats", { site: "x", beats: [] }, ["beats"]],
  [
    "bad steps",
    {
      site: "x",
      beats: [
        {
          id: "a",
          say: "x",
          do: [{ action: "wait", ms: -1 }, { action: "teleport" }, { action: "click" }],
        },
      ],
    },
    ["beats[0].do[0].ms", "beats[0].do[1].action", "beats[0].do[2].selector"],
  ],
  [
    "duplicate beat ids",
    {
      site: "x",
      beats: [
        { id: "a", say: "x" },
        { id: "a", say: "y" },
      ],
    },
    ["beats[1].id"],
  ],
  [
    "untrusted scene with eval",
    {
      site: "http://localhost:3000",
      untrusted: true,
      beats: [{ id: "a", say: "x", do: [{ action: "eval", fn: "1" }] }],
    },
    ["beats[0].do[0]"],
  ],
  [
    "unknown keys (typos)",
    {
      site: "x",
      untrused: true,
      beats: [
        {
          id: "a",
          say: "x",
          focusLable: "y",
          do: [{ action: "click", selector: "#a", selectr: "#b" }],
        },
      ],
    },
    ["untrused", "beats[0].focusLable", "beats[0].do[0].selectr"],
  ],
  [
    "a saved session that doesn't exist",
    { site: "x", auth: { storageState: "missing-auth.json" }, beats: [{ id: "a", say: "x" }] },
    ["auth.storageState"],
  ],
];

for (const [name, content, paths] of invalid) {
  test(`invalid: ${name} → a path per problem`, () => {
    const r = validateSceneFile(tmp.dir, sceneFile(`${name}.json`, content));
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.problems.map((p) => p.path),
      paths,
    );
    for (const p of r.problems) assert.ok(p.message.length > 0);
  });
}

test("--untrusted applies the safe-mode rules to any scene", () => {
  const file = sceneFile("eval.json", {
    site: "http://localhost:3000",
    beats: [{ id: "a", say: "x", do: [{ action: "eval", fn: "1" }] }],
  });
  assert.equal(validateSceneFile(tmp.dir, file).ok, true);
  assert.equal(validateSceneFile(tmp.dir, file, { untrusted: true }).ok, false);
});

test("--site replaces the scene's site, as render --site does", () => {
  const file = sceneFile("site.json", {
    site: "http://a.test",
    beats: [{ id: "a", say: "x", do: [{ action: "navigate", url: "http://a.test/p" }] }],
  });
  assert.equal(validateSceneFile(tmp.dir, file, { untrusted: true }).ok, true);
  const moved = validateSceneFile(tmp.dir, file, { untrusted: true, site: "http://b.test" });
  assert.deepEqual(
    moved.problems.map((p) => p.path),
    ["beats[0].do[0].url"],
  );
});

test("a bad --allow-origin is a problem, not silently dropped", () => {
  const r = validateSceneFile(tmp.dir, sceneFile("origin.json", valid), {
    allowedOrigins: ["notaurl"],
  });
  assert.deepEqual(
    r.problems.map((p) => p.path),
    ["--allow-origin"],
  );
});

// The CLI: exit codes and the --json contract. Runs the TypeScript source
// through tsx, the same way the tests themselves run.
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
// Resolved here: the child runs in a temp dir, where `tsx` can't be found by name.
const tsx = import.meta.resolve("tsx");
function runCli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", tsx, cli, "validate", ...args], {
    encoding: "utf8",
    cwd: tmp.dir,
  });
}

test("narrate validate exits 0 for a valid scene and 1 with --json problems otherwise", () => {
  const ok = runCli("--scene", sceneFile("cli-ok.json", valid), "--json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), {
    ok: true,
    schemaVersion: SCENE_SCHEMA_VERSION,
    problems: [],
  });

  const bad = runCli("--scene", sceneFile("cli-bad.json", { site: "x", beats: [] }), "--json");
  assert.equal(bad.status, 1);
  const out = JSON.parse(bad.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.schemaVersion, SCENE_SCHEMA_VERSION);
  assert.equal(out.problems[0].path, "beats");

  const text = runCli("--scene", sceneFile("cli-bad2.json", { site: "x", beats: [] }));
  assert.equal(text.status, 1);
  assert.match(text.stdout, /Invalid scene/);
});

test("narrate validate needs neither Playwright nor anything on PATH", () => {
  // Fails any attempt to load Playwright; PATH is emptied so ffmpeg can't run.
  const hooks = join(tmp.dir, "block-hooks.mjs");
  writeFileSync(
    hooks,
    `export async function resolve(spec, ctx, next) {
  if (spec.split("/")[0].startsWith("playwright")) throw new Error("playwright was loaded");
  return next(spec, ctx);
}`,
  );
  const register = join(tmp.dir, "block.mjs");
  writeFileSync(
    register,
    `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(hooks).href)});`,
  );
  const r = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(register).href, "--import", tsx, cli, "validate"].concat([
      "--scene",
      sceneFile("isolated.json", valid),
      "--json",
    ]),
    { encoding: "utf8", cwd: tmp.dir, env: { ...process.env, PATH: "", Path: "" } },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});
