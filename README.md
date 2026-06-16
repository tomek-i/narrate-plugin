# narrate

Generate **narrated walkthrough videos** of a website. Point it at a running site
and a scene script; it speaks each step with a TTS provider, records the browser,
and produces a single narrated video.

It runs as both:

- a **CLI / library** (`@narrate/core`) — no Claude in the loop, fully reproducible, and
- a **Claude Code plugin** — ask Claude to "record a narrated walkthrough" and it drives the same engine.

## How it works

```
narrate render --scene portfolio.json
        │
        ├─ 1. TTS    generate audio per beat  → measure each duration
        ├─ 2. RECORD one continuous headless Playwright run; each beat is held
        │           on screen for exactly its narration duration (no dead gaps)
        └─ 3. MUX    concatenate narration + overlay on the trimmed video → final.mp4
```

Because the recording is paced to the narration durations, the audio lines up with
zero manual syncing — the continuous run keeps the video timeline tracking
wall-clock, which is what makes this reliable.

## Requirements

- **Node ≥ 18** and **pnpm**
- **ffmpeg + ffprobe** on your PATH
- A **TTS API key** (Gemini by default), or use `--provider mock` for a keyless dry run

## Quick start

```bash
pnpm install
pnpm exec playwright install chromium      # if not already cached

cp narrate.config.example.json narrate.config.json
cp .env.narrate.example .env.narrate       # add NARRATE_GEMINI_API_KEY

# start your target site (the example expects http://localhost:9002)
pnpm narrate render --scene scenes/portfolio.example.json
# → out/portfolio.mp4
```

Keyless smoke test (silent narration, exercises the full pipeline):

```bash
pnpm narrate render --scene scenes/portfolio.example.json --provider mock
```

## Configuration

`narrate.config.json` (committable — no secrets):

```jsonc
{
  "tts": { "provider": "gemini", "voice": "Kore", "model": "gemini-2.5-flash-preview-tts" },
  "output": { "dir": "out", "width": 1440, "height": 900, "fps": 25, "format": "mp4" }
}
```

**API keys** live in `.env.narrate` (gitignored), namespaced to avoid collisions:

| Provider     | Env var                      |
| ------------ | ---------------------------- |
| `gemini`     | `NARRATE_GEMINI_API_KEY`     |
| `elevenlabs` | `NARRATE_ELEVENLABS_API_KEY` |

Need a different name? Set `tts.apiKeyEnv` in the config to any env var.

## Scenes

A scene is JSON: where to go, how big, and the ordered narrated beats.

```jsonc
{
  "name": "portfolio",
  "site": "http://localhost:9002",
  "viewport": { "width": 1440, "height": 900 },
  "theme": "dark",
  "beats": [
    { "id": "intro", "say": "Welcome…", "do": [{ "action": "scrollTo", "y": 220, "over": 2500 }] },
    { "id": "theme", "say": "Toggle the theme…",
      "do": [{ "action": "menu", "trigger": "button[aria-label='Toggle theme']", "item": "Light" }] },
    { "id": "detail", "say": "Open a role…",
      "do": [{ "action": "click", "selector": "a[href='/experience/ssw']" },
             { "action": "scrollThrough", "selector": "article", "over": 7000 }] }
  ]
}
```

**Step actions:** `wait`, `navigate`, `click`, `scrollTo`, `scrollThrough`, `menu` (trigger → item), `eval` (page JS escape hatch). Each beat is held for its narration length; if a beat's steps run longer, narrate warns so you can rebalance.

## Repo layout

```
narrate/
├── .claude-plugin/marketplace.json   # marketplace (a marketplace is just this repo)
├── packages/
│   ├── core/        # @narrate/core — engine + `narrate` CLI
│   └── plugin/      # Claude Code plugin (skill: narrate-walkthrough)
├── scenes/          # example scenes
└── narrate.config.example.json
```

## Use as a Claude Code plugin

```bash
/plugin marketplace add tomek-i/narrate
/plugin install narrate@narrate-marketplace
```

Then ask Claude to record a narrated walkthrough of your running site.

## Roadmap

- [ ] Interactive (Claude-in-the-loop) recorder adapter
- [ ] "Code explanation" scene type (render highlighted code + narrate)
- [ ] Chapters / captions track
- [ ] More TTS providers

## License

MIT © Thomas Iwainski
