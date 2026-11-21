# Chelo Game Plan

This is the canonical product and architecture plan. It supersedes historical Chessling/Pawnling assumptions where they conflict with the current Chelo direction.

## 1. Product identity

Chelo is an offline-first collectible chess-pet game. Players raise individual chess pets; the pets learn and compete. It is not merely a chess engine with a mascot. Each pet has a distinct identity, personality, memories and player relationship.

## 2. Shared engine and pet-specific layers

The chess engine supplies legal chess, evaluation, search and move selection. The shared C++ engine, WASM, base V37 model and static resources are hosted once and are not copied into player saves.

### Bond: trainer-specific foundation

Bond belongs to one pet's relationship with its trainer. Trainer-game outcome feedback updates this layer. Bond forms the base of the pet's personal chess adaptation.

### Arena: battle-derived experience

Arena sits on top of Bond and captures experience from battles outside the direct trainer relationship, including friend challenges and random online Arena matches. Battles between the same trainer's pets may contribute only when the product explicitly defines them as battle-origin matches; they must not be misclassified as trainer Bond games. Arena updates must not overwrite the Bond foundation.

### Personality and memories

Personality emerges through actual playing behaviour, not a decorative label alone. Compact traits can bias the pet's preferences within legal-move and strength safeguards. Memories retain meaningful position/outcome associations. Growth, Mastery and Arena Rank remain separate: Growth is accumulated experience, Mastery is earned through controlled benchmark tests, and Arena Rank is competitive standing from independently verified matches.

## 3. One portable player file: `.chelo`

The sole portable save format is one `.chelo` file per player. Individual `.soul` files are retired.

- Free: the complete `.chelo` file is capped at 100 KiB, including player identity, settings, active-match state, the one pet, container and checksum.
- Pro: the same single file contains five pets, each with up to 500 KiB of personal data. The total planned maximum is 2,500 KiB for five pet records plus shared metadata/container overhead (approximately 2.5 MB decimal / 2.44 MiB).
- Shared player identity and settings are stored once, never repeated inside every pet.
- Each pet stores compact identity/progression, personality traits, quantised Bond/Arena adapters and compressed/compact memories.
- The C++ engine, WASM, base V37 weights, shared policy/model data, app code and static assets remain hosted once.

The current `CHELO` v1 container uses minified UTF-8 JSON, compact arrays, 64-bit position fingerprints, packed 16-bit move codes and signed Int8 adapter values. Exact byte limits are validated after full encoding. CRC32 detects accidental corruption; it is not authentication.

The current design budgets 97 KiB for the Free pet and 2 KiB for shared Free player metadata inside the 100 KiB whole-file cap. Pro budgets 500 KiB per pet and 2 KiB shared player metadata, with 8 KiB of container allowance. See `CHELO-SAVE-FORMAT.md` for the exact contract.

Old V15 `.soul` files can be accepted by a migration-only importer, but no new `.soul` is exported. The current portable format must not carry the old V14 learner tensors, old personal adapter, replay logs, shared engine/model weights or static resources.

## 4. Offline play, accounts and cloud sync

Offline game and personal pet raising must work without an account. The local browser store keeps player metadata and individual pet records in IndexedDB. Export/import always produces/restores one complete `.chelo` file.

Account-based features (Arena, leaderboards, challenges and cross-device sync) require authentication. The Worker derives the account ID, handle and Pro entitlement from D1; file fields are never trusted to grant account identity or plan limits. One SQLite-backed Durable Object is assigned per trainer and stores the header and each pet separately. A single `.chelo` is assembled at the API boundary. ETags and conditional writes prevent one device from silently overwriting newer data.

The API backend is implemented in M4 and has local tests, but the Worker must still be deployed and the frontend account/login/cloud-sync interface integrated before real account sync is live.

## 5. Fair online competition

Ranked play must pin the approved engine version, model SHA-256, search configuration and rules version. Native ARM64 and WASM integer evaluation must remain bit-identical. Deterministic fixed-node search is preferred for equal search effort across device classes. Slower devices may take longer; they should not receive weaker search because their CPU is slower.

Client-submitted moves alone are not proof of a fair result. The server must independently replay legal moves and eventually attest that the pet-side moves were produced by an approved engine/model/configuration. Until that exists, exhibitions remain unranked. A local player may modify their offline `.chelo`; online account ownership and ranked results are verified separately.

## 6. UI direction

- Board-first gameplay, minimal controls, no dashboard-card main screen.
- Dark retro handheld feel with restrained warm-lime accents.
- Hamburger drawer enters from the left; pet personality is shown first.
- Header: hamburger + Chelo on the left; heart link, share and overflow on the right.
- The main screen should avoid page scrolling on supported devices; only contained panels/dialogs may scroll.
- No oversized buttons, loud gradients or clutter.
- Self-play/Practice Mode is not part of the current product plan unless explicitly reintroduced.

See `UI-REFERENCE-CHECKLIST.md` for historical design inspiration, not an instruction to recreate the older interface.

## 7. Backend-first order

1. Preserve chess-engine correctness and the frozen V37 model baseline.
2. Make personal Bond/Arena training connect to the adapters actually consumed by the engine.
3. Stabilise the single `.chelo` file contract, compact memory/adapter encoding and legacy import migration.
4. Validate actual training, byte budgets, export/import and offline persistence.
5. Deploy authenticated Cloudflare save sync and integrate the account UI.
6. Implement independently verified Arena results and engine/version pinning.
7. Then upgrade search strength/performance and later polish the pet UI.

## 8. Frozen V37 baseline

- File: `models/dual-nnue-v37.bin`
- Size: 49,368 bytes
- SHA-256: `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`

M4 does not change the C++ engine or V37 model. Engine upgrades are a separate next milestone.


## 9. Developmental learning and match guardrails

A newly created pet begins as a legal-move learner, not a reduced-budget copy of the mature engine. With zero completed trainer games, its move selector samples uniformly from legal moves and bypasses V37 evaluation/search and the opening book. Across the first 11 games it gradually introduces simple capture/material awareness and position/move memories; V37 search starts blending into move selection at game 12 and reaches full selection only after sustained play. At four to five games the pet should be a noticeably improving beginner while remaining intentionally beatable.

Trainer outcomes update Bond when the pinned V37 residual supports learning. Immediate capture of a piece on the square Chelo just moved to gives that exact position/move an additional negative signal. These mechanisms must be validated as behavioural improvements, not presented as a certified Elo rating without paired match data.

In casual single-player play, Chelo auto-claims a draw when threefold repetition or the 50-move threshold becomes claimable, preventing endless shuffle games. The rules core retains FIDE's distinction between claimable threefold/50-move draws and automatic fivefold/75-move draws; checkmate takes precedence over the 75-move rule.
