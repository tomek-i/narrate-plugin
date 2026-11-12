#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { captureAuth } from "./auth.js";
import { loadConfig, loadConfigLayers, loadScene, settingsFilesChecked } from "./config.js";
import { launcherDir, refreshLaunchers, runningBundle, writeLaunchers } from "./launcher.js";
import { RenderError, type RenderResult, renderScene } from "./pipeline.js";
import { checkEnv, initProject, setKey, setVoice } from "./project.js";
import { readSecret } from "./secret.js";
import { packageVersion, setup } from "./setup.js";
import { listVoices } from "./tts/voices.js";
import type { Config } from "./types.js";
import { allowedOriginProblems, formatProblems, validateSceneFile } from "./validate.js";

const CONFIG_HELP =
  "project config file, layered over ~/.narrate/settings.json (default: .narrate/settings.local.json)";

const program = new Command();

program
  .name("narrate")
  .description("Generate a narrated walkthrough video of a website.")
  .version(packageVersion());

program
  .command("render")
  .description("TTS → record → mux into one narrated video.")
  .requiredOption("-s, --scene <file>", "scene JSON file")
  .option("-c, --config <file>", CONFIG_HELP)
  .option("-o, --out <dir>", "output directory (overrides config output.dir)")
  .option("--provider <name>", "override TTS provider (gemini|elevenlabs|os|mock)")
  .option("--voice <name>", "override voice")
  .option(
    "--same-origin",
    "keep the browser on the scene site's origin; fail without writing a video if it leaves",
  )
  .option(
    "--untrusted",
    "safe mode for generated scenes: reject eval/uploadFile/off-site navigate, type ${NAME} literally, ignore the scene's auth, keep the browser on the site",
  )
  .option("--no-env", "type ${NAME} in fill/type text literally instead of expanding it")
  .option(
    "--site <url>",
    "record this site instead of the scene's (pins where a generated scene starts)",
  )
  .option(
    "--allow-origin <url...>",
    "also allow these origins and turn on the same-origin guard (the only way to allow more under --untrusted)",
  )
  .option(
    "--storage-state <file>",
    "load this saved session (overrides the scene's auth.storageState; the only way under --untrusted)",
  )
  .option("--json", "print one JSON result object on stdout; all other output goes to stderr")
  .option("--log <file>", "write the diagnostic log here (default: <out>/narrate.log)")
  .action(async (o: RenderFlags) => {
    if (!o.json) {
      try {
        const result = await renderCommand(o, (m) => console.log(m));
        console.log(`\n✅ Done → ${result.video}`);
      } catch (err) {
        // A RenderError has already been shown through the log; don't repeat it.
        if (!(err instanceof RenderError)) throw err;
        process.exitCode = 1;
      }
      return;
    }
    // With --json, stdout carries exactly one JSON object; everything else is stderr.
    try {
      const result = await renderCommand(o, (m) => console.error(m));
      console.log(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      console.log(
        JSON.stringify({
          ok: false,
          // Errors before the render starts (config, scene file) are input problems.
          stage: err instanceof RenderError ? err.stage : "validate",
          error: err instanceof Error ? err.message : String(err),
          log: err instanceof RenderError ? err.log : inputErrorLog(o.log, err),
        }),
      );
      process.exitCode = 1;
    }
  });

/**
 * For an error before the render started (config, scene file, flags): write it
 * to `--log` if one was given, so the caller finds a log where it asked for one.
 */
function inputErrorLog(logFile: string | undefined, err: unknown): string | null {
  if (!logFile) return null;
  const path = resolve(process.cwd(), logFile);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `❌ ${err instanceof Error ? err.message : String(err)}\n`);
    return path;
  } catch (writeErr) {
    console.error(
      `⚠️  Could not write the diagnostic log ${path}: ${writeErr instanceof Error ? writeErr.message : writeErr}`,
    );
    return null;
  }
}

interface RenderFlags {
  scene: string;
  config?: string;
  out?: string;
  provider?: Config["tts"]["provider"];
  voice?: string;
  sameOrigin?: boolean;
  untrusted?: boolean;
  /** false with --no-env */
  env: boolean;
  storageState?: string;
  site?: string;
  allowOrigin?: string[];
  json?: boolean;
  log?: string;
}

async function renderCommand(o: RenderFlags, say: (m: string) => void): Promise<RenderResult> {
  const cwd = process.cwd();
  const config = loadConfig(cwd, o.config);
  if (o.provider) config.tts.provider = o.provider;
  if (o.voice) {
    // Apply the voice override to whichever provider is now active.
    if (config.tts.provider === "gemini") config.tts.gemini.voice = o.voice;
    else if (config.tts.provider === "elevenlabs") config.tts.elevenlabs.voice = o.voice;
  }
  if (o.out) config.output.dir = o.out;
  const scene = loadScene(cwd, o.scene);
  // Empty list = only the site's own origin (always allowed).
  if (o.sameOrigin) scene.allowedOrigins = [];
  if (o.site) scene.site = o.site;
  const [badOrigin] = allowedOriginProblems(o.allowOrigin);
  if (badOrigin) throw new Error(`--allow-origin ${badOrigin.message}`);
  return renderScene(scene, config, {
    cwd,
    scenePath: o.scene,
    settingsFiles: settingsFilesChecked(cwd, o.config),
    untrusted: o.untrusted,
    expandEnv: o.env,
    storageState: o.storageState,
    allowedOrigins: o.allowOrigin,
    logFile: o.log,
    // A caller parsing --json output must never get a silent "narrated" video.
    requireAudio: Boolean(o.json),
    onLog: say,
  });
}

program
  .command("validate")
  .description(
    "Check a scene against the schema and render's own checks, without a browser, ffmpeg, TTS or network. Exits 1 if invalid.",
  )
  .requiredOption("-s, --scene <file>", "scene JSON file")
  .option("--untrusted", "also apply the --untrusted rules (as render --untrusted would)")
  .option("--allow-origin <url...>", "origins the caller allows, as with render --allow-origin")
  .option("--site <url>", "check against this site instead of the scene's, as with render --site")
  .option("--json", "print one JSON object: { ok, schemaVersion, problems: [{ path, message }] }")
  .action(
    (o: {
      scene: string;
      untrusted?: boolean;
      allowOrigin?: string[];
      site?: string;
      json?: boolean;
    }) => {
      const result = validateSceneFile(process.cwd(), o.scene, {
        untrusted: o.untrusted,
        allowedOrigins: o.allowOrigin,
        site: o.site,
      });
      if (o.json) {
        console.log(JSON.stringify(result));
      } else if (result.ok) {
        console.log(`✅ Scene OK: ${o.scene} (schema version ${result.schemaVersion})`);
      } else {
        console.log(`❌ Invalid scene: ${o.scene}\n${formatProblems(result.problems)}`);
      }
      if (!result.ok) process.exitCode = 1;
    },
  );

program
  .command("init")
  .description(
    "Scaffold .narrate/settings.local.json (project overrides) in the current project, or ~/.narrate/settings.json with --global.",
  )
  .option("-g, --global", "scaffold the user-wide settings file instead")
  .action((o: { global?: boolean }) => {
    initProject(process.cwd(), (m) => console.log(m), o.global ? "global" : "project");
  });

program
  .command("set-key")
  .description(
    "Save an API key into your global settings (~/.narrate/settings.json) and switch to that provider.",
  )
  .argument("<provider>", "gemini | elevenlabs")
  .argument("[key]", "the API key (omit to read it without exposing it, see --clipboard)")
  .option("-p, --project", "save to this project's .narrate/settings.local.json instead")
  .option("--clipboard", "read the key from the clipboard")
  .action(
    async (
      provider: string,
      key: string | undefined,
      o: { project?: boolean; clipboard?: boolean },
    ) => {
      if (provider !== "gemini" && provider !== "elevenlabs") {
        throw new Error(`Unknown provider "${provider}" (expected gemini or elevenlabs).`);
      }
      const k = key ?? (await readSecret({ clipboard: o.clipboard, label: `${provider} API key` }));
      setKey(process.cwd(), provider, k, (m) => console.log(m), o.project ? "project" : "global");
    },
  );

program
  .command("auth")
  .description(
    "Open a browser to log in once; saves the session so authenticated scenes start signed in.",
  )
  .argument("<url>", "the login URL to open")
  .option("-o, --out <file>", "where to save the session", ".narrate/auth.json")
  .action(async (url: string, o: { out: string }) => {
    const out = await captureAuth({
      url,
      out: o.out,
      cwd: process.cwd(),
      onLog: (m) => console.log(m),
    });
    console.log(`\n✅ Saved session → ${out}`);
    console.log(`Use it in a scene:  "auth": { "storageState": "${o.out}" }`);
  });

program
  .command("voices")
  .description("List TTS voices your configured key can use (helps pick a free-tier voice).")
  .option("-c, --config <file>", CONFIG_HELP)
  .action(async (o) => {
    const cwd = process.cwd();
    const { provider, voices, note } = await listVoices(
      loadConfig(cwd, o.config),
      settingsFilesChecked(cwd, o.config),
    );
    if (note) console.log(note);
    for (const v of voices) {
      console.log(`${v.id}  ${v.name}${v.category ? `  (${v.category})` : ""}`);
    }
    if (provider === "elevenlabs" && voices.length) {
      console.log("\nLock one in with: narrate set-voice <voice_id>");
    }
  });

program
  .command("set-voice")
  .description(
    "Set the active provider's voice in your global settings (~/.narrate/settings.json).",
  )
  .argument("<voice>", "voice id (elevenlabs) or name (gemini)")
  .option("-p, --project", "save to this project's .narrate/settings.local.json instead")
  .action((voice: string, o: { project?: boolean }) => {
    setVoice(process.cwd(), voice, (m) => console.log(m), o.project ? "project" : "global");
  });

program
  .command("check")
  .description("Validate the environment (ffmpeg, config, TTS key). Exits non-zero if not ready.")
  .option("-c, --config <file>", CONFIG_HELP)
  .action((o) => {
    const cwd = process.cwd();
    const { config, layers } = loadConfigLayers(cwd, o.config);
    const result = checkEnv(config, layers, settingsFilesChecked(cwd, o.config));
    for (const line of result.lines) console.log(line);
    if (!result.ok) process.exit(1);
  });

program
  .command("setup")
  .description(
    "Install Playwright, and write the stable launchers in ~/.narrate/bin that run this version.",
  )
  .action(async () => {
    await setup((m) => console.log(m));
    const bundle = runningBundle();
    if (!bundle) {
      console.log("Running from source: no launchers written (they need the built CLI).");
      return;
    }
    const dir = launcherDir();
    try {
      writeLaunchers(bundle, packageVersion());
    } catch (err) {
      // The launchers are optional: don't fail a setup that already installed everything.
      console.error(
        `⚠️  Could not write the launchers in ${dir}: ${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    console.log(`Launchers in ${dir} now run ${bundle}:`);
    console.log(`  node "${join(dir, "narrate.mjs")}" <command>`);
    console.log(`  Add ${dir} to your PATH to run plain \`narrate <command>\`.`);
  });

// Keep ~/.narrate/bin pointing at the installed plugin's current version.
refreshLaunchers();

program.parseAsync().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
