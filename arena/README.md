# Chessling Arena Worker · V3 foundation

This folder contains the server-side foundation for globally unique trainer/pet handles, owner-only brain sync, public pet profiles, legal pet-vs-pet match replay and the three-rated-matches-per-challenger-per-UTC-day rule.

## Endpoints

- `POST /api/register` creates a unique trainer and first pet. The response contains a random 256-bit access token once. Store it securely on the client; the database stores only its SHA-256 hash.
- `POST /api/pets` creates another pet for an authenticated trainer, respecting the one-pet Free / five-pet Pro slot cap.
- `GET /api/pets/:handle` returns a public pet profile and its read-only compact brain for challenge play.
- `POST /api/pets/:handle/sync` updates a brain only when the Bearer token belongs to that pet's trainer. The compact brain is limited to 51,200 UTF-8 bytes.
- `POST /api/pets/:target/challenge` accepts `{ "challengerPetHandle":"...", "targetSide":"w", "moves":["e2e4", ...] }`. The Worker replays every legal move and checks the final result, but stores the game as unranked for now.
- `GET /api/leaderboard` returns the current top 25 pets.

The database includes the target-pet + stable challenger-trainer + UTC-day counter for the three-rated-match-per-day rule. It is deliberately not activated yet: a submitted legal move list does not prove that the target pet AI generated its own moves. Until server-verifiable move attestation exists, every challenge is recorded as unranked and no Arena Elo changes. A trainer also cannot challenge their own pets for rating; local self-play is practice only and never changes ratings.

## Deploy

1. Create a Cloudflare D1 database named `chessling-arena`.
2. Run `schema.sql` in that database.
3. Replace `database_id` and `CORS_ORIGIN` in `wrangler.toml`.
4. From this folder, deploy with Wrangler: `npx wrangler deploy`.
5. Keep the access token out of source control and never place it in a Soul export.

## Important production boundary

This is a backend foundation, not yet connected to the local UI. It does not yet provide token recovery, a full account-management experience, payment verification, rate limiting, moderation or a deployed service. A production launch needs those pieces plus independent security review. Legal move replay is enforced server-side, and browser-supplied results/Elo are never trusted. Ranked results remain disabled until target-side AI moves can also be independently attested; only then should the three-match counter be enabled.
