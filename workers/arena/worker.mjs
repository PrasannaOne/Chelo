import '../../src/engine/chess.js';
import {PlayerSaveDO} from './player-save-do.mjs';
export {PlayerSaveDO};

const FREE_FILE_BYTES = 100 * 1024;
const FREE_PET_BYTES = 97 * 1024;
const PRO_PET_BYTES = 500 * 1024;
const PRO_FILE_BYTES = 5 * PRO_PET_BYTES + 8 * 1024;
const HANDLE = /^[a-z0-9_]{3,20}$/;
const MAX_MATCH_PLIES = 600;
const Chess = globalThis.ChessCore;

export function validHandle(value) {
  return typeof value === 'string' && HANDLE.test(value);
}

export function petLimitBytes(isPro) { return isPro ? PRO_PET_BYTES : FREE_PET_BYTES; }
export function playerFileLimitBytes(isPro) { return isPro ? PRO_FILE_BYTES : FREE_FILE_BYTES; }

export function arenaPointsFor(result, petSide) {
  if (result === 'draw') return 1;
  return result === petSide ? 3 : 0;
}

export function rankedPairingAllowed({differentTrainers, targetMovesAttested, priorRatedMatches}) {
  if (!differentTrainers) return {allowed:false,reason:'same-trainer'};
  if (!targetMovesAttested) return {allowed:false,reason:'target-moves-not-attested'};
  if ((Number(priorRatedMatches)||0) >= 3) return {allowed:false,reason:'daily-challenger-cap'};
  return {allowed:true,reason:'eligible'};
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
    'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization'
  }
});
const fail = (message, status = 400, origin = '*') => json({ok:false,error:message},status,origin);
const cleanHandle = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

async function bodyJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 600000) throw new Error('Request body is too large.');
  try { return JSON.parse(text); }
  catch { throw new Error('Request body must be valid JSON.'); }
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
  return env.DB.prepare(`SELECT p.id,p.handle,p.display_name,p.trainer_id,p.arena_points,p.wins,p.losses,p.draws,p.gen,
    p.updated_at,t.handle AS trainer_handle,t.is_pro
    FROM pets p JOIN trainers t ON t.id=p.trainer_id WHERE p.handle=?`).bind(handle).first();
}

async function register(request, env, origin) {
  const body=await bodyJson(request);
  const trainerHandle=cleanHandle(body.trainerHandle),petHandle=cleanHandle(body.petHandle);
  const displayName=String(body.displayName||'Chelo').trim().slice(0,32)||'Chelo';
  if(!validHandle(trainerHandle))return fail('Trainer handle must be 3–20 characters using a–z, 0–9 or _.',400,origin);
  if(!validHandle(petHandle))return fail('Pet handle must be 3–20 characters using a–z, 0–9 or _.',400,origin);
  const token=newSecret(),tokenHash=await hashSecret(token),trainerId=crypto.randomUUID(),petId=crypto.randomUUID(),stamp=Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO trainers (id,handle,token_hash,created_at) VALUES (?,?,?,?)').bind(trainerId,trainerHandle,tokenHash,stamp),
      env.DB.prepare(`INSERT INTO pets (id,handle,display_name,trainer_id,arena_elo,arena_points,created_at,updated_at)
        VALUES (?,?,?,?,100,0,?,?)`).bind(petId,petHandle,displayName,trainerId,stamp,stamp)
    ]);
  } catch(error) { return fail('That handle is already in use by a trainer or pet. Choose another global handle.',409,origin); }
  return json({ok:true,trainerId,trainerHandle,petId,petHandle,accessToken:token,plan:'free',saveFormat:'CHELO v1',
    warning:'Save this token securely. It is shown once and cannot be recovered by the Worker.'},201,origin);
}

async function createAdditionalPet(request, env, origin) {
  const trainer=await authenticatedTrainer(request,env);
  if(!trainer)return fail('Authentication required.',401,origin);
  const account=await env.DB.prepare('SELECT is_pro FROM trainers WHERE id=?').bind(trainer.id).first();
  const isPro=!!account?.is_pro,countRow=await env.DB.prepare('SELECT COUNT(*) AS total FROM pets WHERE trainer_id=?').bind(trainer.id).first();
  const petLimit=isPro?5:1;
  if((Number(countRow?.total)||0)>=petLimit)return fail(`Your current plan allows ${petLimit} pet slot${petLimit===1?'':'s'}.`,403,origin);
  const body=await bodyJson(request),handle=cleanHandle(body.petHandle),displayName=String(body.displayName||'Chelo').trim().slice(0,32)||'Chelo';
  if(!validHandle(handle))return fail('Pet handle must be 3–20 characters using a–z, 0–9 or _.',400,origin);
  const petId=crypto.randomUUID(),stamp=Date.now();
  try {
    await env.DB.prepare(`INSERT INTO pets (id,handle,display_name,trainer_id,arena_elo,arena_points,created_at,updated_at)
      VALUES (?,?,?,?,100,0,?,?)`).bind(petId,handle,displayName,trainer.id,stamp,stamp).run();
  } catch { return fail('That handle is already in use by a trainer or pet. Choose another global handle.',409,origin); }
  return json({ok:true,petId,handle,plan:isPro?'pro':'free',petSlotsAllowed:petLimit,saveFormat:'CHELO v1'},201,origin);
}

async function playerSave(request, env, origin) {
  const trainer=await authenticatedTrainer(request,env);
  if(!trainer)return fail('Authentication required.',401,origin);
  if(!env.PLAYER_SAVES)return fail('Player save storage is not configured. Bind the SQLite-backed PlayerSaveDO namespace.',503,origin);
  const account=await env.DB.prepare('SELECT is_pro FROM trainers WHERE id=?').bind(trainer.id).first();
  const isPro=!!account?.is_pro,plan=isPro?'pro':'free';
  const id=env.PLAYER_SAVES.idFromName(`trainer:${trainer.id}`),stub=env.PLAYER_SAVES.get(id);
  let upstream;
  if(request.method==='PUT'){
    const announced=Number(request.headers.get('Content-Length')||0),limit=playerFileLimitBytes(isPro);
    if(announced>limit)return fail(`The complete .chelo file exceeds the ${limit}-byte ${plan} limit.`,413,origin);
    const body=await request.arrayBuffer();
    if(body.byteLength>limit)return fail(`The complete .chelo file exceeds the ${limit}-byte ${plan} limit.`,413,origin);
    const headers={'Content-Type':'application/vnd.chelo+json','X-Chelo-Plan':plan,'X-Chelo-Account-ID':trainer.id,'X-Chelo-Account-Handle':trainer.handle};
    const etag=request.headers.get('If-Match');if(etag)headers['If-Match']=etag;
    upstream=await stub.fetch('https://chelo-player-save/sync',{method:'PUT',headers,body});
  } else {
    upstream=await stub.fetch('https://chelo-player-save/read',{method:'GET',headers:{'X-Chelo-Plan':plan,'X-Chelo-Account-ID':trainer.id,'X-Chelo-Account-Handle':trainer.handle}});
  }
  const headers=new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Methods','GET, PUT, OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type, Authorization, If-Match');headers.set('Access-Control-Expose-Headers','ETag, X-Chelo-Revision, X-Chelo-Bytes, X-Chelo-Pets');headers.set('Cache-Control','no-store');
  return new Response(upstream.body,{status:upstream.status,headers});
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
    return fail('A trainer cannot earn Arena Points by challenging their own pets. Use local Practice Mode instead.',409,origin);
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
    (id,target_pet_id,challenger_pet_id,challenger_trainer_id,target_side,result,rated,points_awarded,plies,pgn,created_at)
    VALUES (?,?,?,?,?,?,0,0,?,?,?)`)
    .bind(matchId,target.id,challenger.id,trainer.id,targetSide,verified.result,verified.plies,verified.pgn,stamp).run();
  const day=new Date(stamp).toISOString().slice(0,10);
  const prior=await env.DB.prepare('SELECT rated_matches FROM rated_pairings WHERE target_pet_id=? AND challenger_trainer_id=? AND rating_day_utc=?')
    .bind(target.id,trainer.id,day).first();
  const eligibility=rankedPairingAllowed({differentTrainers:target.trainer_id!==trainer.id,targetMovesAttested:false,priorRatedMatches:prior?.rated_matches||0});
  return json({ok:true,verified:true,verification:'legal-replay-only',arenaLearningAllowed:false,result:verified.result,ranked:false,arenaPointsAwarded:0,
    dailyRankedMatchesRemaining:Math.max(0,3-(Number(prior?.rated_matches)||0)),
    reason:eligibility.reason==='target-moves-not-attested'?'The submitted game is legal, but the target pet move sequence is not independently attested. It is saved as an unranked exhibition.':'This exhibition is not ranked.'},200,origin);
}

export async function handleRequest(request, env) {
  const origin = env.CORS_ORIGIN || '*';
  if (request.method === 'OPTIONS') return new Response(null,{headers:{
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization, If-Match','Access-Control-Max-Age':'86400'
  }});
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ok:true,service:'Chelo Arena API',version:6,saveFormat:'CHELO v1',freeFileBytes:FREE_FILE_BYTES,freePetBytes:FREE_PET_BYTES,proPetBytes:PRO_PET_BYTES,proPets:5,proFileBytes:PRO_FILE_BYTES},200,origin);
    if (url.pathname === '/api/register' && request.method === 'POST') return await register(request,env,origin);
    if (url.pathname === '/api/pets' && request.method === 'POST') return await createAdditionalPet(request,env,origin);
    if (url.pathname === '/api/player/save' && (request.method === 'GET' || request.method === 'PUT')) return await playerSave(request,env,origin);
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
      const {results=[]} = await env.DB.prepare(`SELECT p.handle,p.display_name,p.arena_points,p.wins,p.losses,p.draws,p.gen,t.is_pro,t.handle AS trainer_handle
        FROM pets p JOIN trainers t ON t.id=p.trainer_id
        WHERE EXISTS (SELECT 1 FROM arena_matches m WHERE m.rated=1 AND (m.target_pet_id=p.id OR m.challenger_pet_id=p.id))
        ORDER BY p.arena_points DESC,p.wins DESC LIMIT 25`).all();
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
          arenaPoints:pet.arena_points,arenaRank:'unranked-until-verified',wins:pet.wins,losses:pet.losses,draws:pet.draws,generation:pet.gen,
          plan:pet.is_pro?'pro':'free',isPro:!!pet.is_pro,updatedAt:pet.updated_at}},200,origin);
      }
      if (action==='sync' && request.method==='POST') return fail('Per-pet brain sync has been retired. Sync the complete player collection at /api/player/save.',410,origin);
      if (action==='challenge' && request.method==='POST') return await submitChallenge(request,env,origin,handle);
    }
    return fail('Route not found.',404,origin);
  } catch (error) {
    return fail(error?.message || 'Arena request failed.',500,origin);
  }
}

export default {fetch:handleRequest};
