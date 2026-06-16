---
name: narrate-walkthrough
description: Generate a narrated walkthrough video of a running website. Use when the user asks to record, narrate, or produce a video tour / screencast of a web app, demo a site's features on video, or create a walkthrough with voiceover.
---

# Narrate a walkthrough video

Produce a narrated video tour of a website using the `@narrate/core` engine: it
generates speech with a TTS provider, records the browser continuously with a
bundled headless Playwright (so audio sync is automatic — no manual syncing),
and muxes the narration onto the video with ffmpeg.

## The CLI

The engine ships as a bundled CLI inside this plugin. Always invoke it as:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" <command> …
```

(During development in the source monorepo you can instead use `pnpm narrate …`.)

## Prerequisites (check, don't assume)

1. **One-time setup.** Playwright + a Chromium browser are installed next to the
   CLI on first use. If `${CLAUDE_PLUGIN_ROOT}/node_modules/playwright` is absent,
   run `node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" setup` first.
2. **ffmpeg + ffprobe** on PATH (`ffmpeg -version`). If missing, tell the user to install it.
3. **The target site is running** and reachable at the scene's `site` URL (e.g. a dev server). If not, ask the user to start it (or offer to).
4. **An API key** for the configured TTS provider, namespaced as `NARRATE_<PROVIDER>_API_KEY` in `.env.narrate` (gitignored) or the environment. For a no-key dry run, use `--provider mock`.

## Steps

1. **Locate or create a scene file.** A scene is JSON describing the tour: `site`, `viewport`, optional `theme`, and ordered `beats` (each with `say` text + timed `do` steps). Start from `scenes/portfolio.example.json`. Tailor the narration and steps to the site's actual features and selectors (inspect the DOM if unsure).
2. **Confirm config.** `narrate.config.json` sets the provider/voice/output. Defaults to Gemini + "Kore". To switch voice or provider, edit the config or pass `--voice` / `--provider`.
3. **Run the render:**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene scenes/portfolio.example.json
   # dry run with no API key / no audio:
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene scenes/portfolio.example.json --provider mock
   ```
4. **Report the output path** (`out/<scene-name>.mp4`) and offer to tweak voice, narration, or pacing.

## Notes

- Each beat stays on screen for exactly its narration length, so beats whose `do`
  steps run longer than the spoken line will log a warning — shorten the steps or
  lengthen the narration.
- Selectors in `do` steps are real Playwright selectors. `menu` clicks a trigger
  then a menu item by text (handy for theme dropdowns). `eval` runs arbitrary
  page JS as an escape hatch.
- To change TTS engine to ElevenLabs: set `tts.provider: "elevenlabs"`, put a
  voice id in `tts.voice`, and set `NARRATE_ELEVENLABS_API_KEY`.
- A scene-level `theme` (`light`/`dark`/`system`) is applied `next-themes`-style:
  it sets `localStorage.theme`, toggles the `light`/`dark` class on `<html>`, and
  sets `color-scheme`. If the target app themes differently, drive the toggle with
  a `menu`/`click` step (as the example does) or an `eval` step instead.
