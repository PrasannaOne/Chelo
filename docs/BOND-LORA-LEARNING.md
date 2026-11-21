# Bond LoRA learning upgrade and validation

## What changed

Chelo keeps the shared V37 weights frozen. Each pet retains its own compact rank-1 Bond hidden-bias adapter (`aW`, `aB`, `b`) in its `.chelo` record; Arena remains a separate rank-2 adapter and is not trained from unauthenticated local exhibitions.

The old Bond update treated the final game result as a label for every position in the game. That signal was too noisy: the prior three-run, 503-position evaluation showed worse held-out value-sign accuracy at every milestone. That direct game-winner-to-evaluator update has been removed.

The new trainer uses **same-position counterfactual tactical pairs**:

1. From a recorded trainer position, enumerate legal moves for the pet.
2. Mark captures/promotions and checkmates as positive material outcomes, accounting for an immediate legal recapture of the moved piece.
3. Mark moves that allow an immediate recapture of the moved piece as negative examples.
4. Compare positive and negative child positions from the same parent FEN, so pre-existing material advantage is not mistaken for move quality.
5. Mine the most confusing candidate contrasts, sample at most 16 parent positions and train on up to 48 pairs per completed game.
6. Apply importance-weighted, bounded Int8 gradient steps with weight decay. Keep the V37 base binary untouched.
7. Hold back complete parent positions from the gradient. Try progressively smaller update scales and retain an update only when pairwise logistic loss improves on those held-back positions. Otherwise reject it.

Completed-game results still update memories, growth and challenge calibration, but no longer push the evaluator directly with a noisy win/loss label. The match-result UI distinguishes an accepted adapter update, a validation-rejected update and a match without clear tactical pairs.

## How the pet uses it

Once a Bond update has been accepted, the developmental selector consults the adapter delta while ranking its legal candidate moves. The first game remains uniform random legal play. The adapter does not secretly turn a hatchling into the full V37 search engine: the broader V37 search is still blended in gradually from the existing developmental schedule.

The Arena adapter remains isolated. It requires the future independently attested Arena ingestion route; friend exhibitions or trainer games cannot write to it.

## Reproducible benchmark

Run from the repository root:

```bash
node tests/lora-milestone-benchmark.test.js
```

The benchmark uses three independent 50-game training runs (150 simulated games total), fixed seeded random-legal games capped at 70 plies, and a separate hold-out generated from different seeds. The hold-out contains 60 parent positions and 182 positive/negative comparisons. A harder subset is fixed before training: the 72 comparisons with the smallest baseline V37 score margins.

| Milestone | Mean held-out margin | Mean hardest-subset margin |
|---:|---:|---:|
| Frozen V37 baseline | 151.5 cp | 68.5 cp |
| 5 games | 158.4 cp | 72.7 cp |
| 10 games | 166.1 cp | 77.4 cp |
| 25 games | 189.9 cp | 90.6 cp |
| 50 games | 210.7 cp | 105.2 cp |

At 50 games, all three independent runs improved both overall and hardest-subset mean margins. Overall pair accuracy averaged **98.54%**, compared with **98.35%** at baseline. Hard-subset accuracy averaged **96.30%**, compared with **95.83%** at baseline. The accuracy gains are modest; the larger and consistent signal is the increase in evaluation margin.

At each milestone, `.chelo` export/import restored the trained Bond adapter tensors and step counter exactly. In these runs, the largest complete Free `.chelo` file was 73,279 bytes, below the 102,400-byte file limit.

The detailed per-run results are in `BOND-LORA-BENCHMARK-RESULTS.json`.

## What this proves, and what it does not

This benchmark measures whether the adapted evaluator increasingly ranks clear one-ply material wins above immediate piece hangs on unseen positions. It is a focused tactical preference proxy. It is **not** a head-to-head Elo test, a tournament-strength claim, or proof of strategic learning across openings, long-term plans, king safety, positional sacrifices or human playing styles.

The native/WASM parity suite is also run with an adapter produced by the production Bond trainer, rather than only hand-seeded test weights. A separate developmental test verifies that the early move selector calls the trained adapter before full V37 search is enabled.

Further strength claims require larger position corpora, tactical suites with deeper refutations, paired-colour UCI matches and measurements on the target Android device.
