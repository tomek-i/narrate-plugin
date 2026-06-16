---
description: Record a narrated walkthrough video of this project's app from a plain-English prompt.
argument-hint: [what to demo, e.g. "the signup flow with test@example.com"]
---

The user wants a narrated walkthrough video of **this project's** app. Their
request: **$ARGUMENTS**

You will investigate the repo, get the app running, script the walkthrough as a
scene, and let the bundled `@narrate/core` engine record + narrate it. Follow the
`narrate-walkthrough` skill for the scene format and the full step vocabulary.

Work through these phases. Think before each; don't blindly run commands.

## 1. Preflight
- The engine auto-provisions Playwright + Chromium on first render, so no manual
  install is needed. The ONLY external dependency is **ffmpeg + ffprobe** —
  verify with `ffmpeg -version`. If missing, tell the user how to install it and stop.
- If `$ARGUMENTS` is empty or vague, ask what flow/feature to demo and for any
  test credentials or data needed.

## 2. Investigate the project
- Read `package.json` (and any README/Makefile) to find the dev/start script,
  framework, and the **URL + port** the app serves on. Check for required env
  (e.g. a `.env`), and whether a build or DB/seed step is needed first.
- Identify the exact pages and UI involved in the requested flow. Find the **real
  selectors** you'll drive — read the component source, or (if the Playwright MCP
  is available) open the running page and snapshot it to discover selectors and
  accessible names. Prefer robust selectors: `role=`, `text=`, `[name=...]`,
  stable `id`s — avoid brittle deep CSS.

## 3. Run the app
- If it isn't already running, start the dev server **in the background** and wait
  until the URL actually responds before continuing. Note the PID/handle so you
  can stop it in phase 6.

## 4. Author the scene
- Write `./.narrate/tmp/<slug>.scene.json`: `site` (the running URL), `viewport`,
  optional `theme`, and ordered `beats`. Each beat = one `say` line + the timed
  `do` steps shown while it's spoken.
- Map the user's request into beats: an intro, the feature steps, an outro. Use
  the actual data they gave (e.g. the email/password) — never invent real secrets,
  and treat signup/email flows as test-only.
- **Pacing rule:** each beat stays on screen for exactly its narration length, so
  keep a beat's `do` steps shorter than its spoken line. If steps overrun, the
  engine warns — split the beat or lengthen the narration.

## 5. Render
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render \
  --scene ./.narrate/tmp/<slug>.scene.json --out ./.narrate/tmp
```
- **Voice:** a TTS key is read from `NARRATE_<PROVIDER>_API_KEY` (`.env.narrate` or
  env). If none is found, tell the user clearly and offer to add one (save it to
  `./.env.narrate`, and make sure `.env.narrate` is gitignored). If they decline,
  add `--provider os` to narrate with the operating system's built-in voice
  (no key needed; `--provider mock` is the silent option).
- If the engine warns about overrun beats, adjust the scene and re-render.

## 6. Deliver & clean up
- Create `./docs/` if needed and copy the finished video there:
  `./.narrate/tmp/<slug>.mp4` → `./docs/<slug>.mp4`.
- Ensure the project's `.gitignore` contains `.narrate/`, then delete
  `./.narrate/tmp` (it's all intermediates).
- Stop the dev server you started.
- Report the final path `./docs/<slug>.mp4` and offer to tweak voice, narration,
  pacing, or specific steps.
