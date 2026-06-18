---
name: narrate-setup
description: Configure narrate's TTS provider and API key. Optional — narrate already works out of the box with the OS voice. Use this to upgrade to a higher-quality cloud voice (Gemini or ElevenLabs), or to switch providers/voices.
argument-hint: "[optional: gemini | elevenlabs]"
---

# Configure narrate (TTS provider & key)

narrate works immediately with the **OS's built-in voice** (no key), so this is an
**optional upgrade** step. Run it when the user wants higher-quality cloud
narration or to switch providers/voices. All settings and keys live in one
gitignored file: `./.narrate/settings.local.json`.

## The CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" <command> …
```

(In the source monorepo: `pnpm narrate …`.)

## Steps

1. **Scaffold.** Create the config file if it doesn't exist yet:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" init
   ```
   This writes `./.narrate/settings.local.json` (with sensible defaults — OS voice)
   and ensures `.narrate/` is gitignored, so any key you add is never committed.

2. **Pick a provider + get a key.** If `$ARGUMENTS` already names a provider, use
   it; otherwise ask the user which they want:
   - **Gemini** — free key at https://aistudio.google.com/apikey
   - **ElevenLabs** — key from https://elevenlabs.io (dashboard → API key)
   - (Or keep the **OS voice** / use `mock` for silent — no key needed; nothing to do.)

3. **Save it.** Write the key and switch the active provider in one step:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" set-key <gemini|elevenlabs> <key>
   ```
   For ElevenLabs this also sets a default voice id; override it later in
   `tts.voice` (any ElevenLabs voice id). For Gemini, voices like `Kore` work.

4. **Validate.** Confirm everything is ready:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check
   ```
   Expect `RESULT: PASS`. If it prints `ffmpeg: MISSING`, give install instructions
   (ffmpeg + ffprobe must be on PATH — the one manual dependency).

5. **Report.** Tell the user the active provider/voice and that the key is stored in
   the gitignored `./.narrate/settings.local.json`, so future runs of
   `/narrate-video` and `/narrate-demo` use it automatically — no need to re-run setup.

## Notes

- **Manual edit** is fine too: open `./.narrate/settings.local.json` and set
  `tts.provider`, `tts.voice`, and the matching `keys.<provider>`.
- **CI:** instead of storing the key in the file, set `NARRATE_GEMINI_API_KEY` /
  `NARRATE_ELEVENLABS_API_KEY` in the environment — the file's `keys` block takes
  precedence, the env var is the fallback.
