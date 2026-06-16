# Architecture

## Pipeline

```
render --scene scene.json
   │
   ├─ 1. TTS     synth audio per beat → measure each one's real duration
   ├─ 2. RECORD  one continuous headless Playwright run; each beat is held on
   │             screen for exactly its narration duration (no dead gaps)
   └─ 3. MUX     concatenate narration + overlay on the trimmed video → <name>.mp4
```

## Why one continuous recording

The recorder drives the **whole scene in a single browser session**, pacing each
beat to its measured narration length. Because the video timeline tracks
wall-clock and every beat occupies exactly its audio's duration, the concatenated
narration lines up with the visuals with **zero manual syncing**.

This is deliberately *not* an agent-in-the-loop design: if an AI agent clicked
through the app step by step (e.g. via the Playwright MCP), every tool call would
add latency and gaps, the video would be wall-clock-jittery, and the audio would
drift. The agent's job is to *author the scene*; the engine does the recording.

## Distribution

The engine is published two ways from one source:

- **`dist/`** — the `@narrate/core` library + CLI (`tsup` ESM + d.ts).
- **`packages/plugin/bin/narrate.mjs`** — a self-contained bundle for the Claude
  Code plugin. `commander`/`zod`/`dotenv` are inlined; **`playwright` is left
  external** because the Chromium *binary* (~150 MB) can't be bundled into JS.

On the first `render`, the engine auto-provisions Playwright + Chromium next to
the bundle (`narrate setup` does this explicitly). So the only dependency a user
must install themselves is **ffmpeg**.

> The committed bundle must be rebuilt whenever core source changes —
> see [development.md](./development.md).

## Repo layout

```
narrate/
├── .claude-plugin/marketplace.json   # plugin marketplace (this repo)
├── packages/
│   ├── core/      # @narrate/core — engine + `narrate` CLI + tests
│   └── plugin/    # Claude Code plugin: /narrate command, skill, bundled bin/
├── scenes/        # example scene(s)
├── docs/          # this documentation
└── narrate.{config,scene}.schema.json   # generated from the zod schemas
```

Planned features and their rationale live in [roadmap.md](./roadmap.md).
