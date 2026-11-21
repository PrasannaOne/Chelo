# Chelo V6 — Neural Model Architecture (V13 research candidate)

**Soul schema:** 13  
**Active model width:** 48  
**Trainable parameters:** 47,694  
**Status:** implemented and structurally tested; chess-strength improvement is not established.

This is Chelo's own compact on-device model, not AlphaZero, Stockfish NNUE, a pretrained network, or a claim of grandmaster strength. Free and Pro use the same architecture, learning rules and search budget. Pro receives more storage for individual experience, not a stronger model.

## 1. Input representation

The compact position vector has 80 values:

- 64 square codes: empty, one of six own pieces, or one of six opponent pieces.
- 16 state flags: side-to-move relation, four castling rights, check state for both sides, en-passant availability and file.

The square codes expand into 64 × 12 side-relative piece-identity planes. The 16 state values remain global features. Total expanded input: **784 features**. Black's view is rotated into a consistent side-relative frame.

This is engineered board-state input, not an image encoder. The current vector does not yet include a full learned attack map or every positional concept.

## 2. Shared value trunk and residual refinement

The shared network is:

`784 sparse-expanded inputs → 48 tanh units → 48-unit residual refinement → WDL head`

The first 48-unit layer is sparse: only occupied piece-plane rows and active global flags are accumulated. The refinement block computes a learned 48-to-48 tanh transformation and adds it to the first hidden representation:

`h₂ = h₁ + tanh(W₂ h₁ + b₂)`

The residual weights and biases start at zero. This matters for migration: V11/V12 pets retain their earlier model predictions at the point of migration, then can train the additional refinement layer through backpropagation. It is not a guarantee that later updates cannot change behaviour.

## 3. Win/draw/loss value head

The value head produces three logits and softmax probabilities:

- `P(win)`
- `P(draw)`
- `P(loss)`

Search consumes the expected score `P(win) - P(loss)`. `predictWDL()` exposes all three probabilities for diagnostics. They are not yet externally calibrated win odds.

Training maps delayed TD feedback to soft win/draw/loss targets and applies cross-entropy with light label smoothing. The learner does not mark a move good or bad before it has observed the opponent's reply or final result. Terminal results provide stronger feedback than intermediate estimates.

## 4. Legal-move policy head

The policy head scores only legal candidate moves. It uses learned embeddings for:

- from-square: 64 categories;
- to-square: 64 categories;
- moving piece: 6 categories;
- promotion: 5 categories, including no promotion.

Each descriptor is conditioned on the shared 48-unit hidden representation. A rank-4 low-rank interaction adds an ordered from-square/to-square relationship conditioned on a projection of the current hidden state. The policy softmax is formed over the legal moves in the current position.

The policy is a move-prior and search-ordering aid. It cannot create illegal moves or overrule a completed alpha-beta search result. Policy learning uses the selected move's pre-update advantage, label smoothing and importance weighting. Replay recomputes current prediction error before refreshing priority so mastered entries can yield capacity to new experiences.

## 5. Parameter accounting

| Component | Parameters |
|---|---:|
| Sparse input trunk: 784 × 48 | 37,632 |
| First hidden bias | 48 |
| Residual block: 48 × 48 + 48 bias | 2,352 |
| WDL head: 48 × 3 + 3 bias | 147 |
| From/to embeddings: 2 × 64 × 48 | 6,144 |
| Piece/promotion embeddings: (6 + 5) × 48 | 528 |
| Descriptor biases: 64 + 64 + 6 + 5 | 139 |
| Rank-4 from/to interactions: 2 × 64 × 4 | 512 |
| Rank-4 hidden-state projection: 48 × 4 | 192 |
| **Total** | **47,694** |

Free and Pro both use all 47,694 parameters. No model-width or search-depth entitlement is attached to Pro.

## 6. Soul v13 storage encoding

Soul v13 stores the following arrays with per-channel signed Int4 quantisation:

- input trunk weights;
- residual-block weights;
- policy embeddings;
- low-rank policy interaction arrays.

The WDL output weights and biases use scaled Int8 encoding. Runtime arrays are restored to JavaScript numbers for learning and inference. Int4 is a storage representation, not a claim that the runtime arithmetic is 4-bit.

Canonical position keys are encoded as 34 bytes before base64 wrapping: 64 four-bit piece codes plus side/castling and en-passant metadata. Replay and pending experiences reference their position/move row where possible, rather than repeating a full FEN and UCI string. The decoder preserves en-passant squares; regression tests cover both legal target ranks.

Soul v13 migration supports V4/V5 and V6 research Soul versions through V12. V11/V12's 48-wide WDL model is warm-started into V13 with the residual block at zero. Older incompatible scalar/feature models receive a supported partial transfer where shapes match; they must not be labelled as having been trained under V13.

Quantisation is not encryption or tamper-proofing. Imported Souls need validation, and ranked results need server-side verification.

## 7. Learning and search loop

1. Extract side-relative position features.
2. Produce WDL value and legal-move policy scores.
3. Search legal moves using the shared chess rules/search implementation.
4. Record the pet's decision and pre-move prediction as pending experience.
5. Wait for the opponent's response or terminal outcome.
6. Apply delayed WDL/TD value feedback and a policy update based on the pre-value-update advantage.
7. Store compact position/action/outcome experience.
8. Replay a mixture of high-priority examples and a rotating coverage sample.
9. Refresh replay priority using current prediction error.

The owner’s moves are observations. Raw opening frequency does not force the pet to mirror the owner or create an unearned opening bonus.

## 8. Search

The shared engine uses legal move generation, iterative deepening, negamax/alpha-beta, transposition caching, quiescence and policy/tactical move ordering. Root principal-variation search tests later root moves with a null window and performs a full re-search only when the candidate beats the proven best. Incomplete/interrupted root iterations do not replace the last fully completed result.

Search correctness tests cover perft, castling, en passant, promotion, checkmate, repetition, draw handling, quiescence draw nodes, legal search and immutable root state. Root-PVS node reductions have been observed in small fixed-position pilots; they do not establish stronger chess play.

## 9. Storage budgets and parity

| | Free | Pro |
|---|---:|---:|
| Per-pet Soul hard limit | 51,200 bytes | 512,000 bytes |
| Model | Same V13 47,694 parameters | Same V13 47,694 parameters |
| Learning/search | Same | Same |
| Extra capacity | Base memories/replay | More room for memories/replay/personalisation |

The 10× Pro budget means more room for individual experience, not 10× intelligence. The limit is a hard byte ceiling, not a games-played cap.

A fresh V13 Soul is approximately 36.3 KB in the current test fixture. A 100-episode tactical-retention experiment ended at 50,297 / 51,200 bytes, leaving 903 bytes, with six retained position-memory entries and 160 replay entries. This demonstrates that compression alone has not solved Free long-term memory pressure.

## 10. Explicit limits

- No multi-seed completed-game comparison proves V13 stronger than fresh V13 or frozen V5.
- The WDL head is not calibrated against a large independent game set.
- The policy is a compact legal-move factorisation, not a full move-space softmax or transformer.
- The 50-puzzle retention set contains verified mate-in-one positions; results do not establish multi-move tactical or general strategic ability.
- The 100 interference episodes in the recorded run were all truncated at 20 plies; zero terminal games completed. They are episodes, not 100 finished chess games.
- Local Node timing is not Android timing. Device thermals, browser overhead and background throttling remain to be measured.
- Personality values currently need a separate evidence-based redesign; the current simple trait counters must not be presented as a sophisticated psychological model.

The current architecture is a stronger research candidate, not a selected production engine. Keep testing and keep the frozen V5 baseline available until controlled chess results justify a decision.
