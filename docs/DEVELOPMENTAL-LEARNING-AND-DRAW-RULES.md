# Chelo developmental learning and draw guardrails

## Design goal

A new Chelo must not inherit the strength of the hosted V37 engine simply because the engine is available to the application. It should begin as a chess pet that knows only which moves are legal, then gain chess judgement through completed play with its trainer.

## Hatchling progression

The first phase uses a developmental move selector in the app and Worker. It samples uniformly from the legal move list and does not ask V37, C++ search, the neural evaluator or the Polyglot opening book to choose a move.

| Completed trainer games | Behaviour | Random share within developmental path | Full V37 search probability |
|---:|---|---:|---:|
| 0 | Piece mover: legal moves only | 100% | 0% |
| 1 | Curious hatchling: broad exploration with occasional simple material awareness | 88% | 0% |
| 2–3 | Learner: starts noticing captures and immediate piece danger | 70% | 0% |
| 4–5 | Beginner: one-reply material/safety awareness plus position/move memory | 45% | 0% |
| 6–8 | Beginner: more consistent material safety and memory use | 32% | 0% |
| 9–11 | Apprentice: stronger simple evaluation | 22% | 0% |
| 12–16 | V37 begins blending into move selection | 16% | 5% |
| 17–24 | Gradual engine integration | 12% | 15% |
| 25–35 | More engine decisions, fewer deliberate mistakes | 8% | 35% |
| 36–50 | Search becomes the majority choice | 5% | 60% |
| 51–75 | Advanced search is used most of the time | 3% | 85% |
| 76+ | Mature engine-trained companion | 1% | 100% |

The engine probability is per move. The random percentage is conditional on the engine path not being selected; the remaining developmental turns use the simple material/safety chooser. That chooser samples among a bounded group of candidates rather than always playing the top-ranked move. At four to five completed games, Chelo is meant to remain beatable and imperfect; it is not advertised as having a measured Elo rating.

## What constitutes learning

- A completed trainer game updates the compact Bond adapter when the V37 prediction has a meaningful training residual. Bond is trainer-specific; it does not train the Arena adapter.
- The pet records a position/move memory and applies final-result feedback to the moves it selected.
- When the trainer immediately captures the piece Chelo just moved onto a square, that exact position/move memory receives an additional negative lesson.
- The early developmental selector uses those position/move memories alongside simple material and one-reply piece-safety checks. Later C++/WASM V37 search consumes the trained Bond adapter.
- A Bond step or memory update is evidence of a training operation, not proof of a population-level Elo increase. A paired match benchmark is still required before making strength claims.

## Draw guardrails

The rules core follows the FIDE distinction:

- Threefold repetition and the 50-move rule are claimable draws.
- Fivefold repetition and the 75-move rule are automatic draws.
- Checkmate takes precedence over the automatic 75-move draw.

For frictionless casual single-player play, Chelo automatically claims a draw for the side to move as soon as threefold repetition or the 50-move threshold is reached. This prevents repeated shuffle games from continuing indefinitely. The result dialog names the exact reason. Position identity includes side to move, castling rights, and en-passant availability only when a legal en-passant capture exists.

## Validation scope

`tests/developmental-learning.test.js` verifies uniform legal-only hatchling moves, the beginner's free-capture recognition, the engine blend gate, Bond updates over five controlled outcomes, immediate capture feedback, and the claimable/automatic draw thresholds. It is a deterministic behaviour regression suite, not a measured Elo benchmark.
