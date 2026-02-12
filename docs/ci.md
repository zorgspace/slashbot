# CI Pipeline

Slashbot CI runs a single quality job on push/PR:

1. Install dependencies with `bun install --frozen-lockfile`
2. Run `bun run typecheck`
3. Run `bun run lint` (baseline lint scope)
4. Run `bun run test`
5. Run `bun run build`

Workflow file: `.github/workflows/ci.yml`.

## Why This Baseline

- Type safety and lint checks catch regressions early.
- Tests validate behavior before merge.
- Build step ensures distributable binary still compiles.

`bun run lint:full` remains available locally for full-repo lint debt cleanup.
