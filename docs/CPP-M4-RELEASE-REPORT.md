# Chelo V15-CPP M4 release report

## Scope

M4 changes the player-save and pet-learning contract. The C++ chess engine and V37 model are frozen and unchanged.

## Implemented

- Single `.chelo` container for shared player metadata, active-match state and the full pet roster.
- Free whole-file cap of 50 KiB; one Free pet with a 47 KiB data budget.
- Pro container with five pet records, each capped at 500 KiB, plus shared header allowance.
- Pet record v16 with compact identity/progression, traits, Bond/Arena adapters, position memories, pending outcome records and mastery data. The old self-play/Practice Mode UI and session code are removed.
- Signed Int8 adapter serialization and training updates to the same Bond/Arena tensors consumed by the C++ V37 evaluator.
- 64-bit position fingerprints, compact pending positions and 16-bit packed UCI history.
- IndexedDB local player/pet storage and atomic whole-collection import.
- Player active-pet ID restoration.
- Authenticated Cloudflare save endpoint backed by one SQLite Durable Object per trainer. It stores player metadata and each pet separately, assembles the single `.chelo` at the API boundary, validates owner/plan, and uses ETags to prevent stale writes.
- Legacy `.soul` support is migration-only; there is no `.soul` exporter.

## Measured synthetic stress fixtures

| Fixture | Bytes | Limit | Retained positions |
|---|---:|---:|---:|
| Fresh Free `.chelo` | 708 | 51,200 | 0 |
| Saturated Free `.chelo` | 47,622 | 51,200 | 1,045 |
| Pro five-pet `.chelo` | 2,556,399 | 2,568,192 | 11,398 per pet |
| Pro pet payload | 511,207 each | 512,000 each | 11,398 each |

These are deterministic synthetic storage fixtures, not universal memory/game counts. Long real histories and physical devices remain validation targets.

## Tests

- `run-tests.sh`
- `run-learning-tests.sh`
- `run-nnue-tests.sh`
- `run-search-tests.sh`
- `run-tactical-tests.sh`
- `run-worker-tests.sh`

The test reports validate the current synthetic byte fixtures, adapter mutation and round trips, legacy migration reader, V37 immutability, native/WASM parity, DO split storage, account identity checks, entitlement checks and optimistic concurrency.

## Known boundaries

- The app's user-facing account/login/cloud-sync UI is not integrated yet.
- Cloudflare D1/DO resources are placeholders and the Worker has not been deployed.
- Online Arena AI-side move attestation is not implemented; match submissions remain unranked exhibitions and are not automatically fed into Arena learning.
- App pet switching UI is not yet implemented; the `.chelo` roster stores up to five pets and the active-pet ID is preserved, but the current app starts with the stored active pet/first available pet.
- Real Android/Termux training and long-run memory-growth validation remain outstanding.
- The current online adapter update is an initial bounded learner, not a measured playing-strength gain. The optional C++ evaluator consumes Bond/Arena; the default/ranked JavaScript evaluator still uses the older V14 search model. The next engine milestone must make V37 + adapters the canonical move-selection path.

## Frozen model verification

`models/dual-nnue-v37.bin`: 49,368 bytes.
SHA-256: `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`.

No C++ engine source or V37 model weights were changed in this milestone.
