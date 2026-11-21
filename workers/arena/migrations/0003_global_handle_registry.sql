-- Apply once after 0002_v5_brain_storage_and_arena_points.sql.
-- This makes trainer and pet handles unique across BOTH namespaces.
--
-- PRE-FLIGHT: run this query first. If it returns rows, rename one of each
-- colliding trainer/pet handle before applying this migration. Matching is
-- case-insensitive, just like the final registry.
--
-- SELECT lower(handle) AS collision_key,
--        group_concat(owner_type || ':' || owner_id) AS conflicting_records
-- FROM (
--   SELECT handle,'trainer' AS owner_type,id AS owner_id FROM trainers
--   UNION ALL
--   SELECT handle,'pet' AS owner_type,id AS owner_id FROM pets
-- )
-- GROUP BY lower(handle)
-- HAVING COUNT(*) > 1;

CREATE TABLE IF NOT EXISTS global_handles (
  handle TEXT PRIMARY KEY COLLATE NOCASE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('trainer','pet')),
  owner_id TEXT NOT NULL,
  UNIQUE(owner_type,owner_id)
);

-- These inserts intentionally fail if pre-flight conflicts were not resolved.
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
