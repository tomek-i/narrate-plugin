# narrate

Generate **narrated walkthrough videos** of a web app. Describe what you want
demoed; narrate scripts the walkthrough, records the browser, speaks each step
with a TTS voice, and produces a single narrated MP4.

It runs as a **Claude Code plugin** (`/narrate <prompt>`) and as a standalone
**CLI / library** (`@narrate/core`). The browser is recorded in one continuous
headless pass paced to the narration, so audio lines up with **zero manual
syncing** — see [docs/architecture.md](./docs/architecture.md).

## Quick start

**As a Claude Code plugin** — install, then ask from inside any project:

```
/plugin marketplace add tomek-i/narrate
/plugin install narrate@narrate-marketplace

/narrate the signup flow using test@example.com and a valid password
```

The agent gets your app running, scripts the scene, records it, and drops the
video at `./docs/<slug>.mp4`.

**As a CLI:**

```bash
pnpm install
pnpm narrate render --scene scenes/portfolio.example.json --provider mock
# → out/portfolio.mp4   (mock = silent dry run, no API key needed)
```

## Requirements

**ffmpeg + ffprobe** on your PATH is the only manual dependency — Playwright +
Chromium are auto-provisioned on the first render. For real narration, add a TTS
API key (Gemini by default; `--provider mock` needs none).

## Documentation

- [Usage](./docs/usage.md) — plugin + CLI, conventions, flags
- [Scenes](./docs/scenes.md) — scene format + full step reference
- [Configuration](./docs/configuration.md) — config file, TTS providers, API keys
- [Architecture](./docs/architecture.md) — how it works, distribution, roadmap
- [Development](./docs/development.md) — monorepo, build, the committed bundle

## License

MIT © Thomas Iwainski
