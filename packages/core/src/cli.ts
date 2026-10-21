#!/usr/bin/env node
import { Command } from "commander";
import { captureAuth } from "./auth.js";
import { loadConfig, loadConfigLayers, loadScene } from "./config.js";
import { render } from "./pipeline.js";
import { checkEnv, initProject, setKey, setVoice } from "./project.js";
import { readSecret } from "./secret.js";
import { packageVersion, setup } from "./setup.js";
import { listVoices } from "./tts/voices.js";

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
  .action(async (o) => {
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
    const out = await render(scene, config, {
      cwd,
      scenePath: o.scene,
      onLog: (m) => console.log(m),
    });
    console.log(`\n✅ Done → ${out}`);
  });

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
    const { provider, voices, note } = await listVoices(loadConfig(process.cwd(), o.config));
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
    const result = checkEnv(config, layers);
    for (const line of result.lines) console.log(line);
    if (!result.ok) process.exit(1);
  });

program
  .command("setup")
  .description("Install Playwright + the Chromium browser (run once after install).")
  .action(async () => {
    await setup((m) => console.log(m));
  });

program.parseAsync().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
