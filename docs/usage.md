# Usage

Two ways to use narrate: as a **Claude Code plugin** (`/narrate-video`) or as a
**standalone CLI**.

## Requirements

- **Node ≥ 18**
- **ffmpeg + ffprobe** on your PATH — the only manual dependency. The Playwright
  package is auto-installed on first render and an installed Edge/Chrome is used
  if present (otherwise Chromium is downloaded once).
- For real narration, a **TTS API key** (Gemini by default). No key? `--provider os`
  uses the OS voice, or `--provider mock` is silent. See [configuration.md](./configuration.md).

## As a Claude Code plugin

Install from the marketplace:

```
/plugin marketplace add tomek-i/narrate-plugin
/plugin install narrate@narrate-marketplace
```

Then, from inside any project, describe what you want demoed:

```
/narrate-video the signup flow using test@example.com and a valid password
```

The agent investigates the project, starts the dev server, scripts the
walkthrough as a scene, records + narrates it, and drops the finished video in
your repo. You can also just ask in plain language ("record a narrated
walkthrough of the dashboard") — the `narrate-video` skill auto-triggers.

Not sure it's wired up? Run **`/narrate-demo`** (skill) — it renders a built-in demo app
end-to-end (no project, dev server, or website of your own needed) and writes
`./docs/narrate-demo.mp4`.

### Conventions

- Intermediate files (scene JSON, per-beat audio, raw video) go in
  **`./.narrate/tmp/`** and are cleaned up after; `.narrate/` is added to your
  project's `.gitignore`.
- The finished video is copied to **`./docs/<slug>.mp4`** in your repo.

## As a CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" init                  # scaffold .narrate/settings.local.json
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" set-key gemini AIza…  # save a key + pick the provider
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" check                 # validate ffmpeg + config + key (exit 0/1)
node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs" render --scene scene.json
# or in the source monorepo:
pnpm narrate render --scene packages/plugin/examples/demo.scene.json
```

`init` writes `.narrate/settings.local.json` (config + keys in one file) and
gitignores `.narrate/`. `set-key` stores an API key there and switches the active
provider. `check` is a deterministic preflight you can run anytime.

Flags (`render`):

| Flag                | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `-s, --scene <f>`   | scene JSON file (required)                          |
| `-o, --out <dir>`   | output directory (default `out`, or config value)   |
| `-c, --config <f>`  | config file (default `.narrate/settings.local.json`)|
| `--provider <p>`    | override TTS provider (`gemini`/`elevenlabs`/`os`/`mock`)|
| `--voice <v>`       | override voice                                      |

Keyless smoke test (silent narration, exercises the whole pipeline):

```bash
pnpm narrate render --scene packages/plugin/examples/demo.scene.json --provider mock
```

Authoring scenes (format + full step reference): [scenes.md](./scenes.md).
