/* Chelo unified player-save container. One portable .chelo file; pet records stay split internally for efficient local/cloud sync. */
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const encoder = new TextEncoder();
  const FREE_FILE_BYTES = 100 * 1024;
  const FREE_PET_BYTES = 97 * 1024; // 2 KiB shared player metadata plus container overhead stay inside the 100 KiB file cap
  const PLAYER_META_BYTES = 2 * 1024;
  const PRO_PET_BYTES = 500 * 1024;
  const PRO_PET_COUNT = 5;
  const PRO_FILE_BYTES = PRO_PET_BYTES * PRO_PET_COUNT + 8192;
  const DB_NAME = 'chelo-player-store';
  const DB_VERSION = 1;
  const DB_PLAYER_KEY = 'primary';
  const DB_PET_STORE = 'pets';

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
  }
  const payloadOf = doc => ({format:'CHELO', version:1, plan:doc.plan, player:doc.player, pets:doc.pets});

  function packMoves(moves){
    if(!Array.isArray(moves)||moves.length>600)throw new Error('The saved match may contain at most 600 half-moves.');
    const bytes=new Uint8Array(moves.length*2);
    for(let i=0;i<moves.length;i++){
      const uci=moves[i];if(typeof uci!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))throw new Error(`Invalid saved move: ${uci}`);
      const from=(8-Number(uci[1]))*8+uci.charCodeAt(0)-97,to=(8-Number(uci[3]))*8+uci.charCodeAt(2)-97,promo=uci[4]?({n:1,b:2,r:3,q:4}[uci[4]]||0):0;
      const code=(from<<6)|to|(promo<<12);bytes[i*2]=code&255;bytes[i*2+1]=code>>>8;
    }
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);
  }
  function unpackMoves(encoded){
    if(typeof encoded!=='string')return null;
    let binary;try{binary=atob(encoded);}catch{return null;}
    if(binary.length%2||binary.length>1200)return null;const moves=[];
    for(let i=0;i<binary.length;i+=2){
      const code=binary.charCodeAt(i)|(binary.charCodeAt(i+1)<<8),from=(code>>>6)&63,to=code&63,promo=(code>>>12)&7;
      if(promo>4)return null;
      const square=n=>'abcdefgh'[n&7]+String(8-(n>>3));
      moves.push(square(from)+square(to)+(promo?({1:'n',2:'b',3:'r',4:'q'}[promo]||''):''));
    }
    return moves;
  }
  function validateAdapter(encoded,rank){
    if(typeof encoded!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return false;
    try{const raw=atob(encoded);return raw.length===4+65*rank&&raw.charCodeAt(0)===rank&&raw.charCodeAt(1)<=14;}catch{return false;}
  }
  const byteLength = value => encoder.encode(JSON.stringify(value)).byteLength;

  function validate(doc, expectedPlan = doc?.plan) {
    if (!doc || doc.format !== 'CHELO' || doc.version !== 1) throw new Error('Unsupported .chelo save format.');
    if (!['free','pro'].includes(doc.plan) || doc.plan !== expectedPlan) throw new Error('The .chelo plan does not match the verified account entitlement.');
    if (!doc.player || typeof doc.player !== 'object' || Array.isArray(doc.player)) throw new Error('The .chelo player record is missing.');
    const playerBytes = byteLength(doc.player);
    if (playerBytes > PLAYER_META_BYTES) throw new Error(`Player data uses ${playerBytes} bytes; the shared metadata limit is ${PLAYER_META_BYTES}.`);
    if (!Array.isArray(doc.pets)) throw new Error('The .chelo pet roster is invalid.');
    const maxPets = doc.plan === 'pro' ? PRO_PET_COUNT : 1;
    if (doc.pets.length < 1 || doc.pets.length > maxPets) throw new Error(`This ${doc.plan} save may contain ${maxPets} pet${maxPets === 1 ? '' : 's'}.`);
    const ids = new Set();
    for (const entry of doc.pets) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !entry.data || entry.data.v !== 16 || !Array.isArray(entry.data.i) || entry.data.i.length!==8 || !Array.isArray(entry.data.t) || entry.data.t.length!==3 || !entry.data.dl || !Array.isArray(entry.data.m) || !Array.isArray(entry.data.u)) throw new Error('A .chelo pet record is invalid or duplicated.');
      if(['n','la','r','model','weights','policy','replay','v14Adapter','humanOpenings','openingReplies'].some(key=>Object.prototype.hasOwnProperty.call(entry.data,key))) throw new Error('Legacy learner, replay or shared-model data is not allowed in the compact .chelo format.');
      if(!validateAdapter(entry.data.dl.bond,1)||!validateAdapter(entry.data.dl.arena,2)) throw new Error('A .chelo Bond/Arena adapter is malformed.');
      ids.add(entry.id);
      const petBytes = byteLength(entry.data);
      const petLimit = doc.plan === 'pro' ? PRO_PET_BYTES : FREE_PET_BYTES;
      if (petBytes > petLimit) throw new Error(`Pet ${entry.data.i[0] || entry.id} uses ${petBytes} bytes; the ${doc.plan} pet-data limit is ${petLimit}.`);
    }
    const payload = payloadOf(doc);
    const contentBytes = byteLength(payload);
    const serializedBytes = byteLength({...payload,crc32:doc.crc32||'00000000'});
    if (doc.plan === 'free' && serializedBytes > FREE_FILE_BYTES) throw new Error(`The complete Free .chelo file uses ${serializedBytes} bytes; the limit is ${FREE_FILE_BYTES}.`);
    if (doc.plan === 'pro' && serializedBytes > PRO_FILE_BYTES) throw new Error(`The complete Pro .chelo file uses ${serializedBytes} bytes; the limit is ${PRO_FILE_BYTES}.`);
    if (doc.crc32) {
      const actual = crc32(encoder.encode(JSON.stringify(payload)));
      if (actual !== doc.crc32) throw new Error('The .chelo checksum failed. The file may be damaged.');
    }
    return {bytes:contentBytes, petBytes:doc.pets.map(p => byteLength(p.data)), limit:doc.plan === 'pro' ? PRO_FILE_BYTES : FREE_FILE_BYTES};
  }

  function encode(input) {
    const doc = payloadOf(input);
    const stats = validate(doc, doc.plan);
    const checksum = crc32(encoder.encode(JSON.stringify(doc)));
    const output = JSON.stringify({...doc, crc32:checksum});
    const bytes = encoder.encode(output);
    const limit = doc.plan === 'pro' ? PRO_FILE_BYTES : FREE_FILE_BYTES;
    if (bytes.byteLength > limit) throw new Error(`The exported .chelo file uses ${bytes.byteLength} bytes; the limit is ${limit}.`);
    return {bytes, stats:{...stats,bytes:bytes.byteLength,checksum}};
  }

  function decode(input, expectedPlan) {
    let text,rawBytes;
    if (typeof input === 'string') { text = input; rawBytes=encoder.encode(input).byteLength; }
    else if (input instanceof Uint8Array) { rawBytes=input.byteLength; text = new TextDecoder('utf-8', {fatal:true}).decode(input); }
    else if (input instanceof ArrayBuffer) { rawBytes=input.byteLength; text = new TextDecoder('utf-8', {fatal:true}).decode(new Uint8Array(input)); }
    else if (ArrayBuffer.isView(input)) { rawBytes=input.byteLength; text = new TextDecoder('utf-8', {fatal:true}).decode(new Uint8Array(input.buffer,input.byteOffset,input.byteLength)); }
    else throw new Error('Unsupported .chelo input.');
    let doc;
    try { doc = JSON.parse(text); } catch { throw new Error('This is not a valid .chelo file.'); }
    const rawLimit=doc?.plan==='pro'?PRO_FILE_BYTES:FREE_FILE_BYTES;
    if(rawBytes>rawLimit)throw new Error(`The imported .chelo file is ${rawBytes} bytes; its limit is ${rawLimit}.`);
    validate(doc, expectedPlan || doc.plan);
    return doc;
  }

  class CheloLocalStore {
    constructor() { this.dbPromise = null; }
    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve,reject) => {
        if (!root.indexedDB) { reject(new Error('IndexedDB is unavailable.')); return; }
        const request = root.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('player')) db.createObjectStore('player');
          if (!db.objectStoreNames.contains(DB_PET_STORE)) db.createObjectStore(DB_PET_STORE,{keyPath:'id'});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open Chelo local storage.'));
        request.onblocked = () => reject(new Error('Chelo local storage is blocked by another tab.'));
      }).catch(error => { this.dbPromise = null; throw error; });
      return this.dbPromise;
    }
    async load() {
      const db = await this.open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction(['player',DB_PET_STORE],'readonly');
        const playerRequest = tx.objectStore('player').get(DB_PLAYER_KEY);
        const petsRequest = tx.objectStore(DB_PET_STORE).getAll();
        let player, pets;
        playerRequest.onsuccess = () => { player = playerRequest.result || null; };
        petsRequest.onsuccess = () => { pets = petsRequest.result || []; };
        tx.oncomplete = () => resolve({player:player?.data || null,pets:pets || []});
        tx.onerror = () => reject(tx.error || new Error('Could not read Chelo local storage.'));
        tx.onabort = () => reject(tx.error || new Error('Chelo local storage read was aborted.'));
      });
    }
    async savePlayer(data) {
      const db = await this.open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction('player','readwrite');
        tx.objectStore('player').put({data},DB_PLAYER_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Could not save Chelo player data.'));
      });
    }
    async savePet(id,data) {
      const db = await this.open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction(DB_PET_STORE,'readwrite');
        tx.objectStore(DB_PET_STORE).put({id,data});
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Could not save Chelo pet data.'));
      });
    }
    async replace(player,pets) {
      const db = await this.open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction(['player',DB_PET_STORE],'readwrite');
        const playerStore = tx.objectStore('player'), petStore = tx.objectStore(DB_PET_STORE);
        playerStore.put({data:player},DB_PLAYER_KEY);
        petStore.clear();
        for (const pet of pets) petStore.put({id:pet.id,data:pet.data});
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('Could not restore the complete .chelo save.'));
        tx.onabort = () => reject(tx.error || new Error('Chelo restore was aborted.'));
      });
    }
  }

  function measure(input){const payload=payloadOf(input);return {bytes:byteLength({...payload,crc32:'00000000'}),playerBytes:byteLength(payload.player||{}),petBytes:(payload.pets||[]).map(p=>byteLength(p.data)),plan:payload.plan};}
  root.CheloSave = {encode,decode,validate,measure,crc32,packMoves,unpackMoves,constants:{FREE_FILE_BYTES,FREE_PET_BYTES,PLAYER_META_BYTES,PRO_PET_BYTES,PRO_PET_COUNT,PRO_FILE_BYTES}};
  root.CheloLocalStore = CheloLocalStore;
})();
