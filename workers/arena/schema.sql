PRAGMA foreign_keys = ON;

-- Trainer and pet handles share one case-insensitive global namespace.
-- Only a SHA-256 hash of the random 256-bit access token is stored.
CREATE TABLE IF NOT EXISTS trainers (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  is_pro INTEGER NOT NULL DEFAULT 0 CHECK (is_pro IN (0,1)),
  created_at INTEGER NOT NULL
);

-- arena_elo is retained only as a legacy migration column; V5 uses verified
-- Arena Points instead. Handle collisions across trainers AND pets are blocked
-- by global_handles triggers below.
-- The legacy brain_json/brain_bytes columns remain small placeholders so this
-- schema can upgrade an existing V4 D1 database without rebuilding its FKs.
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT 'Chelo',
  trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  arena_elo INTEGER NOT NULL DEFAULT 100 CHECK (arena_elo >= 100),
  arena_points INTEGER NOT NULL DEFAULT 0 CHECK (arena_points >= 0),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  gen INTEGER NOT NULL DEFAULT 1,
  brain_json TEXT NOT NULL DEFAULT '{}',
  brain_bytes INTEGER NOT NULL DEFAULT 2 CHECK (brain_bytes BETWEEN 0 AND 51200),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pets_arena_points ON pets(arena_points DESC,wins DESC);
CREATE INDEX IF NOT EXISTS idx_pets_trainer ON pets(trainer_id);

-- V5 stores the actual compact brain separately so Pro can use 500 KiB while
-- the legacy pets table's 50 KiB CHECK remains compatible with old D1 schemas.
CREATE TABLE IF NOT EXISTS pet_brains_v5 (
  pet_id TEXT PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE,
  brain_json TEXT NOT NULL,
  brain_bytes INTEGER NOT NULL CHECK (brain_bytes BETWEEN 1 AND 512000),
  updated_at INTEGER NOT NULL
);

-- Maximum three ranked matches per UTC day for each target pet + stable
-- challenger trainer. Self-play and same-trainer matches are never ranked.
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
  points_awarded INTEGER NOT NULL DEFAULT 0 CHECK (points_awarded BETWEEN 0 AND 3),
  plies INTEGER NOT NULL,
  pgn TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_target ON arena_matches(target_pet_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arena_matches_challenger ON arena_matches(challenger_pet_id,created_at DESC);


-- A single registry enforces uniqueness across both handle types. Separate
-- UNIQUE constraints on trainers.handle and pets.handle are not sufficient:
-- this table also prevents a trainer from taking an existing pet's handle
-- (and vice versa), case-insensitively.
CREATE TABLE IF NOT EXISTS global_handles (
  handle TEXT PRIMARY KEY COLLATE NOCASE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('trainer','pet')),
  owner_id TEXT NOT NULL,
  UNIQUE(owner_type,owner_id)
);

-- Backfill current rows. A case-insensitive collision aborts setup instead of
-- silently choosing which public identity should keep the handle. Resolve any
-- collisions before deploying the schema/migration.
INSERT INTO global_handles(handle,owner_type,owner_id)
  SELECT handle,'trainer',id FROM trainers;
INSERT INTO global_handles(handle,owner_type,owner_id)
  SELECT handle,'pet',id FROM pets;

CREATE TRIGGER IF NOT EXISTS trainers_handle_registry_insert
AFTER INSERT ON trainers
BEGIN
  INSERT INTO global_handles(handle,owner_type,owner_id)
  VALUES (NEW.handle,'trainer',NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS trainers_handle_registry_update
AFTER UPDATE OF handle ON trainers
BEGIN
  DELETE FROM global_handles WHERE owner_type='trainer' AND owner_id=OLD.id;
  INSERT INTO global_handles(handle,owner_type,owner_id)
  VALUES (NEW.handle,'trainer',NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS trainers_handle_registry_delete
AFTER DELETE ON trainers
BEGIN
  DELETE FROM global_handles WHERE owner_type='trainer' AND owner_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS pets_handle_registry_insert
AFTER INSERT ON pets
BEGIN
  INSERT INTO global_handles(handle,owner_type,owner_id)
  VALUES (NEW.handle,'pet',NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS pets_handle_registry_update
AFTER UPDATE OF handle ON pets
BEGIN
  DELETE FROM global_handles WHERE owner_type='pet' AND owner_id=OLD.id;
  INSERT INTO global_handles(handle,owner_type,owner_id)
  VALUES (NEW.handle,'pet',NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS pets_handle_registry_delete
AFTER DELETE ON pets
BEGIN
  DELETE FROM global_handles WHERE owner_type='pet' AND owner_id=OLD.id;
END;
