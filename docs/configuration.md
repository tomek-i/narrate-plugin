# Configuration

## `.narrate/settings.local.json`

One file holds **both** settings and API keys. It lives in `.narrate/`, which is
gitignored, so the keys are never committed. All fields are optional — omit the
file (or any field) to use defaults. Scaffold it with `narrate init`. The default
provider is the **OS voice** (no key), so narrate works out of the box; upgrade to
a cloud voice with `narrate set-key` (or the `/narrate-setup` skill).

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/tomek-i/narrate-plugin/main/narrate.schema.json",
  "tts": {
    "provider": "gemini",                      // gemini | elevenlabs | os | mock
    "gemini": {                                // settings for the gemini provider
      "key": "AIza…",                          // its API key (only the active provider's is used)
      "voice": "Kore",
      "model": "gemini-2.5-flash-preview-tts",
      "apiKeyEnv": "MY_CUSTOM_KEY_VAR"         // optional: env-var fallback name
    },
    "elevenlabs": {                            // settings for the elevenlabs provider (differ from gemini's)
      "key": "",
      "voice": "9BWtsMINqrJLrRacOk9x",         // an ElevenLabs voice id ("Aria", a default voice)
      "model": "eleven_multilingual_v2"
    }
  },
  "output": {
    "dir": "out",                              // overridden by --out
    "width": 1440,
    "height": 900,
    "fps": 25,
    "format": "mp4",                           // mp4 | webm
    "crf": 16                                  // encode quality; lower = sharper / less banding (try 14 for stubborn dark-UI flicker)
  },
  "overlay": {
    "cursor": true,                            // glide a synthetic cursor onto elements before click/hover/type
    "highlight": true,                         // enable the `highlight` step + beat `focus`
    "style": "ring",                           // default highlight style: ring | glow | spotlight
    "holdMs": 3000,                            // how long a highlight pulses before fading back to the clean page
    "color": "#6366f1"                         // accent for cursor, ripple, and highlights
  }
}
```

### On-screen overlays (`overlay`)

To draw attention to what the narration is describing, narrate injects a visual
layer **into the recorded page**: a synthetic cursor that glides to elements, a
click ripple, and element highlights (ring / glow / spotlight, with optional
labels). It's drawn in a `pointer-events:none` layer, so it shows up in the video
but never blocks the real interactions and never touches your OS cursor — it works
headless on any site. All on by default; set any flag to `false` to disable it
(e.g. `"cursor": false` for highlights only).

Two distinct roles keep it from feeling random:
- **Cursor = interaction.** It automatically glides to every element a step acts
  on (click/hover/type/fill/…), so interactions read like a real user — consistent
  by construction.
- **Highlights = brief accents.** A `focus`/`highlight` pulses for `holdMs` (default
  3s) then **fades back to the clean page**, rather than sitting on screen for the
  whole 10–15s beat (which would obscure the page and blur real vs. animated). Use
  them to point at what the narration is describing, not on every interaction.

Drive highlights from scenes via the beat `focus` field or the `highlight`/`point`
steps — see [scenes.md](./scenes.md).

mp4 output uses H.264 video + **MP3** audio (MP3 so VS Code's preview, which can't
decode AAC, still plays sound), with `+faststart` and screen-content tuning
(deband, dark-biased AQ, flat I/P/B quality, no scene-cut keyframes) to avoid
flicker/banding on flat dark UIs. If flicker persists, lower `crf` (e.g. 14).

Override per run with `--provider`, `--voice`, and `--out`.

## TTS providers & API keys

Each provider has its own settings block under `tts` (voice, model, key, …), since
they differ. The key lives in that block — `tts.<provider>.key` — in the gitignored
`.narrate/settings.local.json`, so it's never committed. The fastest way to set one:

```bash
narrate set-key gemini AIza…        # writes tts.gemini.key and switches the provider
narrate set-key elevenlabs sk_…     # writes tts.elevenlabs.key and switches the provider
```

| Provider     | Settings block   | Notes                                          |
| ------------ | ---------------- | ---------------------------------------------- |
| `os`         | — (none)         | **default**; the OS's built-in voice, no key (Linux needs `espeak`) |
| `gemini`     | `tts.gemini`     | `key`, `voice` (e.g. `Kore`), `model`          |
| `elevenlabs` | `tts.elevenlabs` | `key`, `voice` (an ElevenLabs voice id), `model` |
| `mock`       | — (none)         | silent audio sized to the text; keyless dry run |

Only the **active** provider's block is used; the others can sit pre-filled (e.g.
both keys saved) but unused until you switch `tts.provider`.

For CI, a key can instead come from an env var: `NARRATE_GEMINI_API_KEY` /
`NARRATE_ELEVENLABS_API_KEY` (or a custom name set via `tts.<provider>.apiKeyEnv`).
The `key` in the file takes precedence; the env var is the fallback.
