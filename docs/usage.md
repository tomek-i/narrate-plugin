# Usage

Two ways to use narrate: as a **Claude Code plugin** (`/narrate`) or as a
**standalone CLI**.

## Requirements

- **Node ≥ 18**
- **ffmpeg + ffprobe** on your PATH — the only manual dependency
  (Playwright + Chromium are auto-provisioned on the first render)
- A **TTS API key** (Gemini by default), or `--provider mock` for a keyless,
  silent dry run. See [configuration.md](./configuration.md).

## As a Claude Code plugin

Install from the marketplace:

```
/plugin marketplace add tomek-i/narrate
/plugin install narrate@narrate-marketplace
```

Then, from inside any project, describe what you want demoed:

```
/narrate the signup flow using test@example.com and a valid password
```

The agent investigates the project, starts the dev server, scripts the
walkthrough as a scene, records + narrates it, and drops the finished video in
your repo. You can also just ask in plain language ("record a narrated
walkthrough of the dashboard") — the `narrate-walkthrough` skill handles it.

### Conventions

- Intermediate files (scene JSON, per-beat audio, raw video) go in
  **`./.narrate/tmp/`** and are cleaned up after; `.narrate/` is added to your
  project's `.gitignore`.
- The finished video is copied to **`./docs/<slug>.mp4`** in your repo.

## As a CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene scene.json
# or in the source monorepo:
pnpm narrate render --scene scenes/portfolio.example.json
```

Flags:

| Flag                | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `-s, --scene <f>`   | scene JSON file (required)                          |
| `-o, --out <dir>`   | output directory (default `out`, or config value)   |
| `-c, --config <f>`  | config file (default `narrate.config.json`)         |
| `--provider <p>`    | override TTS provider (`gemini`/`elevenlabs`/`mock`)|
| `--voice <v>`       | override voice                                      |

Keyless smoke test (silent narration, exercises the whole pipeline):

```bash
pnpm narrate render --scene scenes/portfolio.example.json --provider mock
```

Authoring scenes (format + full step reference): [scenes.md](./scenes.md).
