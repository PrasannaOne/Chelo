-- Apply once to an existing V4 D1 database before deploying the V5 Worker.
-- Keeping the existing pets.brain_json/brain_bytes columns untouched avoids a
-- destructive table rebuild and preserves pet/arena foreign-key relationships.
ALTER TABLE pets ADD COLUMN arena_points INTEGER NOT NULL DEFAULT 0 CHECK (arena_points >= 0);

CREATE TABLE IF NOT EXISTS pet_brains_v5 (
  pet_id TEXT PRIMARY KEY REFERENCES pets(id) ON DELETE CASCADE,
  brain_json TEXT NOT NULL,
  brain_bytes INTEGER NOT NULL CHECK (brain_bytes BETWEEN 1 AND 512000),
  updated_at INTEGER NOT NULL
);

ALTER TABLE arena_matches ADD COLUMN points_awarded INTEGER NOT NULL DEFAULT 0 CHECK (points_awarded BETWEEN 0 AND 3);

DROP INDEX IF EXISTS idx_pets_arena_elo;
CREATE INDEX IF NOT EXISTS idx_pets_arena_points ON pets(arena_points DESC,wins DESC);
CREATE INDEX IF NOT EXISTS idx_pets_trainer ON pets(trainer_id);
