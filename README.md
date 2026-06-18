# narrate

Generate **narrated walkthrough videos** of a web app. Describe what you want
demoed; narrate scripts the walkthrough, records the browser, speaks each step
with a TTS voice, and produces a single narrated MP4.

It runs as a **Claude Code plugin** (`/narrate-video <prompt>`) and as a standalone
**CLI / library** (`@narrate/core`). The browser is recorded in one continuous
headless pass paced to the narration, so audio lines up with **zero manual
syncing** — see [docs/architecture.md](./docs/architecture.md).

## Quick start

**As a Claude Code plugin** — install, then ask from inside any project:

```
/plugin marketplace add tomek-i/narrate-plugin
/plugin install narrate@narrate-marketplace

/narrate-demo                                              # see it work, zero setup
/narrate-video the signup flow using test@example.com and a valid password
/narrate-setup                                             # optional: add a cloud TTS key
```

`/narrate-demo` renders a built-in demo app end-to-end. `/narrate-video <prompt>`
gets *your* app running, scripts the scene, records it, and drops the video at
`./docs/<slug>.mp4`. Both work **out of the box with the OS voice** — no key needed.
`/narrate-setup` is optional: it stores a Gemini/ElevenLabs key for higher-quality
cloud narration.

**As a CLI:**

```bash
pnpm install
pnpm narrate render --scene packages/plugin/examples/demo.scene.json --provider mock
# → out/narrate-demo.mp4   (mock = silent dry run, no API key needed)
```

## Requirements

**ffmpeg + ffprobe** on your PATH is the only manual dependency — Playwright +
Chromium are auto-provisioned on the first render. Narration works out of the box
with the **OS voice** (no key; Linux needs `espeak`). For studio-quality cloud
narration, add a Gemini/ElevenLabs key via `/narrate-setup` (or `narrate set-key`).

## Documentation

- [Usage](./docs/usage.md) — plugin + CLI, conventions, flags
- [Scenes](./docs/scenes.md) — scene format + full step reference
- [Configuration](./docs/configuration.md) — config file, TTS providers, API keys
- [Architecture](./docs/architecture.md) — how it works, distribution
- [Development](./docs/development.md) — monorepo, build, the committed bundle
- [Roadmap](./docs/roadmap.md) — planned features and the reasoning behind them

## License

MIT © Thomas Iwainski
