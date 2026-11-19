# Chessling V4 — Learning Model Architecture

## 1. What V4 changes

V3 had adaptive heuristics: it changed stored move scores and a small set of hand-authored preferences after results. Those mechanics could remember a move and alter future choices, but they were not the deeper model-learning system requested for Chessling.

V4 adds a real, trainable neural value model inside each pet's local brain. The model is used by the actual chess search when it evaluates a position. The model is trained from game experience, rather than being a decorative statistic.

The shared chess code still owns the rules: legal moves, check, checkmate, castling, en passant, promotion, repetition and draw handling. The neural model does not learn the rules. It learns to estimate how promising a board position is for the side whose turn it is.

## 2. Model shape

The current model is a compact feed-forward neural network:

```text
24 position features
        ↓
12 tanh hidden units
        ↓
1 tanh value output in [-1, +1]
```

It has 313 trainable parameters:

- 24 × 12 input-to-hidden weights: 288
- 12 hidden biases
- 12 hidden-to-output weights
- 1 output bias

Each pet stores its own weights. The shared application contains the same model implementation and feature encoder for every pet. No model is downloaded from an AI API.

### Neutral start

The first layer begins with small deterministic random weights, while the output layer is zeroed. A new model therefore outputs exactly neutral value (`0`) for every position. It does not start with a conventional pawn/knight/bishop/rook/queen value table. The model can begin changing its output layer from experience; later updates also adapt the hidden layer.

This is intentionally a weak starting policy, not a claim that a new pet has a calibrated 100 Elo playing strength. Cosmetic generation follows completed training episodes, not measured chess strength. The displayed 100 is a local starting progression/rating marker. Only measured competition can establish actual playing strength.

## 3. Position representation

The shared encoder turns a legal board into 24 side-relative numeric features, each clipped to `[-1, +1]`:

1. Material-count differences for pawns, knights, bishops, rooks and queens.
2. Piece-square centrality differences for six piece types.
3. Pawn advancement.
4. Minor-piece development.
5. Occupation of the four central squares.
6. Attacks on central squares.
7. Bishop-pair difference.
8. Doubled-pawn structure.
9. Isolated-pawn structure.
10. Passed-pawn count.
11. Rook activity on files without friendly pawns.
12. King pawn shelter.
13. Remaining castling rights.
14. King-neighbour danger.
15. Space in the opponent's half.

These features describe a board. They do not assign conventional chess scores to the features. The pet's neural weights learn how useful each pattern is from outcomes. The feature encoder is a deliberate V1/V4 engineering compromise: a fully learned board representation would need far more data and compute than this small offline-first browser product can reliably provide.

## 4. How a move becomes a lesson

Chessling does not label a move good or bad the instant it is made.

1. Immediately before the pet chooses a move, the brain stores the compact feature vector for that position, the move, side to move, and a link to the position/action memory.
2. The chess engine applies the move. The decision remains pending.
3. After the opponent replies, `resolveLastPetMove()` evaluates the resulting position from the same side's perspective. In a normal turn-based game, two plies have elapsed and it is that side's turn again.
4. The neural model receives a temporal-difference target: approximately `0.94 × value(next position)`. If the game ended, it uses the terminal outcome instead (`+0.95`, `-0.95`, or `0`).
5. The stored move/position memory also receives a small update based on the observed prediction error.

This is an online temporal-difference update. It lets feedback arrive during a match instead of waiting for the final result.

## 5. What happens when a game ends

The game result supplies a delayed outcome label for every position the pet recorded during that game:

- Winning side: positive target.
- Losing side: negative target.
- Draw: neutral target.

The recorded feature vectors are consolidated into a compact replay set. Identical vectors are merged and their targets/visit counts are averaged. Higher prediction-error examples receive higher replay priority. The current implementation keeps at most 128 replay entries, trains up to 48 of the highest-priority entries for three passes, and increments the training-episode counter.

Human games and completed self-play sessions both train the value model. In self-play, each side's position is labelled from that side's own perspective. A self-play result never changes Growth Elo, Arena Elo, wins, losses or draws.

## 6. Search and the learned model

The shared search code uses iterative-deepening negamax with alpha-beta pruning, a transposition table, move ordering and quiescence search. It asks the pet's neural model to evaluate non-terminal leaf positions.

All pets receive the same configured search ceiling and time/node budget. Displayed Growth Elo never unlocks deeper search. A better model can choose different moves with the same search budget.

The V4 move-ordering step prioritises transposition-table moves, captures, promotions and remembered moves. It does not use conventional material values to rank captures. This avoids quietly reintroducing the old fixed piece-value table into the main evaluator.

Search is not training. `chooseMove()` performs inference only. Learning happens in the game loop after a response or completed game, and the updated pet brain is passed to the next search request.

## 7. The original Pawnling ideas remain

The original Gemini blueprint is preserved in `reference/Gemini-Pawnling-Original.zip` and `reference/PAWNLING_MASTER_BLUEPRINT.md`.

- **Habit mirroring:** still records the trainer's first six full moves and can mirror a familiar opening when the mirrored move is legal.
- **Position/trap memory:** still records FEN-keyed moves, visits, outcomes and feedback, and can influence future move selection.
- **Evolving material values:** no longer uses the old hand-authored `100/110/110/120/130` starting table or a mutation toward conventional values. The new network learns the contribution of the material-count inputs as part of its complete value function. The old `weights` field is retained only for importing older Souls.
- **Individuality:** each pet has its own neural weights, replay experiences, position memory, opening habits and personality traits.

## 8. Brain size and portability

The complete compact V4 brain payload is measured as UTF-8 JSON and must not exceed 51,200 bytes (50 KiB). When space is needed, low-priority replay examples and low-value/old episodic memories are pruned before the neural parameters. It includes:

- model parameters and training counters;
- up to 128 replay examples;
- pending in-game training positions;
- opening records and position/action memories;
- pet identity, progression, statistics and traits.

The brain is pruned by measured byte size. Optional old episodic memories and replay entries are removed before identity or current model parameters. The old 1,000-position ceiling also remains. Game count is not capped at 1,000.

New Soul exports use compact V4 encoding. V3 compact Souls and older expanded Souls are accepted by the migration path. JSON abbreviation/compaction reduces storage; it is not encryption or security obfuscation.

## 9. What V4 is not

V4 is a genuine small neural network with online learning, TD feedback and experience replay. It is not AlphaZero, Maia, Stockfish NNUE or a large self-play reinforcement-learning system. It does not currently have:

- a learned policy network that directly predicts moves;
- Monte Carlo tree search;
- a large-scale self-play training farm;
- distributed training or shared population learning;
- opening books or pretrained tactical knowledge;
- statistically demonstrated improvement in playing strength.

A small MLP can learn patterns from game outcomes, but sparse results, limited experience and the quality of the handcrafted feature encoder may limit how much strength it acquires. Stronger chess may require improved feature learning, better temporal credit assignment, more varied opponents, carefully controlled self-play, or a different model. These should be researched and benchmarked, not claimed in advance.

## 10. Developer contract

Any future model change must preserve:

- actual legal chess rules in `chess.js`;
- the neutral start and per-pet model identity;
- visible optional self-play, not hidden background games;
- no Elo or W/L/D rewards from self-play;
- same search budget regardless of Growth Elo;
- the 51,200-byte measured brain cap;
- Soul portability and migration;
- the original blueprint ideas and product decisions;
- honest, reproducible validation before making claims that pets become stronger.
