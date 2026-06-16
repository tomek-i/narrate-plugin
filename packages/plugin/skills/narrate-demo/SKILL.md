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

2. **Pick a voice.** Look for a `NARRATE_*` key in the environment, in
   `.narrate/.env.narrate`, or `.env.narrate`. Then:
   - **Key found** → render with that provider (real narration).
   - **No key** → tell the user clearly: *"No TTS API key found."* Offer to add one
     (e.g. a free Gemini key from https://aistudio.google.com/apikey). If they give
     one, save it to **`./.narrate/.env.narrate`** as `NARRATE_GEMINI_API_KEY=…` —
     because `.narrate/` is gitignored, the key is never committed (no need to edit
     `.gitignore`). The engine reads keys and `narrate.config.json` from `.narrate/` too.
   - **They decline** → use `--provider os` (the operating system's built-in
     voice — Windows/macOS sound fine; Linux needs `espeak`, else it's silent).
     Mention quality is basic but needs no key. `--provider mock` is the silent option.

3. **Render the bundled demo** into a temp dir (append the chosen `--provider` if
   not using the configured default):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
     --scene "${CLAUDE_PLUGIN_ROOT}/examples/demo.scene.json" --out ./.narrate/tmp --provider os
   ```

4. **Deliver.** Create `./docs/` if needed and copy
   `./.narrate/tmp/narrate-demo.mp4` → `./docs/narrate-demo.mp4`. Ensure the
   project's `.gitignore` contains `.narrate/`.

5. **Report audio + keep temp.** Read `./.narrate/tmp/narrate.log` and quote its
   **"Final audio"** line (stream present? mean volume in dB) so the user knows
   whether the muxed audio is real. Do **not** auto-delete: the intermediates are
   kept at `./.narrate/tmp` — per-beat audio in `audio/`, combined `narration.wav`,
   raw `video/`, the muxed `narrate-demo.mp4`, and the full `narrate.log`. If the
   video seems silent, ask the user to paste `narrate.log`. Then ask **"Remove the
   temp files now? (y/n)"** and delete `./.narrate/tmp` only if they say yes.

6. **Report** the path `./docs/narrate-demo.mp4` and explain that this same engine
   powers `/narrate-video <prompt>` against the user's own running app.
