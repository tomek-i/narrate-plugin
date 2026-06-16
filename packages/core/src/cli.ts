#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig, loadEnv, loadScene } from "./config.js";
import { render } from "./pipeline.js";
import { setup } from "./setup.js";

const program = new Command();

program
  .name("narrate")
  .description("Generate a narrated walkthrough video of a website.")
  .version("0.4.0");

program
  .command("render")
  .description("TTS → record → mux into one narrated video.")
  .requiredOption("-s, --scene <file>", "scene JSON file")
  .option("-c, --config <file>", "config file (default: narrate.config.json)")
  .option("-o, --out <dir>", "output directory (overrides config output.dir)")
  .option("--provider <name>", "override TTS provider (gemini|elevenlabs|os|mock)")
  .option("--voice <name>", "override voice")
  .action(async (o) => {
    const cwd = process.cwd();
    loadEnv(cwd);
    const config = loadConfig(cwd, o.config);
    if (o.provider) config.tts.provider = o.provider;
    if (o.voice) config.tts.voice = o.voice;
    if (o.out) config.output.dir = o.out;
    const scene = loadScene(cwd, o.scene);
    const out = await render(scene, config, { cwd, onLog: (m) => console.log(m) });
    console.log(`\n✅ Done → ${out}`);
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
