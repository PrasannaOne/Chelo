# Chessling V4 — next engineering steps

This is the current candid backlog for the next development pass.

## Critical AI work

1. Independently audit the turn-perspective and terminal-result handling in online TD updates for human games, self-play, checkmate, stalemate, claims and interrupted games.
2. Evaluate whether one-step TD plus final-result replay is sufficient or should become TD(lambda), n-step returns, or a more explicit per-game trajectory learner.
3. Extend `benchmarks/duel.js` with larger opening suites, confidence intervals, baseline snapshots and a measured held-out baseline before claiming strength gains.
4. Test whether the 24 handcrafted features capture enough board information. Explore compact piece-square encodings or a tiny spatial network only if mobile performance and the 50 KiB limit remain acceptable.
5. Test whether self-play between identical copies produces useful data or requires frozen opponent snapshots / a small local opponent league.
6. Consider a learned move-policy head only after the value model is validated.

## Product / infrastructure work

1. Implement server-side target-move attestation before Arena Elo is enabled.
2. Enforce at most three ranked matches per challenger trainer against a target pet per UTC day, atomically in D1. Self-play is never rated.
3. Connect the local UI to safe Arena APIs only after identity, ownership and rate-limiting flows are reviewed.
4. Add real Pro entitlements before activating practice fast-forward or multi-pet slots.
5. Review cloud sync and brain backup against the exact 51,200-byte per-pet compact payload limit.
6. Test current app on real Android browsers and low-memory devices.

## Do not misrepresent

- Model update count is not chess strength.
- Synthetic convergence is not a chess benchmark.
- Growth Rating is not Arena Elo.
- Legal PGN replay alone does not prove the target pet played the moves.
- A premium skip button must not become a premium intelligence advantage.
