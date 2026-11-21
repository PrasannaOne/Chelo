#!/usr/bin/env python3
"""Exercise fresh and V4-upgrade D1 SQL using Python's built-in SQLite."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1] / "workers" / "arena"
SCHEMA = (ROOT / "schema.sql").read_text(encoding="utf-8")
MIGRATION_2 = (ROOT / "migrations/0002_v5_brain_storage_and_arena_points.sql").read_text(encoding="utf-8")
MIGRATION_3 = (ROOT / "migrations/0003_global_handle_registry.sql").read_text(encoding="utf-8")


def expect_integrity_error(fn, message):
    try:
        fn()
    except sqlite3.IntegrityError:
        return
    raise AssertionError(message)


def test_fresh_schema():
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA)
    db.execute("INSERT INTO trainers(id,handle,token_hash,created_at) VALUES('t1','trainer_one','hash1',1)")
    db.execute("INSERT INTO pets(id,handle,trainer_id,created_at,updated_at) VALUES('p1','pet_one','t1',1,1)")

    expect_integrity_error(
        lambda: db.execute("INSERT INTO pets(id,handle,trainer_id,created_at,updated_at) VALUES('p2','TRAINER_ONE','t1',1,1)"),
        "Fresh schema accepted a pet handle colliding with a trainer handle.",
    )
    expect_integrity_error(
        lambda: db.execute("UPDATE trainers SET handle='PET_ONE' WHERE id='t1'"),
        "Fresh schema accepted a trainer handle update colliding with a pet.",
    )
    db.execute("UPDATE pets SET handle='pet_two' WHERE id='p1'")
    assert db.execute("SELECT handle FROM global_handles WHERE owner_id='p1'").fetchone() == ("pet_two",)
    db.execute("DELETE FROM pets WHERE id='p1'")
    assert db.execute("SELECT COUNT(*) FROM global_handles WHERE owner_id='p1'").fetchone()[0] == 0
    db.close()


def legacy_v4_database(with_cross_collision=False):
    db = sqlite3.connect(":memory:")
    db.executescript("""
        PRAGMA foreign_keys = ON;
        CREATE TABLE trainers (
          id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
          token_hash TEXT NOT NULL UNIQUE, is_pro INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE pets (
          id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL DEFAULT 'Chelo',
          trainer_id TEXT NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
          arena_elo INTEGER NOT NULL DEFAULT 100, wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
          gen INTEGER NOT NULL DEFAULT 1, brain_json TEXT NOT NULL DEFAULT '{}',
          brain_bytes INTEGER NOT NULL DEFAULT 2 CHECK(brain_bytes BETWEEN 0 AND 51200),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE arena_matches (
          id TEXT PRIMARY KEY, target_pet_id TEXT NOT NULL REFERENCES pets(id),
          challenger_pet_id TEXT NOT NULL REFERENCES pets(id),
          challenger_trainer_id TEXT NOT NULL REFERENCES trainers(id),
          target_side TEXT NOT NULL, result TEXT NOT NULL, rated INTEGER NOT NULL,
          plies INTEGER NOT NULL, pgn TEXT NOT NULL, created_at INTEGER NOT NULL
        );
    """)
    db.execute("INSERT INTO trainers VALUES('t1','trainer_one','hash1',0,1)")
    pet_handle = "TRAINER_ONE" if with_cross_collision else "pet_one"
    db.execute("INSERT INTO pets(id,handle,trainer_id,created_at,updated_at) VALUES('p1',?,'t1',1,1)", (pet_handle,))
    db.executescript(MIGRATION_2)
    return db


def test_v4_migration():
    db = legacy_v4_database()
    db.executescript(MIGRATION_3)
    db.execute("INSERT INTO trainers VALUES('t2','trainer_two','hash2',0,2)")
    expect_integrity_error(
        lambda: db.execute("INSERT INTO pets(id,handle,trainer_id,created_at,updated_at) VALUES('p2','TRAINER_TWO','t1',2,2)"),
        "V4-upgraded database accepted a cross-namespace case-insensitive collision.",
    )
    db.close()


def test_v4_migration_refuses_existing_collision():
    db = legacy_v4_database(with_cross_collision=True)
    try:
        db.executescript(MIGRATION_3)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Migration 0003 did not fail on a pre-existing cross-namespace collision.")
    db.close()


if __name__ == "__main__":
    test_fresh_schema()
    test_v4_migration()
    test_v4_migration_refuses_existing_collision()
    print("Arena SQL schema tests passed: fresh registry, V4 migration, cross-namespace uniqueness and collision refusal.")
