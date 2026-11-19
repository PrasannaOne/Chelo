import assert from 'node:assert/strict';
import {validHandle,eloDelta,replayMoves} from './worker.mjs';

assert.equal(validHandle('prasanna_1'),true);
assert.equal(validHandle('TooLongHandleNameOver20'),false);
assert.equal(validHandle('bad-handle'),false);
assert.equal(validHandle('ab'),false);
assert.equal(eloDelta(100,100,1),12);
assert.equal(eloDelta(100,100,0),-12);
assert.equal(eloDelta(100,100,0.5),0);

// Two repetitions of the four-ply knight cycle create a claimable threefold draw.
const draw = replayMoves(['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8']);
assert.equal(draw.result,'draw');
assert.equal(draw.plies,8);
assert.equal(draw.claimableDraw,true);

assert.throws(()=>replayMoves(['e2e5','e7e5','g1f3','b8c6','f1c4','g8f6','d2d3','f8c5']),/illegal/);
assert.throws(()=>replayMoves(['e2e4','e7e5','g1f3','b8c6']),/8 to/);
const schema = await (await import('node:fs/promises')).readFile(new URL('./schema.sql', import.meta.url),'utf8');
assert.match(schema,/rating_day_utc TEXT NOT NULL/,'Anti-farming counter must reset by UTC day.');
assert.match(schema,/PRIMARY KEY \(target_pet_id, challenger_trainer_id, rating_day_utc\)/,'Daily anti-farming key must use target pet + stable trainer + UTC day.');
console.log('Arena foundation checks passed: unique-handle validation, Elo arithmetic, legal replay and claimable-draw detection.');
