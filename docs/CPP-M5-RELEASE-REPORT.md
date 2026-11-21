# Chelo V15-CPP M5: Adaptive Companion + 100 KiB Free Save

## Scope

M5 builds on M4. It changes the Free `.chelo` capacity and adds a trainer-responsive local companion difficulty controller. The C++ engine sources and V37 NNUE model remain frozen.

## Storage contract

- Free: one complete `.chelo` file capped at 100 KiB; 97 KiB reserved for its one pet and the remaining allowance covers player metadata/container overhead.
- Pro: one complete `.chelo` file with five independent 500 KiB pet records plus the existing 8 KiB shared/container allowance.
- Cloudflare Worker and Durable Object validation use the same Free and Pro limits.
- Existing M4/V16 pet records migrate with a default adaptive challenge estimate of 300; existing Pro records retain their 500 KiB per-pet allowance.

## Adaptive companion

- Fresh pets start at an internal challenge estimate of 300. This is explicitly not advertised as a certified FIDE/USCF Elo.
- After completed trainer games, player wins gradually increase the challenge, Chelo wins reduce it, and draws make a small upward adjustment. Undoing or abandoning a match does not update the estimate.
- The estimate is saved in the `.chelo` pet record alongside its mastery metadata.
- The same search implementation is used at every level. Search budgets grow smoothly from approximately 5,800 nodes / 135 ms / depth 4 at the start to 180,000 nodes / 800 ms / depth 14 at the upper cap.
- The app sends `mode: adaptive`; this intentionally avoids the fixed 30,000-node ranked-fairness branch. Online ranked modes remain fixed-budget and are not affected.
- This is a challenge controller, not a calibrated Elo mapping. Its actual playing-strength curve needs human playtesting and engine gauntlets.

## UI

- Added a compact Adaptive challenge indicator.
- Clarified that the displayed number is an internal estimate, not a certified chess rating.
- Updated Free save meter and labels to 100 KiB.

## Verification

- Free synthetic storage fixture: 98,800 bytes of 102,400 bytes, retaining 2,188 synthetic position fingerprints.
- Pro synthetic fixture: 2,556,439 bytes of 2,568,192 bytes, with five 511,215-byte pet payloads.
- Fresh Free `.chelo`: 716 bytes.
- Adaptive challenge tests cover starting estimate, repeated trainer wins, repeated Chelo wins, search-budget scaling and `.chelo` round-trip persistence.
- Worker test confirms adaptive mode uses the supplied personalised budget rather than the fixed 30,000-node ranked budget.
- Existing perft, tactical, NNUE, native/WASM parity, Worker, Arena, storage and migration tests passed; the full CPP-M2 script was run separately and passed.

## Frozen model

`models/dual-nnue-v37.bin`: 49,368 bytes.
SHA-256: `f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`.

## Known limitations

- The adaptive number is not a measured Elo rating. The node/time curve is provisional until tested against a range of human skill levels.
- This milestone still uses the existing JavaScript FastSearch path for the app's adaptive casual games. The next engine milestone will integrate the canonical C++/V37 engine with the personal adapters.
- Real Android device latency and multi-month retention tests remain outstanding.
- Cloudflare deployment and account sync UI are not completed by this milestone.
