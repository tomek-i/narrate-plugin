---
description: Record a narrated walkthrough video of a running website.
argument-hint: [what to demo / which site or scene]
---

The user wants a narrated walkthrough video. Their request: **$ARGUMENTS**

Produce it with the bundled `@narrate/core` engine following the
`narrate-walkthrough` skill. Key facts for this plugin layout:

1. **One-time setup.** The engine needs Playwright + a Chromium browser, which
   are installed next to the bundled CLI on first use. If
   `${CLAUDE_PLUGIN_ROOT}/node_modules/playwright` does not exist, run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" setup
   ```
   Also confirm `ffmpeg` and `ffprobe` are on PATH (`ffmpeg -version`); if not,
   tell the user to install them.

2. **Scene.** Find or write a scene JSON (see the skill + `scenes/portfolio.example.json`).
   Tailor `site`, `viewport`, optional `theme`, and the ordered `beats`
   (`say` + timed `do` steps) to the user's request and the site's real
   selectors. The target site must be running and reachable at `site`.

3. **Render** with the bundled CLI (NOT a global `narrate` binary):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene <scene.json>
   # no API key / silent dry run:
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene <scene.json> --provider mock
   ```
   A TTS API key is read from `NARRATE_<PROVIDER>_API_KEY` (in `.env.narrate`
   or the environment). Use `--provider mock` if none is available.

4. **Report** the output path (`out/<scene-name>.mp4`) and offer to adjust voice,
   narration, or pacing.

If `$ARGUMENTS` is empty, ask the user what site/feature to demo and whether the
dev server is already running.
