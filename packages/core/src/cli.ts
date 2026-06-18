#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, loadScene } from "./config.js";
import { render } from "./pipeline.js";
import { checkEnv, initProject, setKey } from "./project.js";
import { setup } from "./setup.js";

const program = new Command();

program
  .name("narrate")
  .description("Generate a narrated walkthrough video of a website.")
  .version("0.17.0");

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
    if (o.voice) config.tts.voice = o.voice;
    if (o.out) config.output.dir = o.out;
    const scene = loadScene(cwd, o.scene);
    const out = await render(scene, config, { cwd, onLog: (m) => console.log(m) });
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
