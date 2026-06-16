# Configuration

## `narrate.config.json`

Committable (no secrets). All fields are optional — omit the file to use defaults.

```jsonc
{
  "$schema": "./narrate.schema.json",
  "tts": {
    "provider": "gemini",                      // gemini | elevenlabs | mock
    "voice": "Kore",
    "model": "gemini-2.5-flash-preview-tts",
    "apiKeyEnv": "MY_CUSTOM_KEY_VAR"           // optional: read the key from any env var
  },
  "output": {
    "dir": "out",                              // overridden by --out
    "width": 1440,
    "height": 900,
    "fps": 25,
    "format": "mp4",                           // mp4 | webm
    "crf": 18                                  // encode quality; lower = sharper / less banding (try 16 for very flat dark UIs)
  }
}
```

mp4 output uses H.264 video + **MP3** audio (MP3 so VS Code's preview, which can't
decode AAC, still plays sound) with `+faststart`. If a dark/flat UI shows banding
or blocking, lower `crf` (e.g. 16).

Override per run with `--provider`, `--voice`, and `--out`.

## TTS providers & API keys

Keys live in a `.env.narrate` file, namespaced with `NARRATE_` to avoid colliding
with your app's own keys. The engine looks in **`.narrate/.env.narrate`** first
(the `.narrate/` dir is gitignored, so a key there is never committed — preferred),
then `.env.narrate` in the project root, then the environment. `narrate.config.json`
is likewise read from `.narrate/` first, then the root.

| Provider     | Env var                      | Notes                                  |
| ------------ | ---------------------------- | -------------------------------------- |
| `gemini`     | `NARRATE_GEMINI_API_KEY`     | default; voices like `Kore`            |
| `elevenlabs` | `NARRATE_ELEVENLABS_API_KEY` | set `tts.voice` to an ElevenLabs voice id |
| `mock`       | — (none)                     | silent audio sized to the text; keyless dry run |

Need a different variable name? Set `tts.apiKeyEnv` to any env var and narrate
reads the key from there.

Copy the template to get started:

```bash
cp .env.narrate.example .env.narrate   # then fill in a key
```
