---
name: narrate-setup
description: Configure narrate's TTS provider and API key. Optional — narrate already works out of the box with the OS voice. Use this to upgrade to a higher-quality cloud voice (Gemini or ElevenLabs), or to switch providers/voices.
argument-hint: "[optional: gemini | elevenlabs]"
---

# Configure narrate (TTS provider & key)

narrate works immediately with the **OS's built-in voice** (no key), so this is an
**optional upgrade** step. Run it when the user wants higher-quality cloud
narration or to switch providers/voices. Settings and keys are **global** — saved
once in `~/.narrate/settings.json` and used by every project — with optional
per-project overrides in the gitignored `./.narrate/settings.local.json`.

## The CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" <command> …
```

(In the source monorepo: `pnpm narrate …`.)

## Steps

1. **Check what's already set.** Run `check` first — if the global settings already
   have the provider/key the user wants, there's nothing to do:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check
   ```
   The `config:` line shows each value's origin (`global`, `project`, `default`).

2. **Pick a provider + get a key.** If `$ARGUMENTS` already names a provider, use
   it; otherwise ask the user which they want:
   - **Gemini** — free key at https://aistudio.google.com/apikey
   - **ElevenLabs** — key from https://elevenlabs.io (dashboard → API key)
   - (Or keep the **OS voice** / use `mock` for silent — no key needed; nothing to do.)

3. **Save it — without the key ever entering the chat.** Never ask the user to
   paste the key into the conversation, and never put it on a command line you
   run (both land in the transcript). Instead, tell them to **copy the key**, then
   run this themselves with the `!` prefix, giving them the command with the
   plugin path filled in:
   ```bash
   ! node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" set-key <gemini|elevenlabs> --clipboard
   ```
   It reads the key from the clipboard and only prints it masked (`sk_…d286`).
   In a regular terminal, omitting both the key and `--clipboard` prompts for it
   with hidden input; it can also be piped on stdin. If the user already pasted
   a key into the chat, suggest rotating it.
   This writes the key into that provider's block (`tts.gemini.key` /
   `tts.elevenlabs.key`) and sets `tts.provider` in the **global**
   `~/.narrate/settings.json`. Only if the user explicitly wants this setting for
   the current project alone, add `--project` (writes the gitignored
   `./.narrate/settings.local.json`, which overrides global). Tune the voice/model later under
   `tts.gemini` (voices like `Kore`) or `tts.elevenlabs` (an ElevenLabs voice id).

   **ElevenLabs voice (important on the free plan):** free plans can only use
   *premade* voices via the API — *library* voices return HTTP 402, and which ids
   work varies by account. List what the key can use and lock one in:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" voices        # shows ids + names (+ category)
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" set-voice <voice_id>   # prefer a "premade" one (add --project for this project only)
   ```

4. **Validate.** Confirm everything is ready:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check
   ```
   Expect `RESULT: PASS`. If it prints `ffmpeg: MISSING`, give install instructions
   (ffmpeg + ffprobe must be on PATH — the one manual dependency). If a render later
   fails with an ElevenLabs **402**, the chosen voice isn't free-tier usable — run
   `voices` and `set-voice` to switch to a `premade` one.

5. **Report.** Tell the user the active provider/voice and where it was stored. For
   the default (global) case: it's in `~/.narrate/settings.json`, so `/narrate-video`
   and `/narrate-demo` use it automatically in **every** project — no need to re-run
   setup per project. Any project can still override values in its
   `.narrate/settings.local.json`.

## Notes

- **Manual edit** is fine too: open `~/.narrate/settings.json` (global) or
  `./.narrate/settings.local.json` (project override), set `tts.provider`, and fill
  the matching block — `tts.<provider>.key` plus its `voice`/`model`. A project file
  only needs the keys it overrides.
- **CI:** instead of storing the key in the file, set `NARRATE_GEMINI_API_KEY` /
  `NARRATE_ELEVENLABS_API_KEY` in the environment — an in-file `key` takes
  precedence, the env var is the fallback (override the var name via
  `tts.<provider>.apiKeyEnv`).
