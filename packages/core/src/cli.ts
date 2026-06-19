#!/usr/bin/env node
import { Command } from "commander";
import { captureAuth } from "./auth.js";
import { loadConfig, loadScene } from "./config.js";
import { render } from "./pipeline.js";
import { checkEnv, initProject, setKey, setVoice } from "./project.js";
import { setup } from "./setup.js";
import { listVoices } from "./tts/voices.js";

const program = new Command();

program
  .name("narrate")
  .description("Generate a narrated walkthrough video of a website.")
  .version("0.20.0");

program
  .command("render")
  .description("TTS → record → mux into one narrated video.")
  .requiredOption("-s, --scene <file>", "scene JSON file")
  .option("-c, --config <file>", "config file (default: .narrate/settings.local.json)")
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
  .description("Scaffold .narrate/settings.local.json (config + keys) in the current project.")
  .action(() => {
    initProject(process.cwd(), (m) => console.log(m));
  });

program
  .command("set-key")
  .description("Save an API key into .narrate/settings.local.json and switch to that provider.")
  .argument("<provider>", "gemini | elevenlabs")
  .argument("<key>", "the API key")
  .action((provider: string, key: string) => {
    if (provider !== "gemini" && provider !== "elevenlabs") {
      throw new Error(`Unknown provider "${provider}" (expected gemini or elevenlabs).`);
    }
    setKey(process.cwd(), provider, key, (m) => console.log(m));
  });

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
  .option("-c, --config <file>", "config file (default: .narrate/settings.local.json)")
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
  .description("Set the active provider's voice in .narrate/settings.local.json.")
  .argument("<voice>", "voice id (elevenlabs) or name (gemini)")
  .action((voice: string) => {
    setVoice(process.cwd(), voice, (m) => console.log(m));
  });

program
  .command("check")
  .description("Validate the environment (ffmpeg, config, TTS key). Exits non-zero if not ready.")
  .option("-c, --config <file>", "config file (default: .narrate/settings.local.json)")
  .action((o) => {
    const cwd = process.cwd();
    const result = checkEnv(loadConfig(cwd, o.config));
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
