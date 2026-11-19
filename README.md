# Chessling — First Playable

A small, offline-first foundation for the Chessling project. This is the first playable slice: a real chessboard, a local AI opponent, a persistent learning brain, and Soul export/import.

## Run it

- **Quick local test:** open `index.html` in a modern browser. Chess, learning, and local saves work. Service-worker installation is available when served over localhost/HTTPS.
- **Recommended:** upload the folder to a GitHub repository and enable GitHub Pages for private testing, or serve it locally with any static file server. The app has no external runtime dependencies.

## What's included

- `index.html` — interface and game layout
- `style.css` — responsive styling
- `chess.js` — bundled, dependency-free chess rules engine
- `brain.js` — local learning and 50 KB brain budget
- `app.js` — board interaction and game loop
- `sw.js` — offline cache
- `manifest.json`, `icon.svg` — installable web-app metadata and icon

## First-playable behaviour

- You play White; Chessling plays Black.
- Legal moves include castling, en passant, promotion, checkmate, stalemate, fivefold repetition, and the automatic 75-move draw condition.
- Chessling starts at a **100 growth rating**. This is a prototype progression rating, not yet a calibrated online Elo rating.
- It records position/move observations as moves happen. Match results later reinforce or weaken the remembered decisions.
- The pet brain is saved locally and pruned to stay under a hard 50 KiB serialized-data budget.
- Soul export/import carries the pet's name, rating, record, generation, weights, and position memories.

## Honest prototype notes

This is a playable learning-system prototype, not a claim of human-level chess intelligence. Its current AI uses a compact search and an adaptive position-memory/evaluation system. Its growth rating is a local game progression signal; the global arena will need a proper opponent-based Elo calculation and server-verified match results. The first playable does not include accounts, global arena, payments, pet-vs-pet matchmaking, or multi-pet Pro features.

## Next engineering checks

1. Browser testing across Android Chrome and desktop browsers.
2. Verify legal-move edge cases and promotion UX.
3. Measure real serialized brain size after long play sessions.
4. Validate that learning improves move selection over controlled repeatable tests.
5. Add automated tests and arena features only after the local core is stable.

## Run the smoke tests

With Node.js installed, run:

```bash
node tests/smoke.test.js
```

The tests check standard-position move counts, a special-move-heavy position, en passant, promotion, checkmate, Soul portability, and the 50 KiB brain cap.
