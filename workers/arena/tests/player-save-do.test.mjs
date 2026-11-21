import assert from 'node:assert/strict';
import {PlayerSaveDO} from '../player-save-do.mjs';

function crc32(bytes){let crc=0xFFFFFFFF;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?(0xEDB88320^(crc>>>1)):(crc>>>1);}return ((crc^0xFFFFFFFF)>>>0).toString(16).padStart(8,'0');}
function makeDoc(plan,count){
  const bond=Buffer.alloc(517);bond[0]=1;bond[1]=8;const arena=Buffer.alloc(1030);arena[0]=2;arena[1]=8;
  const player={id:'player-1',handle:'trainer_1',settings:{},activeMatch:{version:4,mode:'human',movesPacked:''}};
  const pets=Array.from({length:count},(_,i)=>({id:`pet-${i+1}`,data:{v:16,i:[`Pet ${i+1}`,`pet_${i+1}`,1,0,0,0,0,0],t:[50,50,50],dl:{bond:bond.toString('base64'),arena:arena.toString('base64')},m:[],u:[]}}));
  const payload={format:'CHELO',version:1,plan,player,pets};
  return JSON.stringify({...payload,crc32:crc32(new TextEncoder().encode(JSON.stringify(payload)))});
}
class Storage {
  constructor(){this.data=new Map();}
  async get(key){return this.data.get(key);}
  async put(values){for(const [key,value] of Object.entries(values))this.data.set(key,value);}
}
const storage=new Storage(),worker=new PlayerSaveDO({storage});
const free=makeDoc('free',1);
let response=await worker.fetch(new Request('https://do/sync',{method:'PUT',headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1','Content-Type':'application/vnd.chelo+json'},body:free}));
assert.equal(response.status,200);const first=await response.json();assert.equal(first.petCount,1);assert.equal(first.fileBytes,new TextEncoder().encode(free).byteLength);
const etag=response.headers.get('ETag');assert(etag,'First sync must return an ETag.');
assert(storage.data.has('player')&&storage.data.has('pet:0')&&storage.data.has('manifest'),'Player and each pet must be stored as separate DO records.');
response=await worker.fetch(new Request('https://do/read',{headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1'}}));
assert.equal(response.status,200);assert.equal(response.headers.get('ETag'),etag);assert.deepEqual(JSON.parse(await response.text()),JSON.parse(free));
response=await worker.fetch(new Request('https://do/sync',{method:'PUT',headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1'},body:free}));assert.equal(response.status,428,'Existing cloud saves require a concurrency precondition.');
response=await worker.fetch(new Request('https://do/sync',{method:'PUT',headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1','If-Match':'"stale"'},body:free}));assert.equal(response.status,409,'Stale device writes must not overwrite newer saves.');
response=await worker.fetch(new Request('https://do/sync',{method:'PUT',headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1','If-Match':etag},body:free}));assert.equal(response.status,200);const nextEtag=response.headers.get('ETag'),next=await response.json();assert.equal(next.revision,2);
response=await worker.fetch(new Request('https://do/read',{headers:{'X-Chelo-Plan':'pro','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1'}}));assert.equal(response.status,409,'Plan mismatch must not silently expose or overwrite the save.');
const pro=makeDoc('pro',5);
response=await worker.fetch(new Request('https://do/sync',{method:'PUT',headers:{'X-Chelo-Plan':'pro','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1','If-Match':nextEtag},body:pro}));
// The account plan can change only with the last acknowledged ETag.
assert.equal(response.status,200);assert.equal((await response.json()).petCount,5);
response=await worker.fetch(new Request('https://do/read',{headers:{'X-Chelo-Plan':'pro','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1'}}));assert.equal(response.status,200);const restored=JSON.parse(await response.text());assert.equal(restored.pets.length,5);assert(storage.data.has('pet:4'));
response=await worker.fetch(new Request('https://do/read',{headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1'}}));assert.equal(response.status,409);
response=await worker.fetch(new Request('https://do/sync',{method:'PUT',headers:{'X-Chelo-Plan':'free','X-Chelo-Account-ID':'player-1','X-Chelo-Account-Handle':'trainer_1'},body:'not-json'}));assert.equal(response.status,413);

const {validateCheloText}=await import('../player-save-do.mjs');
assert.throws(()=>validateCheloText(makeDoc('free',1),'free','another-player','trainer_1'),/identity/,'A .chelo file cannot be uploaded to another authenticated account.');
console.log('PlayerSaveDO tests passed: single .chelo assembly, split player/pet storage, ETag concurrency, entitlement matching, and five-pet Pro sync.');
