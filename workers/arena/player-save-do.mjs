const FREE_FILE_BYTES = 100 * 1024;
const FREE_PET_BYTES = 97 * 1024;
const PLAYER_META_BYTES = 2 * 1024;
const PRO_PET_BYTES = 500 * 1024;
const PRO_FILE_BYTES = 5 * PRO_PET_BYTES + 8 * 1024;
const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

function payloadOf(doc) {
  return {format:'CHELO',version:1,plan:doc.plan,player:doc.player,pets:doc.pets};
}

export function validateCheloText(text, expectedPlan, expectedAccountId, expectedHandle) {
  const bytes = encoder.encode(text).byteLength;
  const fileLimit = expectedPlan === 'pro' ? PRO_FILE_BYTES : FREE_FILE_BYTES;
  if (bytes > fileLimit) throw new Error(`The .chelo file is ${bytes} bytes; the ${expectedPlan} limit is ${fileLimit}.`);
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('The uploaded .chelo file is not valid JSON.'); }
  if (!doc || doc.format !== 'CHELO' || doc.version !== 1 || doc.plan !== expectedPlan) throw new Error('The uploaded .chelo header or verified plan is invalid.');
  if (!doc.player || typeof doc.player !== 'object' || Array.isArray(doc.player)) throw new Error('The .chelo player record is missing.');
  if (typeof expectedAccountId !== 'string' || !expectedAccountId || doc.player.id !== expectedAccountId) throw new Error('The .chelo player identity does not match the authenticated account.');
  if (typeof expectedHandle !== 'string' || !expectedHandle || doc.player.handle !== expectedHandle) throw new Error('The .chelo trainer handle does not match the authenticated account.');
  const playerBytes = encoder.encode(JSON.stringify(doc.player)).byteLength;
  if (playerBytes > PLAYER_META_BYTES) throw new Error(`Player metadata exceeds ${PLAYER_META_BYTES} bytes.`);
  if (!Array.isArray(doc.pets)) throw new Error('The .chelo pet roster is invalid.');
  const maxPets = expectedPlan === 'pro' ? 5 : 1;
  if (!doc.pets.length || doc.pets.length > maxPets) throw new Error(`The ${expectedPlan} plan allows ${maxPets} saved pet${maxPets === 1 ? '' : 's'}.`);
  const ids = new Set();
  const petBytes = [];
  for (const pet of doc.pets) {
    if (!pet || typeof pet.id !== 'string' || !pet.id || ids.has(pet.id) || !pet.data || pet.data.v !== 16 || !Array.isArray(pet.data.i) || pet.data.i.length!==8 || !Array.isArray(pet.data.t) || pet.data.t.length!==3 || !pet.data.dl || !Array.isArray(pet.data.m) || !Array.isArray(pet.data.u)) throw new Error('A .chelo pet record is malformed or duplicated.');
    ids.add(pet.id);
    if (['n','la','r','model','weights','policy','replay','v14Adapter','humanOpenings','openingReplies'].some(key=>Object.prototype.hasOwnProperty.call(pet.data,key))) throw new Error('Legacy learner/replay/shared-model payloads are not accepted in the compact .chelo format.');
    const adapterOk=(value,rank)=>{if(typeof value!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return false;try{const raw=atob(value);return raw.length===4+513*rank&&raw.charCodeAt(0)===rank&&raw.charCodeAt(1)<=14;}catch{return false;}};
    if(!adapterOk(pet.data.dl.bond,1)||!adapterOk(pet.data.dl.arena,2))throw new Error('A .chelo Bond/Arena adapter is malformed.');
    const size = encoder.encode(JSON.stringify(pet.data)).byteLength;
    const petLimit = expectedPlan === 'pro' ? PRO_PET_BYTES : FREE_PET_BYTES;
    if (size > petLimit) throw new Error(`Pet ${pet.data.i[0] || pet.id} is ${size} bytes; its limit is ${petLimit}.`);
    petBytes.push(size);
  }
  const payload = payloadOf(doc);
  const actualCrc = crc32(encoder.encode(JSON.stringify(payload)));
  if (typeof doc.crc32 !== 'string' || doc.crc32 !== actualCrc) throw new Error('The .chelo checksum is invalid.');
  return {doc,bytes,petBytes,playerBytes,crc32:actualCrc,fileLimit};
}

/**
 * One Durable Object per authenticated trainer. The player header and each pet
 * are separate SQLite-backed DO storage values so no single value approaches
 * Cloudflare's 2 MB key/value or SQL-row ceiling. The public .chelo remains one
 * portable file and is assembled only at the API boundary.
 */
export class PlayerSaveDO {
  constructor(state) {
    this.state = state;
    this.writeQueue = Promise.resolve();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Chelo-Plan, If-Match'}});
    if (url.pathname === '/sync' && request.method === 'PUT') return this.sync(request);
    if (url.pathname === '/read' && request.method === 'GET') return this.read(request);
    return Response.json({ok:false,error:'Player save route not found.'},{status:404});
  }

  async sync(request) {
    const plan = request.headers.get('X-Chelo-Plan');
    if (plan !== 'free' && plan !== 'pro') return Response.json({ok:false,error:'A verified account plan is required.'},{status:400});
    const bytes = await request.arrayBuffer();
    let text,checked;
    const accountId=request.headers.get('X-Chelo-Account-ID'),accountHandle=request.headers.get('X-Chelo-Account-Handle');
    try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); checked = validateCheloText(text,plan,accountId,accountHandle); }
    catch (error) { return Response.json({ok:false,error:error?.message || 'Invalid .chelo save.'},{status:413}); }

    const job = this.writeQueue.then(async () => {
      const {doc,crc32:checksum} = checked;
      const previous = await this.state.storage.get('manifest');
      const suppliedTag = request.headers.get('If-Match');
      if (previous && !suppliedTag) return {status:428,body:{ok:false,error:'Cloud save already exists. Read its ETag before replacing it.'}};
      if (previous && suppliedTag !== previous.etag) return {status:409,body:{ok:false,error:'Cloud save changed on another device. Download the latest file and merge before retrying.'}};
      if (!previous && suppliedTag && suppliedTag !== '*') return {status:409,body:{ok:false,error:'No previous cloud save exists for the supplied ETag.'}};
      const revision=(Number(previous?.revision)||0)+1,etag=`\"chelo-${revision}-${checksum}\"`;
      const values = {
        'manifest':{version:1,plan,accountId,accountHandle,count:doc.pets.length,crc32:checksum,etag,revision,updatedAt:Date.now(),fileBytes:checked.bytes},
        'player':doc.player
      };
      doc.pets.forEach((pet,index) => { values[`pet:${index}`] = pet; });
      // A multi-key put is committed atomically by the DO storage transaction.
      await this.state.storage.put(values);
      return {status:200,etag,body:{ok:true,plan,revision,petCount:doc.pets.length,fileBytes:checked.bytes,playerBytes:checked.playerBytes,petBytes:checked.petBytes,checksum}};
    });
    this.writeQueue = job.catch(() => undefined);
    try {
      const result=await job;
      return Response.json(result.body,{status:result.status||200,headers:result.etag?{'ETag':result.etag}:{}});
    }
    catch (error) { return Response.json({ok:false,error:error?.message || 'Cloud save failed.'},{status:500}); }
  }

  async read(request) {
    const plan = request.headers.get('X-Chelo-Plan');
    if (plan !== 'free' && plan !== 'pro') return Response.json({ok:false,error:'A verified account plan is required.'},{status:400});
    const accountId=request.headers.get('X-Chelo-Account-ID'),accountHandle=request.headers.get('X-Chelo-Account-Handle');
    const [manifest,player] = await Promise.all([this.state.storage.get('manifest'),this.state.storage.get('player')]);
    if (!manifest || !player) return Response.json({ok:false,error:'No cloud .chelo save exists yet.'},{status:404});
    if (!accountId || manifest.accountId !== accountId || manifest.accountHandle !== accountHandle || player.id !== accountId || player.handle !== accountHandle) return Response.json({ok:false,error:'Cloud save identity does not match the authenticated trainer.'},{status:403});
    if (manifest.plan !== plan) return Response.json({ok:false,error:'The cloud save belongs to a different plan. Do not overwrite it during a plan mismatch.'},{status:409});
    const pets = [];
    for (let i=0;i<manifest.count;i++) {
      const pet = await this.state.storage.get(`pet:${i}`);
      if (!pet) return Response.json({ok:false,error:'The cloud .chelo roster is incomplete; local data has not been changed.'},{status:500});
      pets.push(pet);
    }
    const doc = {format:'CHELO',version:1,plan,player,pets};
    const checksum = crc32(encoder.encode(JSON.stringify(doc)));
    if (checksum !== manifest.crc32) return Response.json({ok:false,error:'Cloud .chelo checksum mismatch.'},{status:500});
    const text = JSON.stringify({...doc,crc32:checksum});
    const bytes = encoder.encode(text).byteLength;
    const limit = plan === 'pro' ? PRO_FILE_BYTES : FREE_FILE_BYTES;
    if (bytes > limit) return Response.json({ok:false,error:'Cloud .chelo exceeds the current plan file budget.'},{status:500});
    return new Response(text,{status:200,headers:{'Content-Type':'application/vnd.chelo+json; charset=utf-8','Cache-Control':'no-store','ETag':manifest.etag||`\"chelo-${manifest.revision||1}-${checksum}\"`,'X-Chelo-Revision':String(manifest.revision||1),'X-Chelo-Bytes':String(bytes),'X-Chelo-Pets':String(pets.length)}});
  }
}
