PRAGMA foreign_keys = ON;

-- One immutable, globally unique trainer identity per account.
-- Only a SHA-256 hash of the random 256-bit access token is stored.
CREATE TABLE IF NOT EXISTS trainers (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  is_pro INTEGER NOT NULL DEFAULT 0 CHECK (is_pro IN (0,1)),
  created_at INTEGER NOT NULL
);

-- Pet handles are globally unique. A trainer may own multiple pets in a future Pro tier.
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT 'Chessling',
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  arena_elo INTEGER NOT NULL DEFAULT 100 CHECK (arena_elo >= 100),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  gen INTEGER NOT NULL DEFAULT 1,
  brain_json TEXT NOT NULL,
  brain_bytes INTEGER NOT NULL DEFAULT 0 CHECK (brain_bytes BETWEEN 0 AND 51200),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pets_arena_elo ON pets(arena_elo DESC, wins DESC);
CREATE INDEX IF NOT EXISTS idx_pets_trainer ON pets(trainer_id);

-- Three rated matches per UTC day for each target pet + stable challenger trainer.
-- The daily key resets the allowance naturally at the next UTC date.
-- Do not key this by pet handle, display name or IP: those are easy to rotate or spoof.
CREATE TABLE IF NOT EXISTS rated_pairings (
  target_pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  challenger_trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  rating_day_utc TEXT NOT NULL,
  rated_matches INTEGER NOT NULL DEFAULT 0 CHECK (rated_matches BETWEEN 0 AND 3),
  last_match_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (target_pet_id, challenger_trainer_id, rating_day_utc)
);

CREATE TABLE IF NOT EXISTS arena_matches (
  id TEXT PRIMARY KEY,
  target_pet_id TEXT NOT NULL REFERENCES pets(id),
  challenger_pet_id TEXT NOT NULL REFERENCES pets(id),
  challenger_trainer_id TEXT NOT NULL REFERENCES trainers(id),
  target_side TEXT NOT NULL CHECK (target_side IN ('w','b')),
  result TEXT NOT NULL CHECK (result IN ('w','b','draw')),
  rated INTEGER NOT NULL CHECK (rated IN (0,1)),
  plies INTEGER NOT NULL,
  pgn TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_target ON arena_matches(target_pet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_matches_challenger ON arena_matches(challenger_pet_id, created_at DESC);
