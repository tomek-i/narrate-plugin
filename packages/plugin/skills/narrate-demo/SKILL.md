---
name: narrate-demo
description: Render the built-in Aurora demo to showcase the narrate plugin end-to-end (no project setup needed). Use when the user wants to try narrate or verify it works without their own site.
---

Render the plugin's **self-contained demo** so the user can see narrate working
without any project, dev server, or website of their own. The demo app and scene
ship inside the plugin. **This always runs out of the box** — no key, no setup:
the default config uses the OS's built-in voice.

## Steps

1. **Scaffold + validate (deterministic, no guessing).**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" init
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check
   ```
   `init` creates an empty project override file `./.narrate/settings.local.json`
   and gitignores `.narrate/`; settings come from the global
   `~/.narrate/settings.json` (else defaults — the OS voice). `check` validates
   ffmpeg + config and prints `RESULT: PASS|FAIL` (exit 0/1). Act on it:
   - **ffmpeg MISSING** → tell the user how to install it, then stop (the one hard
     dependency). On Linux the OS voice also needs `espeak`.
   - **PASS** → proceed. With defaults this uses the OS voice — no key required.
   Do **not** block on a key. If the user wants a higher-quality cloud voice, mention
   they can run **`/narrate-setup`** (Gemini/ElevenLabs) first, but it's optional.
   (Playwright + Chromium are auto-provisioned on first render — the first demo may
   pause to fetch the browser.)

2. **Render the bundled demo** into a temp dir:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --json \
     --scene "${CLAUDE_PLUGIN_ROOT}/examples/demo.scene.json" --out ./.narrate/tmp
   ```
   Stdout is one JSON line (progress is on stderr). If `ok` is false, report its
   `stage` and `error`, and the `log` file for details.

3. **Deliver.** Create `./docs/` if needed and copy
   `./.narrate/tmp/narrate-demo.mp4` → `./docs/narrate-demo.mp4`. Ensure the
   project's `.gitignore` contains `.narrate/`.

4. **Report audio, then clean up.** Quote the result's `audio` (stream present?
   mean volume in dB) so the user knows the narration is real. (A silent or
   missing audio track already fails a `--json` render, except with the silent
   `mock` voice.) If something looks wrong, keep `./.narrate/tmp` (it has
   `narrate.log`) for debugging; otherwise **delete `./.narrate/tmp`**
   automatically — the deliverable lives at `./docs/narrate-demo.mp4`.
   (Note: VS Code's built-in preview can't decode the audio — verify in VLC or a browser.)

5. **Report** the path `./docs/narrate-demo.mp4` and explain that this same engine
   powers `/narrate-video <prompt>` against the user's own running app.
