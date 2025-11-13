# AI Council Test Suite

A quick reference for keeping the project green.

## What’s Covered
- **Module checks.** Vitest exercises persona loading, panel resolution, moderator routing, and CLI option parsing using fixtures in `tests/fixtures/`.
- **Debate loop.** Stubbed Ollama calls verify transcript windows, streaming hooks, error surfacing, and judge hand‑off logic end to end.
- **Prompt hygiene.** Snapshot-like assertions catch regressions in speaker instructions and output cleaners so personas stop hallucinating “me:” artifacts or imaginary turns.

## Running Tests
- `npm test` – full suite (fast, <1s on a laptop).
- `npm run test:watch` – reruns on file changes during development.

## When to Run What
- **Before every commit/PR:** `npm test`.
- **Before tagging a release:** run the suite plus a quick manual smoke (`npm run dev -- --panel core`) to confirm streaming looks right.
- **After editing personas/panels:** add/update fixtures under `tests/fixtures/` so coverage matches the new data.
