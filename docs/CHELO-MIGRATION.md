# Legacy save migration into `.chelo`

The current product has one portable save format: a single `player.chelo` file containing the shared player record and all owned pets. Individual `.soul` export/import is retired as a user-facing workflow.

## Accepted migration inputs

- Older V15 `.soul` files that the migration reader recognises.
- Existing V15 localStorage pet records.
- Existing separate active-match records using UCI move strings.

## Migration behaviour

1. Read the old record without mutating its source during parsing.
2. Preserve pet name, handle, generation, wins/losses/draws, experience, personality traits, memories, mastery state and supported Bond/Arena adapter state. The retired self-play/Practice Mode counter is not carried into the new format.
3. Convert position keys into compact 64-bit fingerprints.
4. Pack unresolved position state and saved match moves into compact encodings.
5. Drop old V14 learner tensors, retired personal adapters, replay/opening compatibility tables and embedded/shared model data from the new portable pet record.
6. Store the migrated player and pet records in IndexedDB.
7. Remove obsolete localStorage copies only after the IndexedDB replacement succeeds.
8. Export only a unified `.chelo` container.

## Safety and versioning

- The legacy reader is migration-only; there is no `.soul` exporter.
- New `.chelo` files are `CHELO` container version 1 with pet record version 16.
- Unsupported or corrupt imports are rejected before local player/pet records are replaced.
- The plan marker in a file never grants Pro capacity. The app uses its verified entitlement and the Cloudflare Worker rechecks the account plan using D1.
- CRC32 detects accidental corruption; it is not a signature or anti-cheat mechanism.

## Validation still required

Run `bash run-learning-tests.sh`, `bash run-tests.sh` and the device-level validation plan. Real histories must confirm adapter behaviour, memory retention, exact cap enforcement and round-trip parity before any product capacity is described as guaranteed.
