# CHESSLING — Master Product & Engineering Specification

**Working project owner:** Prasanna  
**Product name:** Chessling (evolved from Gemini's Pawnling starter)  
**Product promise:** Raise a chess creature from a 100-Elo hatchling into a formidable chess monster.

This document consolidates the ideas in the original Gemini `PAWNLING` blueprint and the product decisions made after it. The complete original ZIP is preserved in `reference/Gemini-Pawnling-Original.zip`; its blueprint is separately readable in `reference/PAWNLING_MASTER_BLUEPRINT.md`. The reference archive is historical source material, not the deployable application.

---

## 1. Product identity and core loop

Chessling is an offline-first, Tamagotchi-style chess pet. It is **not primarily a conventional chess site where people compete against other people**. Players raise individual chess creatures; those creatures can then compete against other players' creatures in the global arena.

Every new Chessling begins at **100 growth Elo** (this supersedes the 200-Elo value in the original Pawnling blueprint). It begins with deliberately weak, near-equal piece valuations and gradually adapts through play. Its identity persists through its name, memories, record, traits, learned tendencies, material genes and generation.

The intended loop is:

1. Hatch a Chessling.
2. Play chess with it and let it observe the board and decisions continuously.
3. Optionally start visible self-play Practice Mode, where the pet plays both colours and the player watches every move on the live board.
4. Let move-by-move feedback and eventual game results reinforce or weaken its memories.
5. Watch its style, material preferences, rating and generation develop.
6. Export its Soul, continue raising it, or eventually challenge other players' pets in the arena.

Practice is deliberately on-screen, never a hidden background match. It pauses while the page is hidden. Practice can create useful move-response experience, including feedback from a completed self-play result, but it never awards Growth Elo, Arena Elo, wins, losses or draws. Fast-forward/skip is planned as a Pro convenience; watching remains free.

The experience should be approachable to casual players, beginners, children and chess enthusiasts. A user need not be a strong chess player to enjoy raising a pet.

## 2. The three learning layers from Gemini's blueprint

These three layers are core product ideas and must not be silently removed or replaced with a generic static bot.

### Layer 1 — Habit Mirroring

- Primarily records the trainer's opening repertoire during the first six full moves.
- Stores simplified FEN positions and the trainer's chosen moves.
- Vertically mirrors the trainer's opening move where legal, so a Chessling can learn to play similar opening patterns from the opposite colour.
- Uses frequency of repeated patterns to make familiar replies more likely.
- Also remembers Chessling's own successful opening replies for later games.
- The original design described an adaptive probability rather than a guaranteed copy of every move.

### Layer 2 — FEN Trap Memory

- Stores board positions (simplified FEN) and the Chessling move selected in each position.
- A move is observed as soon as it is played; its consequences are examined after the opponent's reply.
- Match-result reinforcement preserves the original starting signals: **win +15, loss -20, draw +2**.
- Move-level feedback should also identify immediate refutations or favourable replies, rather than treating every move as equally responsible for the final result.
- The system must avoid repeatedly rewarding or punishing the same position without meaningful new evidence.

### Layer 3 — Genetic Piece Values

- Initial values from the original blueprint: Pawn 1.0, Knight 1.1, Bishop 1.1, Rook 1.2, Queen 1.3 (represented internally as 100, 110, 110, 120, 130).
- The intended material-value prior is Pawn 1.0, Knight 3.2, Bishop 3.3, Rook 5.0, Queen 9.0 (100, 320, 330, 500, 900).
- Values evolve through small mutations and experience-based updates, with the intention that the pet's material understanding matures over time.
- In the original blueprint these were compact heuristic genes, not a neural network and not proof of human-level learning. V4 replaces their evaluator role with a trainable neural material-feature response, while retaining the idea that material preferences should be learned. The influence on move quality still must be measured in repeatable tests.
- V3 adds four neutral positional preference weights (centre, pawn advance, development and king shelter). They start at zero and are adjusted from the pet's own move-response evidence. The shared chess engine provides legal rules and search; it no longer gives a pet deeper search simply because its displayed Growth Elo is higher.
- The UI can visualise the evolving piece-value bars and describe the pet's current learning style.

## 3. Learning behaviour and honesty requirements

- Learning is continuous: record the board context, move, and immediate consequences as a game progresses.
- The result of a completed game supplies delayed reinforcement. Do not wait until the match ends to record all experience.
- Chessling must learn from human games and, once available, pet-versus-pet games and approved self-sparring games.
- Imported Souls preserve the learning state; the system must not reset a pet's brain when it is moved to another device.
- Learning claims must be backed by controlled tests. A higher displayed number, more games played, or an evolved sprite alone does not prove stronger chess.
- Keep a distinction between the early local **Growth Elo** and a properly calculated, server-verified **Arena Elo**. The first playable uses a provisional local progression estimate; it is not a calibrated public rating.
- No fabricated match outcomes, invented wins, random ranked results or artificial rating inflation.

## 4. Memory and storage budget

**Hard limit: 50 KiB (51,200 bytes) per pet brain.** This is a byte limit on the complete serialised brain, not a limit on the number of games played.

- Keep the original maximum of 1,000 remembered FEN positions.
- Enforce both the position-count limit and the actual UTF-8 serialised byte count.
- Use least-recently-used pruning when space is needed.
- Preserve identity, current learned genes and core statistics before optional old memories.
- The local save, cloud brain record and brain portion of a Soul must obey the same byte budget.
- Store the brain as compact JSON with abbreviated field names and array-packed entries. Local saves and Soul exports use the compact representation; V2 Souls remain importable. This is data compaction, not encryption or security obfuscation.
- Measure the exact UTF-8 bytes of the compact representation. That measured brain payload, not a rough estimate, must stay at or below 51,200 bytes in local storage and any future cloud sync.
- Keep the brain compact for fast loading, low-cost D1 storage and small synchronisation payloads.
- A pet can play tens of thousands of games; old memories are pruned as needed. The 50 KiB limit must never be misrepresented as a games-played cap.

## 5. Soul export and import

A Chessling Soul is a portable JSON representation of the pet.

Import/export must preserve, where present:
- Pet identity, display name and trainer identity.
- Growth rating, generation, wins, losses, draws and game count.
- Personality traits and material genes.
- FEN trap memories, opening habits and learned replies.
- Pending move observations and genetic trace needed to finish learning from an in-progress game.
- An optional active game's move history, so a user can continue an unfinished match.

Import must validate the format and enforce the 50 KiB brain limit. A failed import must not destroy the existing pet. The Soul is a backup/portability feature, not a way to inject arbitrary public Arena ratings.

## 6. Pet identity and trainer identity

Both the **trainer** and each **pet** must have globally unique usernames/handles.

- Pet handles are used in share links and public pet profiles.
- A trainer may eventually own multiple pet identities (five slots are proposed for Pro).
- Each pet has a separate brain, record, match history, progression and public profile.
- Display names may be editable, while permanent IDs/handles provide stable identity.
- The original starter's optional eight-digit PIN idea is retained as a recovery/ownership-protection concept, but the final authentication and recovery design must be reviewed for security before arena launch.
- A public share link must expose only a read-only challenge copy of a pet's brain. A visitor must never be able to overwrite the owner's saved brain.

## 7. Global Monster Arena — pet versus pet

The arena is a defining feature: players raise creatures; creatures fight other creatures. It is not intended to turn the product into ordinary human-versus-human chess matchmaking.

- Users can view public pet profiles and share challenge links.
- A challenger plays against a read-only copy of the selected pet's brain.
- Finished challenges should submit the actual game record (for example, PGN or a verified move sequence).
- The server must replay and validate the game before applying a ranked result.
- Public pet records include Arena Elo, wins, losses, generation and Pro badge where appropriate.
- The global leaderboard can show the leading monsters.

### Anti-farming rule (confirmed product requirement)

**The same challenger trainer can affect a target pet's Arena Elo in at most three matches per UTC day.** Further matches that day remain playable but award no additional Elo; the allowance resets on the next UTC day. This is a rating-integrity rule, not a ban on playing again.

- Count matches by stable challenger trainer identity, not just a spoofable display name, pet handle or IP address.
- The daily pairing key is target pet + challenger trainer + UTC date, so changing pets or display names does not reset the allowance.
- The Worker must enforce this rule server-side, atomically, before changing any rating. The V3 D1 schema reserves the daily counter, but it remains inactive until rated match verification is safe.
- V3's Arena API intentionally stores submitted games as unranked for now: legal move replay proves the game is legal, but does not prove that the target pet AI generated its own moves. Ranked Elo and the three-match counter must remain disabled until target-side move attestation is independently verified.
- Rate limits and abuse controls remain useful additional layers, but IP alone is not the definition of a player.
- Arena Elo must be calculated from verified opponent ratings and actual outcomes, not fixed increments supplied by the browser.

## 8. Visual and interaction direction

The product should feel like a friendly retro handheld pet game, but the chessboard and pieces must remain clear and professional.

Original theme ideas retained:
- Classic Handheld.
- Game Boy DMG Green.
- Amber CRT.
- Midnight OLED.

Original art directions retained:
- Lightweight chess symbols for early prototypes.
- A consistent open-source SVG chess-piece set, with its licence preserved, as an interim visual option.
- Original 16×16 or 32×32 pixel-art chess creatures/pieces as a distinctive signature style (tiny eyes on pawns were suggested).

Visual quality must not compromise gameplay. The board must always be a true square with 8 equal square cells, responsive on phones and desktops, with clear coordinates, touch targets and promotion handling.

## 9. Product and monetisation model

- **Ad-free.** No advertising in the product.
- The core Chessling experience remains free: offline play, learning, pet progression, Soul export/import and access to the public Arena are intended to be available without a subscription.
- Paid features should add convenience, collection capacity and personalisation, not fake intelligence or deliberately weaken the free pet.

### Global pricing (confirmed)
- **$4 per month.**
- **$25 per year.**
- **$49.99 one-time purchase**, guaranteeing five years of Pro access. This is not perpetual/lifetime access.

### India pricing

India will have separate regional pricing. Exact launch prices are still to be finalised; the initial Gemini proposal mentioned ₹149/month and ₹1,499 one-time, but these are reference suggestions rather than a newly confirmed final price. Payment should support suitable Indian payment methods, including UPI where the chosen provider permits it.

### Pro feature ideas retained from Gemini
- Five pet slots instead of one.
- Accelerated bot-versus-bot sparring between a player's own pets (the original blueprint suggested 10× speed).
- Skip/fast-forward visible self-play practice for players who do not want to watch the full match. Watching remains free.
- Custom handheld shells and board palettes/themes.
- Golden Crown badge on the Arena leaderboard.

The original blueprint mentioned Dodo Payments, Polar and Paddle as possible payment providers. Provider availability, fees, licensing, regional payment support and five-year licence handling must be rechecked before choosing one.

## 10. Zero-cost-first architecture

The target is to launch and validate the product without paid infrastructure or paid AI APIs.

| Layer | Planned technology | Responsibility |
|---|---|---|
| Source/version control | GitHub | Source code, issues, version history and deployment source |
| Static hosting | Cloudflare Pages | Public web app and PWA files |
| Arena API | Cloudflare Workers | Pet registration, secure sync, challenge validation, ranking and Pro entitlement checks |
| Structured cloud data | Cloudflare D1 | Pet metadata, compact brains, match limits, match records and leaderboard indexes |
| Local pet | Browser storage (localStorage/IndexedDB as appropriate) | Offline brain, current game, settings and Soul portability |
| Chess AI | Local JavaScript + Web Worker | Search and learning without a paid external AI API |

Free-tier usage is a launch target, not a promise of unlimited service. Cloudflare quotas, platform terms, pricing and limits can change. The app should remain playable offline if the arena is unavailable, and backend usage must be monitored before scaling.

**Commercial hosting decision:** GitHub remains the source repository. Cloudflare Pages is the intended static host for the commercial product; GitHub Pages should not be treated as the permanent commercial SaaS host.

## 11. Development sequence

1. **Local foundation:** accurate chess rules, square responsive board, legal AI opponent, move history, undo/new game, local persistence and 50 KiB brain cap.
2. **Learning validation:** controlled opening, trap-memory and material-gene experiments; compare the same pet before/after learning against repeatable positions and opponents.
3. **Pet experience:** personality, evolution, visual creature identity, theme system and polished Soul management.
4. **Pet-versus-pet arena:** unique trainer/pet handles, read-only challenge copies, verified match replay, three-match anti-farming rule, Arena Elo and leaderboard.
5. **Commercial layer:** multi-pet Pro, cosmetics, subscription/5-year access, regional pricing and secure entitlement checks.

Do not start a later phase by weakening or bypassing a prior phase's tests.

## 12. Current first-playable scope and limitations

Included now:
- Legal 8×8 chessboard and move rules.
- Optional on-screen self-play Practice Mode with visible move-by-move playback, pause/resume, stop, and automatic pause when the page is hidden.
- Practice sessions are counted separately and never alter Growth Elo or the W/L/D match record.
- Compact JSON brain saves and Soul export, with the exact 50 KiB byte cap and V2 Soul import compatibility.
- Elo-independent fixed search ceiling; new positional preference weights start neutral.
- Local Chessling opponent running in a Web Worker where supported.
- Three-layer compact learning prototype.
- Move-by-move observations and end-of-game reinforcement.
- Local save/resume, undo-turn and Soul export/import.
- 50 KiB actual serialized-brain cap and 1,000-position cap.
- PWA shell and offline cache.

Not included yet:
- Global trainer/pet handle registry and authentication.
- Cloud sync, Cloudflare Worker/D1 Arena and verified challenge replay.
- Three-ranked-matches-per-challenger-per-day server enforcement.
- Pet-versus-pet matchmaking and public leaderboard.
- Payments, Pro entitlements or subscriptions.

At the V3 milestone, the AI was a compact adaptive heuristic/search prototype rather than a neural network. That statement is retained as project history and is superseded by Section 11: V4 now uses a per-pet trainable neural value model in the actual search path. Its displayed Growth Rating remains provisional, and the V4 model has not yet demonstrated measured chess-strength improvement. Controlled, held-out benchmarks remain the next critical milestone before describing Chessling as a stronger or competitive chess AI.

---

## 11. V4 AI learning model — current implementation supersedes earlier prototype notes

The earlier sections describe V3's adaptive heuristic prototype and the original Gemini blueprint. They remain part of the project's design history. **The current V4 source uses the following learning architecture instead.**

### 11.1 Per-pet neural value model

Each pet owns a small feed-forward neural network with 24 inputs, 12 hidden tanh units and one tanh value output. It has 313 trainable parameters. The model evaluates positions inside the real chess search. The new model's output layer starts at zero, so a fresh pet begins with a neutral value estimate rather than a table of conventional piece values.

The shared feature encoder represents material counts, piece-square centrality, pawn advancement/structure, development, centre occupancy/control, bishop pair, rook-file activity, king shelter, castling rights, check status and space. The encoder is shared code; the weights are individual to each pet. The pet learns the importance of the features from experience.

### 11.2 Continuous feedback and replay

Before each pet move, the brain stores a compact position vector and the move selected. It does not immediately classify the move as good or bad. After the opponent replies, it applies a temporal-difference update against the next position from the same side's perspective. Terminal positions use the game result. Completed games then supply outcome targets for the recorded positions, which are consolidated into a bounded replay set and trained again.

Human games and completed visible self-play sessions can both update the neural model. Self-play never changes Growth Elo, Arena Elo, wins, losses or draws.

### 11.3 Preserved original ideas

- Habit mirroring continues to learn the trainer's opening habits.
- FEN/action memory continues to remember positions, selected moves and observed consequences.
- The original evolving-piece-value idea now lives inside the neural model's learned material-feature response. The former fixed 100/110/110/120/130 table and artificial drift toward 100/320/330/500/900 are not used by the V4 evaluator. Old values remain only to migrate older Souls.

### 11.4 Honest limitation

V4 is a small on-device neural value learner with back-propagation, online TD updates and experience replay. It is not AlphaZero, Stockfish NNUE, a large pretrained model or a modern grandmaster-level neural chess engine. It has no separate policy network, MCTS, distributed self-play or large training corpus. The feature encoder is handcrafted, and stronger chess playing strength has **not yet been demonstrated**. See `AI_MODEL_ARCHITECTURE.md` and `AI_MODEL_VALIDATION.md`.

### 11.5 Storage format

V4 Souls use compact `compact-neural-json-v4` encoding. The same 51,200-byte measured UTF-8 hard limit applies to the complete model and all per-pet experience/memory data. V3 compact Souls and older expanded brain objects are accepted by the migration path. This is compaction, not encryption.

### 11.6 Claude review handoff

`CLAUDE_HANDOFF.md` gives the next model-review assistant the product requirements, current model design, highest-priority learning audits, test expectations and complete ZIP deliverables. It explicitly requires independent verification and prohibits unsupported strength claims.
