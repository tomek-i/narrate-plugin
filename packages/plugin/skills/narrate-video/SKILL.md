---
name: narrate-video
description: Generate a narrated walkthrough video of a running web app. Use when the user asks to record, narrate, or produce a video tour / screencast / demo of a website or feature, or create a walkthrough with voiceover.
argument-hint: "[what to demo, e.g. the signup flow with test@example.com]"
---

# Narrate a walkthrough video

If you were invoked with a request (the user's words, available as `$ARGUMENTS`),
treat that as the walkthrough to produce. If it's empty, ask what flow/feature to
demo and for any test credentials or data needed.

Produce a narrated video tour using the bundled `@narrate/core` engine: it
generates speech with a TTS provider, records the browser continuously with a
headless Playwright (each beat held on screen for exactly its narration length,
so audio sync is automatic), and muxes narration onto the video with ffmpeg.

## The CLI

The engine is bundled inside this plugin. Always invoke it as:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" <command> …
```

(In the source monorepo you can instead use `pnpm narrate …`.)

Commands: `render --scene <file> [--out <dir>] [--provider <p>] [--voice <v>]`
and `setup` (force-install Playwright + Chromium; normally automatic on first render).

## Prerequisites

- **ffmpeg + ffprobe** on PATH (`ffmpeg -version`) — the only manual dependency.
  Playwright + Chromium are auto-provisioned on the first render.
- The **target app running** and reachable at the scene's `site` URL.
- A **TTS API key** as `NARRATE_<PROVIDER>_API_KEY`. The engine reads it from
  `.narrate/.env.narrate` (preferred), `.env.narrate`, or the environment. No key?
  Warn the user and offer to add one — save it to `.narrate/.env.narrate` (that dir
  is gitignored, so the key is never committed). If they decline, use `--provider os`
  (the OS's built-in voice — no key; Windows/macOS work, Linux needs `espeak`).
  `--provider mock` is silent. Per-run settings can also live in `.narrate/narrate.config.json`.

## Workflow (from a plain-English request)

1. **Investigate** the repo: `package.json` dev/start script, framework, URL/port,
   required env/seed. Identify the pages + **real selectors** for the requested
   flow (read component source, or use the Playwright MCP to snapshot the live
   page). Prefer robust selectors: `role=`, `text=`, `[name=...]`, stable ids.
2. **Run the app** if needed — start the dev server in the background, wait until
   the URL responds, and remember to stop it afterward.
3. **Author a scene** at `./.narrate/tmp/<slug>.scene.json` (format below). Use any
   credentials/data the user gave; treat signup/email flows as test-only.
4. **Render** to the temp dir:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
     --scene ./.narrate/tmp/<slug>.scene.json --out ./.narrate/tmp
   ```
5. **Deliver**: copy `./.narrate/tmp/<slug>.mp4` → `./docs/<slug>.mp4`, ensure
   `.narrate/` is in the project `.gitignore`, delete `./.narrate/tmp`, stop the
   dev server, and report the final path.

## Scene format

```jsonc
{
  "name": "signup",                       // output file = <name>.mp4
  "site": "http://localhost:3000",
  "viewport": { "width": 1440, "height": 900 },
  "theme": "dark",                         // optional: light | dark | system
  "beats": [
    {
      "id": "intro",
      "say": "Spoken narration for this beat.",
      "voice": "Kore",                     // optional per-beat voice override
      "do": [ { "action": "wait", "ms": 800 } ]
    }
  ]
}
```

Add `"$schema": "../narrate.scene.schema.json"` for editor autocomplete when a
schema file is nearby (the engine ignores unknown keys).

## Step vocabulary (the `do` array)

Selectors are real Playwright selectors. Steps run in order within a beat.

**Timing**
- `{ "action": "wait", "ms": 1000 }`
- `{ "action": "waitFor", "selector": ".x", "state": "visible" }` — state: `attached|detached|visible|hidden`
- `{ "action": "waitForUrl", "url": "**/dashboard" }`

**Navigation**
- `{ "action": "navigate", "url": "http://localhost:3000/path" }`
- `{ "action": "back" }` · `{ "action": "forward" }` · `{ "action": "reload" }`

**Mouse**
- `{ "action": "click", "selector": "..." }`
- `{ "action": "dblclick", "selector": "..." }`
- `{ "action": "hover", "selector": "..." }`
- `{ "action": "dragTo", "from": "...", "to": "..." }`

**Keyboard / forms**
- `{ "action": "fill", "selector": "#email", "text": "a@b.com" }` — set value instantly
- `{ "action": "type", "selector": "#email", "text": "a@b.com", "delay": 60 }` — key-by-key (lifelike)
- `{ "action": "clear", "selector": "#email" }`
- `{ "action": "press", "key": "Enter", "selector": "#email" }` — `selector` optional; supports combos like `Control+A`
- `{ "action": "selectOption", "selector": "select", "label": "Blue" }` — or `"value": "..."`
- `{ "action": "check", "selector": "#agree" }` · `{ "action": "uncheck", "selector": "#agree" }`
- `{ "action": "focus", "selector": "..." }` · `{ "action": "blur", "selector": "..." }`
- `{ "action": "uploadFile", "selector": "input[type=file]", "files": ["./a.png"] }`

**Scrolling** (smoothly animated over `over` ms)
- `{ "action": "scrollTo", "y": 600, "over": 2000 }`
- `{ "action": "scrollThrough", "selector": "article", "over": 7000 }` — selector optional (whole page)
- `{ "action": "scrollIntoView", "selector": "#section", "over": 800 }`

**Convenience / escape hatch**
- `{ "action": "menu", "trigger": "role=button[name=\"Toggle theme\"]", "item": "Light" }` — click trigger, then a `menuitem` by text
- `{ "action": "eval", "fn": "document.body.classList.add('x')" }` — arbitrary in-page async JS; last resort

## Notes

- **Pacing:** a beat is held for exactly its narration length. If its `do` steps
  run longer, the engine warns — split the beat or lengthen the narration.
- **Config:** `narrate.config.json` sets provider/voice/output (default Gemini +
  "Kore"). Override per-run with `--provider` / `--voice`. For ElevenLabs: set
  `tts.provider: "elevenlabs"`, a voice id in `tts.voice`, and `NARRATE_ELEVENLABS_API_KEY`.
- **Theme:** the optional scene-level `theme` emulates the browser's
  `prefers-color-scheme` (the standard OS/browser color-scheme signal), so it
  works for any site that honors that media query. Apps with a *manual* toggle
  (a button/switch) won't change from this alone — drive that toggle with a
  `click`/`menu` step. Omit `theme` entirely if it doesn't apply.
