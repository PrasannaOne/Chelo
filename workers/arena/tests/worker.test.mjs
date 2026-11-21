import assert from 'node:assert/strict';
import {validHandle,petLimitBytes,playerFileLimitBytes,arenaPointsFor,rankedPairingAllowed,replayMoves} from '../worker.mjs';

assert.equal(validHandle('prasanna_1'),true);
assert.equal(validHandle('TooLongHandleNameOver20'),false);
assert.equal(validHandle('bad-handle'),false);
assert.equal(validHandle('ab'),false);
assert.equal(petLimitBytes(false),97*1024);
assert.equal(petLimitBytes(true),500*1024);
assert.equal(playerFileLimitBytes(false),100*1024);
assert.equal(playerFileLimitBytes(true),5*500*1024+8*1024);
assert.equal(arenaPointsFor('w','w'),3);
assert.equal(arenaPointsFor('draw','b'),1);
assert.equal(arenaPointsFor('w','b'),0);
assert.deepEqual(rankedPairingAllowed({differentTrainers:true,targetMovesAttested:true,priorRatedMatches:2}),{allowed:true,reason:'eligible'});
assert.deepEqual(rankedPairingAllowed({differentTrainers:true,targetMovesAttested:true,priorRatedMatches:3}),{allowed:false,reason:'daily-challenger-cap'});
assert.deepEqual(rankedPairingAllowed({differentTrainers:true,targetMovesAttested:false,priorRatedMatches:0}),{allowed:false,reason:'target-moves-not-attested'});
assert.deepEqual(rankedPairingAllowed({differentTrainers:false,targetMovesAttested:true,priorRatedMatches:0}),{allowed:false,reason:'same-trainer'});

const draw=replayMoves(['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8']);
assert.equal(draw.result,'draw');assert.equal(draw.plies,8);assert.equal(draw.claimableDraw,true);
assert.throws(()=>replayMoves(['e2e5','e7e5','g1f3','b8c6','f1c4','g8f6','d2d3','f8c5']),/illegal/);
assert.throws(()=>replayMoves(['e2e4','e7e5','g1f3','b8c6']),/8 to/);
const schema=await(await import('node:fs/promises')).readFile(new URL('../schema.sql',import.meta.url),'utf8');
assert.match(schema,/rating_day_utc TEXT NOT NULL/,'Anti-farming counter must reset by UTC day.');
assert.match(schema,/PRIMARY KEY \(target_pet_id, challenger_trainer_id, rating_day_utc\)/,'Daily cap must key target pet + stable challenger trainer + UTC day.');
assert.match(schema,/brain_bytes INTEGER NOT NULL CHECK \(brain_bytes BETWEEN 1 AND 512000\)/,'The retired legacy brain schema may retain its historical per-row cap.');
assert.match(schema,/arena_points INTEGER NOT NULL DEFAULT 0/,'V5 must use Arena Points rather than Elo.');
assert.match(schema,/CREATE TABLE IF NOT EXISTS global_handles/,'Trainer and pet handles must share one registry.');
for (const trigger of ['trainers_handle_registry_insert','trainers_handle_registry_update','trainers_handle_registry_delete','pets_handle_registry_insert','pets_handle_registry_update','pets_handle_registry_delete']) {
  assert.match(schema,new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}`),`Missing global handle trigger: ${trigger}`);
}
const migration=await(await import('node:fs/promises')).readFile(new URL('../migrations/0003_global_handle_registry.sql',import.meta.url),'utf8');
assert.match(migration,/GROUP BY lower\(handle\)/,'Migration must provide a case-insensitive collision preflight.');
assert.match(migration,/CREATE TABLE IF NOT EXISTS global_handles/,'Migration must create the shared handle registry.');
assert.match(migration,/pets_handle_registry_insert/,'Migration must enforce registry on pet creation.');
console.log('Arena V6 compatibility tests passed: Free/Pro storage, Arena Points, daily pairing cap, legal replay and rank-attestation safety.');
