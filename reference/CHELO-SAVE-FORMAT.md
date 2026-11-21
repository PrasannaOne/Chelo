# Chelo unified player-save format

Status: M5 implementation contract, container version 1 / pet record v16.

## Product rule

There is exactly one portable save per player: `player.chelo`. Individual `.soul` files are retired. The file contains the shared player record, active-match recovery state, roster metadata and all owned pet records. It does not contain the app, chess rules, C++ engine, WASM, V37 model weights, opening book, KPK data or other shared static assets.

## Budgets

| Component | Free | Pro |
|---|---:|---:|
| Full `.chelo` file | 102,400 bytes | 2,568,192 bytes |
| Pet records | 1 | 5 |
| One pet record | 99,328 bytes (97 KiB) | 512,000 bytes (500 KiB) |
| Shared player JSON | 2,048 bytes maximum | 2,048 bytes maximum |

The Free allocation leaves 2 KiB for shared player data and compact container overhead; the complete file is still hard-limited to 100 KiB. The Pro ceiling is five 500 KiB pet records plus 8 KiB container allowance. It is about 2.45 MiB / 2.57 MB decimal. The allowance is inside one `.chelo` file; it does not create five pet files. Free's 100 KiB limit applies to the entire file, not just the pet object.

## Container shape

The container is minified UTF-8 JSON with:

- `format`: `CHELO`
- `version`: container version `1`
- `plan`: `free` or `pro`, used for local validation but never trusted for server entitlement
- `player`: one shared player record (account/local ID, trainer handle, display name, settings, active pet ID, active-match recovery)
- `pets`: one Free or up to five Pro pet records, each with a stable ID and compact pet data
- `crc32`: corruption-detection checksum over the preceding payload

`CRC32` detects accidental corruption; it is not a cryptographic signature and does not authenticate the owner. Online sync derives the owner and plan from the authenticated account in the Worker.

## Pet record v16

A v16 pet record contains compact identity/progression, three personality trait values, two packed adapters, memories, unresolved outcome-learning items and mastery metadata. The principal fields are:

- `i`: compact identity/progression tuple (pet name, unique handle, generation, wins/losses/draws, completed trainer games and experience; no retired practice counter)
- `t`: compact personality traits
- `dl.bond`: rank-1 Int8 adapter
- `dl.arena`: rank-2 Int8 adapter
- `m`: compact episodic memory rows
- `u`: pending position/move observations that still require a game outcome
- `y`: mastery information plus the internal adaptive challenge estimate, trainer-win streak and completed adaptive-game count
- `c` / `vv`: creation/update timestamps

Memory positions are represented by 64-bit fingerprints instead of repeated FEN strings. The fingerprint is a compact lookup key, not a proof that a position can be reconstructed; pending items retain the packed position information they need for consequence-aware outcome updates. Moves are encoded as 16-bit from/to/promotion values and Base64-packed in the shared active-match record.

## Quantisation and learning

The Bond and Arena adapters use signed Int8 values. The C++ evaluator consumes these same two adapter tensors. Trainer-match feedback updates Bond; a battle-origin caller must explicitly select Arena to update the Arena layer. Practice-only games do not train the adapters. The shared V37 model is immutable during pet learning.

The current learning update is a bounded online adapter update, not a trained Elo claim. The exact byte cap is enforced by measuring the actual encoded UTF-8 output and the individual pet payload. The optional C++ V37 evaluator consumes Bond/Arena; the default/ranked JavaScript evaluator has not yet been migrated to these adapters. That is a separate engine milestone. Real game-strength and long-run retention require separate controlled validation.

## Local storage

The browser keeps one player record and separate pet records in IndexedDB so individual updates do not rewrite the whole collection on every move. Export assembles them into one `player.chelo`; import validates the entire file before atomically replacing the local player/pet records. The active pet ID is stored once in `player` and restored on import.

## Cloudflare storage

The account-save route is authenticated through the Arena Worker. The Worker obtains `trainer.id`, `trainer.handle` and the Pro flag from D1. It then routes to one SQLite-backed Durable Object per trainer. The DO stores:

- one `manifest` (plan, owner identity, pet count, version, revision, checksum, ETag)
- one `player` value
- one value per pet (`pet:0` through `pet:4`)

Each pet is stored separately, so a 500 KiB value is comfortably below Cloudflare's 2 MB combined key/value or SQL-row limit. The whole `.chelo` is assembled only for the GET response. Conditional writes use `If-Match` and ETags; a stale client receives HTTP 409 rather than silently overwriting another device's save. Missing preconditions for an existing save receive HTTP 428.

Cloudflare account-plan limits and DO quotas still apply. Free plan SQLite-backed DOs have 5 GB account storage and daily request/compute allocations. Keep the save path low-frequency (sync on explicit action or controlled checkpoints, not every chess move). Current official platform references: [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Import and trust rules

- A local `.chelo` may be edited by its owner; offline play remains available.
- The local plan field never grants Pro capacity or cloud entitlement.
- Cloudflare validates the plan using the authenticated D1 account.
- Cloud sync requires the player ID and trainer handle in the file to match the authenticated owner.
- CRC protects against accidental corruption, not malicious modification.
- Online ranked matches need independent engine/version and move-sequence verification. A valid `.chelo` is not proof that a pet played a fair ranked match.

## Migration

Legacy V15 `.soul` and prior local browser data are migration inputs only. They are expanded into the current runtime, stripped of legacy learner/replay payloads, and saved as the new v16 pet record inside a `.chelo` v1 container. No `.soul` export path remains. Historical release documents can retain `.soul` wording because they describe older releases.
