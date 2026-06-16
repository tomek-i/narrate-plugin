# Development

pnpm monorepo. Two packages: `@narrate/core` (engine + CLI) and `@narrate/plugin`
(the Claude Code plugin, with the bundled CLI in `bin/`).

## Setup

```bash
pnpm install
pnpm exec playwright install chromium   # for running renders locally
```

## Common tasks

| Command | What it does |
| --- | --- |
| `pnpm narrate render --scene <f>` | run the CLI from source (tsx) |
| `pnpm --filter @narrate/core build` | build `dist/` **and** the plugin bundle |
| `pnpm --filter @narrate/core test` | unit tests (`node:test`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | Biome check / write |
| `pnpm --filter @narrate/core gen:schema` | regenerate the JSON schemas from zod |

## Build & the committed bundle

`packages/core/tsup.config.ts` emits two things:

1. `packages/core/dist/` — the library + CLI (ESM + d.ts).
2. `packages/plugin/bin/narrate.mjs` — a self-contained bundle (deps inlined,
   `playwright` external) that the plugin ships.

**The bundle is committed**, because a plugin installed from the marketplace has
no build step. So whenever you change anything under `packages/core/src/`:

```bash
pnpm --filter @narrate/core build   # rebuild the bundle before committing
```

If you change the zod schemas in `src/types.ts`, also run `gen:schema` so the
`narrate.*.schema.json` files stay in sync.

## Testing the full pipeline without a key

```bash
pnpm narrate render --scene scenes/portfolio.example.json --provider mock
```

`mock` produces silent audio sized to the text, so it exercises TTS timing,
recording, pacing, and the ffmpeg mux end to end (just without real speech).
