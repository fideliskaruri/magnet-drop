# AGENTS.md

## Stack
- Vite + TypeScript (strict) + a raw HTML canvas. No framework: this is a canvas game.
- Scripts run on Node with `--experimental-strip-types`. TypeScript only uses erasable syntax (`erasableSyntaxOnly`), so there are no parameter properties or enums, and imports use `.ts` extensions.

## Rules
- **No unit tests.** The evidence is:
  - `pnpm sim`: a fairness solver that runs over the real physics.
  - `pnpm verify`: real headless Edge play-throughs with screenshots.
- Browser checks always run headless.
- Keep `src/physics.ts` pure, with no DOM access. Both the game and `scripts/sim.ts` depend on it.
- After changing physics or patterns, run `pnpm sim`. Every pattern must stay solvable from every start.
- Tuning lives in `src/config.ts`. Don't scatter magic numbers.
- `window.__md` is dev-only (`import.meta.env.DEV`). Keep it out of production bundles.

## Deploy
Pushing to `main` builds the game and deploys it to GitHub Pages through `.github/workflows/pages.yml`. The base path is `/magnet-drop/`.
