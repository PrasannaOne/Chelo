# Chelo unified-save size audit

**Format:** `CHELO` v1 container, pet record v16.

M4 replaces the old `.soul` exporter with one complete player `.chelo` file. The audit creates deterministic synthetic pet memories, runs the actual v16 brain compactor, encodes the full container and measures UTF-8 bytes after minification. Free now reserves 47 KiB for its pet and 2 KiB for shared player metadata, while the final complete file check remains authoritative.

## Current limits

| Budget | Maximum |
|---|---:|
| Free complete `.chelo` | 51,200 bytes |
| Free pet payload | 48,128 bytes |
| Shared player metadata | 2,048 bytes |
| Pro pet payload | 512,000 bytes each |
| Pro pet count | 5 |
| Pro complete `.chelo` | 2,568,192 bytes |

## M4 synthetic stress result

| Fixture | Complete file | Pet bytes | Retained distinct position fingerprints |
|---|---:|---:|---:|
| Fresh Free | 669 bytes | small initial record | 0 |
| Saturated Free | 47,595 / 51,200 | 47,358 | 1,040 |
| Pro single pet | 511,438 / 512,000 | 511,202 | 11,343 |
| Pro five-pet file | 2,556,399 / 2,568,192 | 511,207 each | 11,398 each |

The synthetic fixtures are deliberately constructed to exercise storage limits. Retained-position counts are not a promise of a fixed number of real games, because actual game repetition, pending outcomes, tactical metadata and memory utility affect the final set.

## What is serialized

- One player identity/settings/active-match object.
- Pet identity/progression and three personality traits.
- Rank-1 Bond and rank-2 Arena Int8 adapters, in packed Base64 form.
- Compact memory rows indexed by 64-bit position fingerprints.
- Compact pending position/outcome-learning references.
- Mastery metadata and timestamps.
- Container version and CRC32.

The shared C++ engine, WASM, V37 model weights, opening book and static resources are not serialized.

## Test command

```sh
node tests/chelo-size-audit.test.js
node tests/chelo-format.test.js
node tests/learning.test.js
```

The test proves these fixtures fit the byte budgets. It does not prove online account sync has been deployed, every training history will fit without pruning, or that the learning algorithm improves Elo.
