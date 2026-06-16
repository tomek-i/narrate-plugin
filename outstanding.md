# Outstanding — narrate

Handoff notes for continuing work on this repo. Created 2026-06-16.

## Current status (done & verified)

- ✅ pnpm monorepo scaffolded: `packages/core` (`@narrate/core` engine + `narrate` CLI) and `packages/plugin` (Claude Code plugin, skill `narrate-walkthrough`).
- ✅ Marketplace manifest at `.claude-plugin/marketplace.json`.
- ✅ Pluggable TTS: Gemini (default), ElevenLabs, Mock — `packages/core/src/tts/`.
- ✅ Continuous headless Playwright recorder (`src/record/playwright.ts`) — records the whole scene in one run, pacing each beat to its narration duration. **This is the sync fix**: no Claude in the loop, no cutting/marker-hunting.
- ✅ ffmpeg pipeline (`src/mux/ffmpeg.ts`): normalize → concat narration → trim lead-in → mux.
- ✅ Config + key resolution (`src/config.ts`): `narrate.config.json` + `NARRATE_*` keys in gitignored `.env.narrate`, with `tts.apiKeyEnv` override.
- ✅ `pnpm install` done, Playwright 1.61 Chromium installed, `pnpm typecheck` clean.
- ✅ End-to-end verified with `--provider mock` → produced `out/portfolio.mp4` (~54s). Audio was silent (mock), so **real-audio sync is not yet ear-verified** (see below).
- ✅ Example scene `scenes/portfolio.example.json` (theme toggle uses Playwright `role=` selector).

## Done in the 2026-06-16 continuation session

- ✅ **Distribution (Option B):** the engine is now tsup-bundled into the plugin at
  `packages/plugin/bin/narrate.mjs` (commander/zod/dotenv inlined; `playwright`
  external). The skill + a new `/narrate` command invoke it via
  `node "${CLAUDE_PLUGIN_ROOT}/bin/narrate.mjs"`. **The committed bundle must be
  rebuilt (`pnpm --filter @narrate/core build`) whenever core source changes.**
- ✅ **Lazy Playwright + `narrate setup`:** Playwright loads via dynamic import, so
  the CLI runs (and `setup` works) on a bare install. `narrate setup` installs
  Playwright + Chromium next to the bin. `packages/plugin/package.json` declares
  the `playwright` runtime dep.
- ✅ **Build:** `packages/core/tsup.config.ts` emits both the `dist` lib/CLI and the
  bundled plugin CLI. Verified the bundle runs the full pipeline (`--provider mock`
  → `out/smoke.mp4`).
- ✅ **Loose ends:** JSON Schemas generated from zod (`narrate.schema.json`,
  `narrate.scene.schema.json`, via `pnpm --filter @narrate/core gen:schema`);
  Biome config + `lint`/`format` scripts (repo lints clean); 5 unit tests
  (`pnpm test`); `applyTheme` (`next-themes`-style) assumption documented in SKILL.
- ✅ **VCS:** `.gitattributes` added; branch renamed `master` → `main`; initial commit made.

## Outstanding — priority order

### 1. Push to GitHub (manual — user is doing this)
- [ ] `gh repo create tomek-i/narrate` (private) and `git push -u origin main`.

### 2. Real-audio validation (needs an API key)
- [ ] Add `NARRATE_GEMINI_API_KEY` to `.env.narrate` and run a real render against a
  running site; confirm narration lines up with the visuals (mock is silent). The
  lead-in trim assumes `contextStart ≈ video start` — verify it's not off by a
  fraction; adjust if needed.

### 3. Verify the installed-plugin path end-to-end
- [ ] Install the plugin from the marketplace into a clean Claude Code, run
  `/narrate`, and confirm `narrate setup` provisions Playwright/Chromium next to the
  cached bin and a render succeeds. (Bundled + verified in-repo; the cache-copy
  scenario hasn't been exercised yet.)

## Gold-plating roadmap (later)
- [ ] Interactive (Claude-in-the-loop) recorder adapter — the "support both" path; uses the Playwright MCP for ad-hoc clips. Note: needs content-anchored sync, not wall-clock (see why in the README/history).
- [ ] "Code explanation" scene type — render highlighted code + narrate (a new scene/source kind).
- [ ] Captions / chapters track.
- [ ] More TTS providers; voice listing/preview command.

## How to resume

```bash
cd C:\Users\tomek\Documents\GitHub\PRIVATE\narrate
pnpm install                                   # if needed
cp .env.narrate.example .env.narrate           # add a key, or use --provider mock
# start your target site, then:
pnpm narrate render --scene scenes/portfolio.example.json --provider mock
# → out/portfolio.mp4
```

Origin POC (reference): `tom-cv-web-app/tools/video-narration/`.
