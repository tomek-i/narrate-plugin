## What & why

<!-- What does this change and why? Link any related issue. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass locally
- [ ] If `packages/core/src` changed, I ran `pnpm --filter @narrate/core build` and committed the updated `packages/plugin/bin/narrate.mjs`
- [ ] If the zod schemas changed, I ran `pnpm --filter @narrate/core gen:schema`
- [ ] Docs updated if behavior or the scene format changed
