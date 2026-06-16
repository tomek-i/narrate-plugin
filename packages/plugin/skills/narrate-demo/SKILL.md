---
name: narrate-demo
description: Render the built-in Aurora demo to showcase the narrate plugin end-to-end (no project setup needed). Use when the user wants to try narrate or verify it works without their own site.
---

Render the plugin's **self-contained demo** so the user can see narrate working
without any project, dev server, or website of their own. The demo app and scene
ship inside the plugin.

## Steps

1. **Check ffmpeg** (`ffmpeg -version`) — the only external dependency. If
   missing, tell the user how to install it and stop. (Playwright + Chromium are
   auto-provisioned on first run; the first demo may pause to fetch the browser.)

2. **Pick a voice.** Look for a `NARRATE_*` key in the environment or
   `.env.narrate`. Then:
   - **Key found** → render with that provider (real narration).
   - **No key** → tell the user clearly: *"No TTS API key found."* Offer to add one
     (e.g. a free Gemini key from https://aistudio.google.com/apikey). If they give
     one, save it to `./.env.narrate` as `NARRATE_GEMINI_API_KEY=…`, ensure
     `.env.narrate` is in the project `.gitignore`, then use it.
   - **They decline** → use `--provider os` (the operating system's built-in
     voice — Windows/macOS sound fine; Linux needs `espeak`, else it's silent).
     Mention quality is basic but needs no key. `--provider mock` is the silent option.

3. **Render the bundled demo** into a temp dir (append the chosen `--provider` if
   not using the configured default):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
     --scene "${CLAUDE_PLUGIN_ROOT}/examples/demo.scene.json" --out ./.narrate/tmp --provider os
   ```

4. **Deliver & clean up.** Create `./docs/` if needed, copy
   `./.narrate/tmp/narrate-demo.mp4` → `./docs/narrate-demo.mp4`, ensure the
   project's `.gitignore` contains `.narrate/`, then delete `./.narrate/tmp`.

5. **Report** the path `./docs/narrate-demo.mp4` and explain that this same engine
   powers `/narrate-video <prompt>` against the user's own running app.
