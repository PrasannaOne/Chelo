import '../chess.js';

const MAX_BRAIN_BYTES = 50 * 1024;
const HANDLE = /^[a-z0-9_]{3,20}$/;
const K_FACTOR = 24;
const MAX_MATCH_PLIES = 600;
const Chess = globalThis.ChessCore;

export function validHandle(value) {
  return typeof value === 'string' && HANDLE.test(value);
}

export function eloDelta(rating, opponentRating, score, k = K_FACTOR) {
  const expected = 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
  return Math.round(k * (score - expected));
}

export function replayMoves(moves) {
  if (!Chess) throw new Error('Chess rules engine is unavailable.');
  if (!Array.isArray(moves) || moves.length < 8 || moves.length > MAX_MATCH_PLIES) {
    throw new Error(`A ranked match must contain 8 to ${MAX_MATCH_PLIES} half-moves.`);
  }
  const game = new Chess();
  for (let i = 0; i < moves.length; i++) {
    if (typeof moves[i] !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(moves[i])) {
      throw new Error(`Move ${i + 1} is not valid UCI notation.`);
    }
    if (!game.move(moves[i])) throw new Error(`Move ${i + 1} is illegal in the submitted position.`);
  }
  const claimableDraw = game.canClaimDraw();
  if (!game.game_over() && !claimableDraw) throw new Error('The submitted match has no verified final result.');
  return {result:game.game_over() ? game.result() : 'draw', pgn:game.pgn(), finalFen:game.fen(), plies:moves.length, claimableDraw};
}

const json = (body, status = 200, origin = '*') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization'
  }
});
const fail = (message, status = 400, origin = '*') => json({ok:false,error:message},status,origin);
const cleanHandle = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

async function bodyJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 100000) throw new Error('Request body is too large.');
  return request.json();
}

function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
}

async function hashSecret(secret) {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}

async function authenticatedTrainer(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer ([a-f0-9]{64})$/i);
  if (!match) return null;
  const tokenHash = await hashSecret(match[1]);
  return env.DB.prepare('SELECT id, handle FROM trainers WHERE token_hash = ?').bind(tokenHash).first();
}

async function getPet(env, handle) {
  return env.DB.prepare(`SELECT p.id,p.handle,p.display_name,p.trainer_id,p.arena_elo,p.wins,p.losses,p.draws,p.gen,
    p.brain_json,p.brain_bytes,p.updated_at,t.handle AS trainer_handle,t.is_pro
    FROM pets p JOIN trainers t ON t.id=p.trainer_id WHERE p.handle=?`).bind(handle).first();
}

async function register(request, env, origin) {
  const body = await bodyJson(request);
  const trainerHandle = cleanHandle(body.trainerHandle);
  const petHandle = cleanHandle(body.petHandle);
  const displayName = String(body.displayName || 'Chessling').trim().slice(0,32) || 'Chessling';
  if (!validHandle(trainerHandle)) return fail('Trainer handle must be 3–20 characters using a–z, 0–9 or _.',400,origin);
  if (!validHandle(petHandle)) return fail('Pet handle must be 3–20 characters using a–z, 0–9 or _.',400,origin);
  const token = newSecret();
  const tokenHash = await hashSecret(token);
  const trainerId = crypto.randomUUID();
  const petId = crypto.randomUUID();
  const initialBrain = body.brain || {v:3,i:[displayName,petHandle,trainerHandle,1,100,1000,0,0,0,0,0],w:[100,110,110,120,130,9000],a:[0,0,0,0],t:[50,50,50],m:[],h:[],o:[],q:[],g:[0,0,0,0,0],l:null,c:Date.now(),u:Date.now()};
  const brainJson = JSON.stringify(initialBrain);
  const brainBytes = new TextEncoder().encode(brainJson).length;
  if (brainBytes > MAX_BRAIN_BYTES) return fail('Pet brain exceeds the 50 KiB limit.',413,origin);
  if (!initialBrain || initialBrain.v !== 3) return fail('A compact Chessling V3 brain is required.',400,origin);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO trainers (id,handle,token_hash,created_at) VALUES (?,?,?,?)').bind(trainerId,trainerHandle,tokenHash,Date.now()),
      env.DB.prepare(`INSERT INTO pets (id,handle,display_name,trainer_id,arena_elo,brain_json,brain_bytes,created_at,updated_at)
        VALUES (?,?,?,?,100,?,?,?,?)`).bind(petId,petHandle,displayName,trainerId,brainJson,brainBytes,Date.now(),Date.now())
    ]);
  } catch (error) {
    return fail('That trainer or pet handle is already taken. Choose another handle.',409,origin);
  }
  return json({ok:true,trainerHandle,petHandle,accessToken:token,warning:'Save this token securely. It is shown once and cannot be recovered by the Worker.'},201,origin);
}

async function createAdditionalPet(request, env, origin) {
  const trainer = await authenticatedTrainer(request,env);
  if (!trainer) return fail('Authentication required.',401,origin);
  const account = await env.DB.prepare('SELECT is_pro FROM trainers WHERE id=?').bind(trainer.id).first();
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS total FROM pets WHERE trainer_id=?').bind(trainer.id).first();
  const limit = account?.is_pro ? 5 : 1;
  if ((Number(countRow?.total)||0) >= limit) return fail(`Your current plan allows ${limit} pet slot${limit===1?'':'s'}.`,403,origin);
  const body = await bodyJson(request);
  const handle = cleanHandle(body.petHandle);
  const displayName = String(body.displayName||'Chessling').trim().slice(0,32)||'Chessling';
  if (!validHandle(handle)) return fail('Pet handle must be 3–20 characters using a–z, 0–9 or _.',400,origin);
  const brain = body.brain;
  if (!brain || typeof brain !== 'object' || brain.v !== 3) return fail('A compact Chessling V3 brain is required.',400,origin);
  const brainJson = JSON.stringify(brain);
  const brainBytes = new TextEncoder().encode(brainJson).length;
  if (brainBytes > MAX_BRAIN_BYTES) return fail('Pet brain exceeds the 50 KiB limit.',413,origin);
  try {
    await env.DB.prepare(`INSERT INTO pets (id,handle,display_name,trainer_id,arena_elo,brain_json,brain_bytes,created_at,updated_at)
      VALUES (?,?,?,?,100,?,?,?,?)`).bind(crypto.randomUUID(),handle,displayName,trainer.id,brainJson,brainBytes,Date.now(),Date.now()).run();
  } catch { return fail('That pet handle is already taken.',409,origin); }
  return json({ok:true,handle,brainBytes},201,origin);
}

async function syncPet(request, env, origin, handle) {
  const trainer = await authenticatedTrainer(request,env);
  if (!trainer) return fail('Authentication required.',401,origin);
  const pet = await env.DB.prepare('SELECT id,trainer_id FROM pets WHERE handle=?').bind(handle).first();
  if (!pet) return fail('Pet not found.',404,origin);
  if (pet.trainer_id !== trainer.id) return fail('Only the pet owner can sync this brain.',403,origin);
  const body = await bodyJson(request);
  const brain = body.brain;
  if (!brain || typeof brain !== 'object' || brain.v !== 3) return fail('A compact Chessling V3 brain is required.',400,origin);
  const brainJson = JSON.stringify(brain);
  const brainBytes = new TextEncoder().encode(brainJson).length;
  if (brainBytes > MAX_BRAIN_BYTES) return fail('Pet brain exceeds the 50 KiB limit.',413,origin);
  const displayName = String(body.displayName || 'Chessling').trim().slice(0,32) || 'Chessling';
  await env.DB.prepare(`UPDATE pets SET display_name=?,brain_json=?,brain_bytes=?,gen=?,updated_at=? WHERE id=?`)
    .bind(displayName,brainJson,brainBytes,Math.max(1,Math.min(999,Number(body.gen)||1)),Date.now(),pet.id).run();
  return json({ok:true,handle,brainBytes},200,origin);
}

async function submitChallenge(request, env, origin, targetHandle) {
  const trainer = await authenticatedTrainer(request,env);
  if (!trainer) return fail('Authentication required.',401,origin);
  const body = await bodyJson(request);
  const challengerHandle = cleanHandle(body.challengerPetHandle);
  const targetSide = body.targetSide === 'w' ? 'w' : body.targetSide === 'b' ? 'b' : '';
  if (!validHandle(challengerHandle)) return fail('A valid challenger pet handle is required.',400,origin);
  if (!targetSide) return fail('targetSide must be w or b.',400,origin);
  const [target,challenger] = await Promise.all([getPet(env,targetHandle),getPet(env,challengerHandle)]);
  if (!target || !challenger) return fail('One of the pets could not be found.',404,origin);
  if (challenger.trainer_id !== trainer.id) return fail('The authenticated trainer does not own the challenger pet.',403,origin);
  if (target.id === challenger.id || target.trainer_id === trainer.id) {
    return fail('A trainer cannot earn Arena Elo by challenging their own pets. Use local Practice Mode instead.',409,origin);
  }
  let verified;
  try { verified = replayMoves(body.moves); }
  catch (error) { return fail(error.message,422,origin); }
  // Replay proves that the submitted chess game is legal and that its final result is real.
  // It does NOT prove that the target pet's AI generated the target-side moves. Until those
  // moves have server-verifiable attestation, this endpoint stores the game as unranked.
  const matchId = crypto.randomUUID();
  const stamp = Date.now();
  await env.DB.prepare(`INSERT INTO arena_matches
    (id,target_pet_id,challenger_pet_id,challenger_trainer_id,target_side,result,rated,plies,pgn,created_at)
    VALUES (?,?,?,?,?,?,0,?,?,?)`)
    .bind(matchId,target.id,challenger.id,trainer.id,targetSide,verified.result,verified.plies,verified.pgn,stamp).run();
  return json({ok:true,verified:true,verification:'legal-replay-only',result:verified.result,rated:false,
    ratingChanged:false,reason:'Arena Elo stays disabled until the target pet moves can be independently attested.'},200,origin);
}

export async function handleRequest(request, env) {
  const origin = env.CORS_ORIGIN || '*';
  if (request.method === 'OPTIONS') return new Response(null,{headers:{
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'86400'
  }});
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ok:true,service:'Chessling Arena API',version:3},200,origin);
    if (url.pathname === '/api/register' && request.method === 'POST') return await register(request,env,origin);
    if (url.pathname === '/api/pets' && request.method === 'POST') return await createAdditionalPet(request,env,origin);
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      const {results=[]} = await env.DB.prepare(`SELECT p.handle,p.display_name,p.arena_elo,p.wins,p.losses,p.draws,p.gen,t.is_pro,t.handle AS trainer_handle
        FROM pets p JOIN trainers t ON t.id=p.trainer_id ORDER BY p.arena_elo DESC,p.wins DESC LIMIT 25`).all();
      return json({ok:true,results},200,origin);
    }
    const petMatch=url.pathname.match(/^\/api\/pets\/([a-z0-9_]{3,20})(?:\/(sync|challenge))?$/);
    if (petMatch) {
      const handle=petMatch[1], action=petMatch[2]||'';
      if (!validHandle(handle)) return fail('Invalid pet handle.',400,origin);
      if (!action && request.method === 'GET') {
        const pet=await getPet(env,handle);
        if (!pet) return fail('Pet not found.',404,origin);
        return json({ok:true,pet:{handle:pet.handle,displayName:pet.display_name,trainerHandle:pet.trainer_handle,
          arenaElo:pet.arena_elo,wins:pet.wins,losses:pet.losses,draws:pet.draws,generation:pet.gen,
          isPro:!!pet.is_pro,brain:JSON.parse(pet.brain_json),brainBytes:pet.brain_bytes,updatedAt:pet.updated_at}},200,origin);
      }
      if (action==='sync' && request.method==='POST') return await syncPet(request,env,origin,handle);
      if (action==='challenge' && request.method==='POST') return await submitChallenge(request,env,origin,handle);
    }
    return fail('Route not found.',404,origin);
  } catch (error) {
    return fail(error?.message || 'Arena request failed.',500,origin);
  }
}

export default {fetch:handleRequest};
