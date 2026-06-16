---
name: narrate-demo
description: Render the built-in Aurora demo to showcase the narrate plugin end-to-end (no project setup needed). Use when the user wants to try narrate or verify it works without their own site.
---

Render the plugin's **self-contained demo** so the user can see narrate working
without any project, dev server, or website of their own. The demo app and scene
ship inside the plugin.

## Steps

1. **Scaffold + validate (deterministic, no guessing).**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" init
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check
   ```
   `init` creates `./.narrate/.env.narrate` (key template) and
   `./.narrate/narrate.config.json` (settings), and gitignores `.narrate/`.
   `check` validates ffmpeg + config + TTS key and prints `RESULT: PASS|FAIL`
   (exit 0/1). Act on it:
   - **ffmpeg MISSING** → tell the user how to install it, then stop.
   - **TTS key MISSING** → tell the user to open **`./.narrate/.env.narrate`** and set
     `NARRATE_GEMINI_API_KEY=…` (free key: https://aistudio.google.com/apikey). Because
     `.narrate/` is gitignored the key is never committed. **Wait for them to confirm
     they've added it**, then re-run `check`. If they'd rather skip a key, proceed
     with `--provider os` (OS voice; Windows/macOS fine, Linux needs `espeak`) or
     `--provider mock` (silent).
   - **PASS** → proceed with the configured provider.
   (Playwright + Chromium are auto-provisioned on first render — the first demo may
   pause to fetch the browser.)

2. **Render the bundled demo** into a temp dir (add `--provider os` only if the
   user declined a key):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
     --scene "${CLAUDE_PLUGIN_ROOT}/examples/demo.scene.json" --out ./.narrate/tmp
   ```

3. **Deliver.** Create `./docs/` if needed and copy
   `./.narrate/tmp/narrate-demo.mp4` → `./docs/narrate-demo.mp4`. Ensure the
   project's `.gitignore` contains `.narrate/`.

4. **Report audio + keep temp.** Read `./.narrate/tmp/narrate.log` and quote its
   **"Final audio"** line (stream present? mean volume in dB) so the user knows
   whether the muxed audio is real. Do **not** auto-delete: the intermediates are
   kept at `./.narrate/tmp` — per-beat audio in `audio/`, combined `narration.wav`,
   raw `video/`, the muxed `narrate-demo.mp4`, and the full `narrate.log`. If the
   video seems silent, ask the user to paste `narrate.log`. Then ask **"Remove the
   temp files now? (y/n)"** and delete `./.narrate/tmp` only if they say yes.

5. **Report** the path `./docs/narrate-demo.mp4` and explain that this same engine
   powers `/narrate-video <prompt>` against the user's own running app.
