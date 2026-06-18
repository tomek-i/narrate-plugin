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

## Narrate like a presenter (use all your context)

You're not just clicking around — you're a product person **showcasing** something
to a viewer who can't see your screen. Before authoring anything, build a mental
model of *what story to tell and what to point at*, using every source you have:

- **The prompt** (`$ARGUMENTS`) — the explicit ask ("demo the signup flow", "show
  what changed in this PR", "walk through the dashboard").
- **The codebase** — components, routes, and the **real selectors** for the
  surfaces involved (read the source; don't guess selectors).
- **The running site** — what's actually on screen (use the Playwright MCP to
  snapshot the live page and confirm selectors/structure).
- **Git / GitHub context** — when the ask is about a change ("the new feature",
  "this PR", "what I just built"), inspect it: current branch vs. the base, recent
  commits, and any open PR (`gh pr view`, `gh pr diff`). The diff tells you which
  files/UI changed, so you demo *those* surfaces and **highlight exactly what's
  new** — not a generic tour.

Then translate that into beats: each beat says one thing and **points at the thing
it's describing** (cursor for interactions, a brief `focus`/`highlight` pulse for
the element/section the narration calls out). This is what makes the highlighting
feel deliberate rather than random — it's driven by what you actually decided to show.

## The CLI

The engine is bundled inside this plugin. Always invoke it as:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" <command> …
```

(In the source monorepo you can instead use `pnpm narrate …`.)

Commands: `init` (scaffold `.narrate/settings.local.json` — config + keys),
`check` (validate ffmpeg + config; exit 0/1), `render --scene <file> [--out <dir>]
[--provider <p>] [--voice <v>]`, and `setup` (force-install Playwright + Chromium;
normally automatic). TTS provider/key onboarding lives in the **`/narrate-setup`** skill.

## Prerequisites

- **ffmpeg + ffprobe** on PATH (`ffmpeg -version`) — the only manual dependency.
  Playwright + Chromium are auto-provisioned on the first render.
- The **target app running** and reachable at the scene's `site` URL.
- **TTS works out of the box** with the OS voice (no key). For higher-quality
  cloud narration, the user can run **`/narrate-setup`** to add a Gemini/ElevenLabs
  key (stored in the gitignored `.narrate/settings.local.json`); it's optional.

## Workflow (from a plain-English request)

1. **Scaffold + validate (deterministic).**
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" init
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check
   ```
   `init` creates `./.narrate/settings.local.json` (config + keys, gitignored,
   defaulting to the OS voice) the first time; `check` validates ffmpeg + config and
   prints `RESULT: PASS|FAIL`. Act on it:
   - **ffmpeg MISSING** → give install instructions and stop (the one hard dependency).
   - **PASS** → continue. Don't block on a key: with defaults narration uses the OS
     voice. If `check` shows `provider=os` and the user wants studio-quality narration,
     mention they can run **`/narrate-setup`** first (optional), then proceed either way.
2. **Investigate & decide what to showcase.**
   - **Run/serve info:** `package.json` dev/start script, framework, URL/port,
     required env/seed.
   - **Scope from git/GitHub when the ask is about a change.** Find what's new and
     demo *that*:
     ```bash
     git branch --show-current && git log --oneline -15
     git diff --stat $(git merge-base HEAD main 2>/dev/null || echo main)...HEAD
     gh pr view --json title,body,url,headRefName 2>/dev/null   # open PR for this branch?
     gh pr diff 2>/dev/null                                     # which files/UI changed
     ```
     Map changed files → the UI surfaces they affect → the beats to record, so the
     walkthrough spotlights the new/changed behavior (use the PR title/body as the
     storyline). For a plain feature/flow ask, skip the diff and just map the flow.
   - **Selectors:** identify the pages + **real selectors** (read component source,
     or snapshot the live page with the Playwright MCP). Prefer robust selectors:
     `role=`, `text=`, `[name=...]`, stable ids.
3. **Run the app** if needed — start the dev server in the background, wait until
   the URL responds, and remember to stop it afterward.
4. **Author a scene** at `./.narrate/tmp/<slug>.scene.json` (format below). Use any
   credentials/data the user gave; treat signup/email flows as test-only. Drive it
   like a presenter (same overlay features the demo uses):
   - **Cursor carries interactions** — it auto-glides to each click/type/fill, so
     the viewer follows along. Don't hand-ring form fields.
   - **Brief highlights for what you're describing** — when a beat's narration
     calls out a specific element/section (especially a changed one from the diff),
     set that beat's **`focus`** selector (or a `highlight` step *after* any scroll),
     so a ~3s pulse points right at it, then fades. Add a `focusLabel` to name it.
5. **Render** to the temp dir:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
     --scene ./.narrate/tmp/<slug>.scene.json --out ./.narrate/tmp
   ```
6. **Deliver**: copy `./.narrate/tmp/<slug>.mp4` → `./docs/<slug>.mp4`, ensure
   `.narrate/` is in the project `.gitignore`, and stop the dev server.
7. **Report audio, then clean up.** Read `./.narrate/tmp/narrate.log` and quote its
   **"Final audio"** line (stream present? mean volume in dB) so the user can verify
   the muxed audio is real. If it reports the stream MISSING or silent, surface that
   and keep `./.narrate/tmp` for debugging; otherwise **delete `./.narrate/tmp`**
   automatically — the deliverable lives at `./docs/<slug>.mp4`. Report that path.
   (Note: VS Code's built-in preview can't decode the audio — verify in VLC or a browser.)

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
      "focus": "#hero",                    // optional: highlight this element for the whole beat
      "focusStyle": "ring",                // optional: ring | glow | spotlight (default from config)
      "focusLabel": "Welcome",             // optional: caption next to it
      "do": [ { "action": "wait", "ms": 800 } ]
    }
  ]
}
```

Use `focus` to spotlight whatever the narration is talking about — it highlights
for the beat's whole duration and clears automatically. The synthetic cursor and
highlights are injected into the page (never the OS cursor) and are on by default;
they're configurable under `overlay` in settings.

For editor autocomplete, add the hosted schema (the engine ignores unknown keys):
`"$schema": "https://raw.githubusercontent.com/tomek-i/narrate-plugin/main/narrate.scene.schema.json"`.

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

**Highlighting / pointer** (injected overlay — never the OS cursor; on by default)
- `{ "action": "highlight", "selector": ".cta", "style": "ring", "label": "Start here" }` — `style`: `ring`|`glow`|`spotlight`. Pulses ~3s then fades (config `holdMs`); add `"hold": 0` to keep it until `unhighlight`/beat end.
- `{ "action": "unhighlight", "selector": ".cta" }` — omit `selector` to clear all
- `{ "action": "point", "selector": "role=button[name=Save]" }` — glide the cursor (no click). Clicks/hover/type already auto-glide the cursor.

Two roles — keep them separate so it doesn't look random:
- **Cursor carries interactions.** Don't hand-highlight form fields; the cursor
  already glides to each element you act on (consistent by construction).
- **Highlights are brief accents** for what the narration *describes* — they pulse
  and fade, so they don't obscure the page. Use `focus` (in-view elements) or a
  `highlight` step placed *after* any scroll so the pulse lands when it's visible.

**Convenience / escape hatch**
- `{ "action": "menu", "trigger": "role=button[name=\"Toggle theme\"]", "item": "Light" }` — click trigger, then a `menuitem` by text
- `{ "action": "eval", "fn": "document.body.classList.add('x')" }` — arbitrary in-page async JS; last resort

## Notes

- **Pacing:** a beat is held for exactly its narration length. If its `do` steps
  run longer, the engine warns — split the beat or lengthen the narration.
- **Config:** `.narrate/settings.local.json` holds output settings plus a `tts`
  block with per-provider settings nested under their own key (`tts.gemini`,
  `tts.elevenlabs` — each with its own `voice`/`model`/`key`); default is the OS
  voice (no key). Override per-run with `--provider` / `--voice`. To switch to a
  cloud voice, run **`/narrate-setup`** (or `narrate set-key <provider> <key>`).
- **Theme:** the optional scene-level `theme` emulates the browser's
  `prefers-color-scheme` (the standard OS/browser color-scheme signal), so it
  works for any site that honors that media query. Apps with a *manual* toggle
  (a button/switch) won't change from this alone — drive that toggle with a
  `click`/`menu` step. Omit `theme` entirely if it doesn't apply.
