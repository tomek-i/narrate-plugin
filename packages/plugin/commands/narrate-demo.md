---
description: Render the built-in Aurora demo to showcase the narrate plugin end-to-end (no project setup needed).
---

Render the plugin's **self-contained demo** so the user can see narrate working
without any project, dev server, or website of their own. The demo app and scene
ship inside the plugin.

## Steps

1. **Check ffmpeg** (`ffmpeg -version`) — the only external dependency. If
   missing, tell the user how to install it and stop. (Playwright + Chromium are
   auto-provisioned on first run; the first demo may pause to fetch the browser.)

2. **Pick a provider.** If a TTS key is available (`NARRATE_GEMINI_API_KEY` or
   another `NARRATE_*` key in `.env.narrate`/env), render with real narration.
   Otherwise add `--provider mock` and warn the user the narration will be silent.

3. **Render the bundled demo** into a temp dir:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
     --scene "${CLAUDE_PLUGIN_ROOT}/examples/demo.scene.json" --out ./.narrate/tmp
   ```
   (Append `--provider mock` if there's no key.)

4. **Deliver & clean up.** Create `./docs/` if needed, copy
   `./.narrate/tmp/narrate-demo.mp4` → `./docs/narrate-demo.mp4`, ensure the
   project's `.gitignore` contains `.narrate/`, then delete `./.narrate/tmp`.

5. **Report** the path `./docs/narrate-demo.mp4` and explain that this same engine
   powers `/narrate <prompt>` against the user's own running app.
