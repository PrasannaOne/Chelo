# Chelo V14 · Stage 3.9 release report

**Package:** `Chelo-V14-Stage3.9.zip`  
**Base:** frozen Stage 3.8 source tree  
**NNUE model:** `models/dual-nnue-v37.bin` (49,368 bytes)  
**Pinned SHA-256:** `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`

## Stage 3.9 changes

- Tightened the search hard-deadline polling interval to exactly 1,024 searched nodes (`(nodes & 1023) === 0`) while retaining the existing node ceiling and shared-worker cancellation checks.
- Preserved the Stage 3.8 packed-move / typed-buffer FastBoard, incremental Zobrist, incremental dual-NNUE accumulator, and existing search baseline. No unverified new search heuristic was introduced in this release pass.
- Bumped the PWA cache namespace to `chelo-shell-v18-stage39` so clients do not reuse the previous shell cache.
- Updated the UCI engine identity and release documentation.

## Verification performed

- ChessCore perft: start position depth 4 = **197,281**; Kiwipete depth 3 = **97,862**.
- FastBoard perft: start position depth 4 = **197,281**; Kiwipete depth 3 = **97,862**.
- V15 Soul compatibility: legacy-branded Chessling Soul V15 import and adapter payload parity passed.
- Dual-NNUE: 49,368-byte model loaded; incremental make/unmake parity passed; model SHA-256 matched the pinned value.
- Search time-budget smoke test: 20 ms request returned a legal move and stopped at the first 1,024-node polling boundary (57 ms in this cold test process).

## Explicitly not claimed

No UCI gauntlet or Stage 3.9-vs-3.8 Elo match was run for this package, as requested. No new Elo gain, 2x–3x NPS improvement, zero-GC result, or 500 ms / 520 ms physical-device timing guarantee is claimed. The Stage 3.8 search heuristics were retained as the frozen baseline because no verified regression evidence identifying a specific heuristic was present in the supplied baseline artifacts.
