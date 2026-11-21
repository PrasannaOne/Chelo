/*
 * Chelo V6 research engine: V5-derived piece-centric learning in plain JavaScript.
 *
 * Shared rules/search + individual learned value/policy weights + individual
 * episodic memories. Free and Pro use the SAME model shape, algorithms and
 * search budget. Pro only has a larger personal-memory budget.
 *
 * Model:
 *   64 squares x 12 relative piece planes + 16 position-state flags
 *   -> 48 tanh units -> zero-initialised residual refinement block
 *   -> W/D/L outcome head + shared legal-move policy-prior head
 *
 * The sparse input is stored as 80 compact integers (one piece code per square
 * plus 16 flags). The first layer expands those codes into active feature rows.
 * .chelo pet data uses per-channel Int4 for the expanded input trunk and policy
 * embeddings/interactions, with Int8 for WDL weights and biases. Runtime weights
 * are restored to JavaScript numbers for inference/training.
 *
 * This is a compact online-learning prototype, not a claim of grandmaster
 * strength. Only controlled benchmarks can establish playing-strength gains.
 */
(() => {
  'use strict';
  const FREE_LIMIT = 97 * 1024; // Per-pet Free budget inside the 100 KiB complete player .chelo.
  const PRO_LIMIT = 500 * 1024; // Per-pet Pro budget inside the single .chelo container.
  const SQUARES = 64;
  const PLANES = 12;
  const GLOBALS = 16;
  const FEATURES = SQUARES * PLANES + GLOBALS;
  const VECTOR_SIZE = SQUARES + GLOBALS;
  const LEGACY_HIDDEN = 16;
  const PREVIOUS_HIDDEN = 24;
  const V10_HIDDEN = 40;
  const HIDDEN = 48;
  const POLICY_RANK = 4;
  const TYPES = ['p','n','b','r','q','k'];
  const STORY_KIND_TO_CODE = {'battle-win':1,'tactical-win':2,'battle-loss':3,'tactical-lesson':4,'draw':5,'endurance-draw':6};
  const STORY_CODE_TO_KIND = Object.fromEntries(Object.entries(STORY_KIND_TO_CODE).map(([key,value])=>[value,key]));
  const TRAIT_KEYS = ['bold','curious','patient'];
  const TYPE_CODE = Object.fromEntries(TYPES.map((type,index)=>[type,index+1]));
  const PROMO_CODE = {q:1,r:2,b:3,n:4};
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
  const now = ()=>Date.now();
  const root = typeof window !== 'undefined' ? window : globalThis;
  const Core = ()=>root.ChessCore;
  const byteLength = value=>new TextEncoder().encode(JSON.stringify(value)).length;
  const fenKey = fen=>String(fen).trim().split(/\s+/).slice(0,4).join(' ');
  const sigmoid = value=>1/(1+Math.exp(-clamp(value,-12,12)));
  function hash32(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  // Memories use a compact 64-bit fingerprint, not repeated FEN strings.
  // A second independently seeded FNV stream makes accidental collisions negligible
  // for this bounded personal-memory table; full positions remain in the game log.
  function compactMemoryKey(value){
    const raw=String(value||'').trim();
    if(/^h[A-Za-z0-9+/]{11}=?$/.test(raw))return raw;
    const canonical=fenKey(raw);let hi=hash32('CHELO-MEM-A|'+canonical),lo=hash32('CHELO-MEM-B|'+canonical);
    const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);view.setUint32(0,hi,false);view.setUint32(4,lo,false);
    return 'h'+base64Encode(bytes);
  }


  // Standard Polyglot keys are supplied by polyglot-random.js as paired words.
  // Keeping the 64-bit values split avoids BigInt in the hot search path.
  const POLY_HI = root.CHESSLING_POLYGLOT_HI || new Uint32Array(781);
  const POLY_LO = root.CHESSLING_POLYGLOT_LO || new Uint32Array(781);
  const TT_SIZE = 1 << 18;
  const TT_EXACT = 1, TT_ALPHA = 2, TT_BETA = 3;
  const MATE_SCORE = 30000, SEARCH_INF = 32000;
  const POLY_PIECE = { p:1,n:2,b:3,r:4,q:5,k:6 };
  const PIECE_VALUE = { p:100,n:320,b:330,r:500,q:900,k:20000 };

  function xorPair(pair,index){pair.hi=(pair.hi^POLY_HI[index])>>>0;pair.lo=(pair.lo^POLY_LO[index])>>>0;}
  function square64From88(square){return ((7-(square>>4))*8)+(square&7);}
  function square88FromName(name){return (8-Number(name[1]))*16+(name.charCodeAt(0)-97);}
  function polyglotHash(chess){
    const s=chess.s,pair={hi:0,lo:0};
    for(let square=0;square<128;square++){
      if(square&0x88){square+=7;continue;}
      const piece=s.b[square];if(!piece)continue;
      const type=POLY_PIECE[piece.toLowerCase()],color=piece===piece.toUpperCase()?1:0;
      xorPair(pair,((type-1)*2+color)*64+square64From88(square));
    }
    if(s.c.includes('K'))xorPair(pair,768);
    if(s.c.includes('Q'))xorPair(pair,769);
    if(s.c.includes('k'))xorPair(pair,770);
    if(s.c.includes('q'))xorPair(pair,771);
    if(s.ep>=0){
      const pawnRank=s.ep+(s.t==='w'?16:-16),file=s.ep&7,a=pawnRank-1,b=pawnRank+1;
      if((file>0&&!(a&0x88)&&s.b[a]===(s.t==='w'?'P':'p'))||(file<7&&!(b&0x88)&&s.b[b]===(s.t==='w'?'P':'p')))xorPair(pair,772+file);
    }
    if(s.t==='w')xorPair(pair,780);
    return pair;
  }
  function comparePair(ahi,alo,bhi,blo){return ahi===bhi?(alo===blo?0:(alo>>>0)<(blo>>>0)?-1:1):(ahi>>>0)<(bhi>>>0)?-1:1;}
  function encodeSearchMove(uci){
    if(!uci||uci.length<4)return 0;
    const from=(8-Number(uci[1]))*8+uci.charCodeAt(0)-97,to=(8-Number(uci[3]))*8+uci.charCodeAt(2)-97;
    const promotion=uci[4]?({n:1,b:2,r:3,q:4}[uci[4]]||0):0;
    return ((from&63)<<6)|(to&63)|((promotion&7)<<12);
  }
  function decodeSearchMove(raw){
    if(!raw)return null;const from=(raw>>>6)&63,to=raw&63,promo=(raw>>>12)&7;
    const sq=n=>'abcdefgh'[n&7]+String(8-(n>>3));
    return sq(from)+sq(to)+(promo?({1:'n',2:'b',3:'r',4:'q'}[promo]||''):'');
  }
  class TypedTranspositionTable{
    constructor(size=TT_SIZE){this.size=size;this.mask=size-1;this.keyHi=new Uint32Array(size);this.keyLo=new Uint32Array(size);this.depth=new Int8Array(size);this.depth.fill(-1);this.flag=new Uint8Array(size);this.score=new Int16Array(size);this.bestMove=new Uint16Array(size);this.generation=new Uint8Array(size);this.age=1;this.hits=0;this.stores=0;}
    probe(key,depth,alpha,beta,ply){
      const i=key.lo&this.mask;if(this.depth[i]<0||this.keyHi[i]!==key.hi||this.keyLo[i]!==key.lo)return {hit:false,move:null};
      this.hits++;let score=this.score[i];if(score>MATE_SCORE-1000)score-=ply;else if(score< -MATE_SCORE+1000)score+=ply;
      const move=decodeSearchMove(this.bestMove[i]),d=this.depth[i],flag=this.flag[i];
      if(d>=depth&&((flag===TT_EXACT)||(flag===TT_ALPHA&&score<=alpha)||(flag===TT_BETA&&score>=beta)))return {hit:true,cutoff:true,score,move,depth:d,flag};
      return {hit:true,cutoff:false,score,move,depth:d,flag};
    }
    store(key,depth,score,flag,bestMove,ply){
      const i=key.lo&this.mask,oldMatches=this.depth[i]>=0&&this.keyHi[i]===key.hi&&this.keyLo[i]===key.lo;
      if(!oldMatches&&(this.depth[i]>depth)&&this.generation[i]===this.age)return;
      let packed=score;if(packed>MATE_SCORE-1000)packed+=ply;else if(packed< -MATE_SCORE+1000)packed-=ply;
      this.keyHi[i]=key.hi;this.keyLo[i]=key.lo;this.depth[i]=clamp(depth,-1,127);this.flag[i]=flag;this.score[i]=clamp(Math.round(packed),-32768,32767);this.bestMove[i]=encodeSearchMove(bestMove);this.generation[i]=this.age;this.stores++;
    }
    clear(){this.keyHi.fill(0);this.keyLo.fill(0);this.depth.fill(-1);this.flag.fill(0);this.score.fill(0);this.bestMove.fill(0);this.generation.fill(0);this.hits=0;this.stores=0;this.age=(this.age+1)&255||1;}
  }

  function polyglotBookLookup(binary,key,legalMoves){
    if(!(binary instanceof Uint8Array)||binary.length<16||binary.length%16)return null;
    const view=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),count=binary.length/16;
    let lo=0,hi=count;
    while(lo<hi){const mid=(lo+hi)>>>1,at=mid*16,khi=view.getUint32(at,false),klo=view.getUint32(at+4,false);if(comparePair(khi,klo,key.hi,key.lo)<0)lo=mid+1;else hi=mid;}
    let total=0;const matches=[];
    for(let i=lo;i<count;i++){
      const at=i*16;if(view.getUint32(at,false)!==key.hi||view.getUint32(at+4,false)!==key.lo)break;
      const raw=view.getUint16(at+8,false),weight=view.getUint16(at+10,false),uci=decodePolyglotMove(raw);
      if(uci&&legalMoves.some(m=>m.uci===uci)){matches.push({uci,weight});total+=weight;}
    }
    if(!matches.length)return null;
    let choice=Math.random()*Math.max(1,total);for(const item of matches){choice-=item.weight;if(choice<=0)return item.uci;}return matches[matches.length-1].uci;
  }
  function decodePolyglotMove(raw){
    const from=(raw>>>6)&63,to=raw&63,promo=(raw>>>12)&7;
    const name=n=>'abcdefgh'[n&7]+String(8-(n>>3));
    return name((7-(from>>3))*8+(from&7))+name((7-(to>>3))*8+(to&7))+(promo?({1:'n',2:'b',3:'r',4:'q'}[promo]||''):'');
  }

  function base64Encode(bytes){
    let out='';
    for(let i=0;i<bytes.length;i+=3){
      const a=bytes[i],hasB=i+1<bytes.length,hasC=i+2<bytes.length;
      const b=hasB?bytes[i+1]:0,c=hasC?bytes[i+2]:0;
      out+=BASE64[a>>2]+BASE64[((a&3)<<4)|(b>>4)]+(hasB?BASE64[((b&15)<<2)|(c>>6)]:'=')+(hasC?BASE64[c&63]:'=');
    }
    return out;
  }

  function base64Decode(text){
    const input=String(text||'').replace(/[^A-Za-z0-9+/=]/g,'');
    const out=[];
    for(let i=0;i<input.length;i+=4){
      const a=BASE64.indexOf(input[i]),b=BASE64.indexOf(input[i+1]);
      const c=input[i+2]==='='?-1:BASE64.indexOf(input[i+2]);
      const d=input[i+3]==='='?-1:BASE64.indexOf(input[i+3]);
      if(a<0||b<0)continue;
      out.push((a<<2)|(b>>4));
      if(c>=0)out.push(((b&15)<<4)|(c>>2));
      if(d>=0&&c>=0)out.push(((c&3)<<6)|d);
    }
    return new Uint8Array(out);
  }

  function packWeights(values){
    let max=0;for(const value of values)max=Math.max(max,Math.abs(Number(value)||0));
    const scale=max>0?max/127:1/127,bytes=new Uint8Array(values.length);
    for(let i=0;i<values.length;i++){
      const q=clamp(Math.round((Number(values[i])||0)/scale),-127,127);
      bytes[i]=q<0?q+256:q;
    }
    return [Number(scale.toPrecision(8)),base64Encode(bytes)];
  }

  function unpackWeights(packed,expectedLength){
    if(!Array.isArray(packed)||packed.length<2)return Array(expectedLength).fill(0);
    const scale=clamp(Number(packed[0])||1/127,1e-9,10),bytes=base64Decode(packed[1]);
    const result=Array(expectedLength).fill(0);
    for(let i=0;i<Math.min(expectedLength,bytes.length);i++){
      const q=bytes[i]>127?bytes[i]-256:bytes[i];result[i]=q*scale;
    }
    return result;
  }

  // Compact policy embeddings with signed 4-bit values. Each hidden channel
  // receives its own scale, preserving small but meaningful channel weights.
  // Value-trunk and WDL-head weights remain Int8 for conservative precision.
  function packInt4(values,channels=HIDDEN){
    const scales=Array(channels).fill(0),quantised=new Int8Array(values.length);
    for(let i=0;i<values.length;i++){
      const channel=i%channels;scales[channel]=Math.max(scales[channel],Math.abs(Number(values[i])||0));
    }
    for(let c=0;c<channels;c++)scales[c]=scales[c]>0?scales[c]/7:1/7;
    const bytes=new Uint8Array(Math.ceil(values.length/2));
    for(let i=0;i<values.length;i++){
      const scale=scales[i%channels],q=clamp(Math.round((Number(values[i])||0)/scale),-7,7);
      quantised[i]=q;
      const nibble=q<0?q+16:q,byteIndex=i>>1;
      if(i&1)bytes[byteIndex]|=nibble<<4;else bytes[byteIndex]=nibble;
    }
    return [scales.map(v=>Number(v.toPrecision(8))),base64Encode(bytes),values.length];
  }

  function unpackInt4(packed,expectedLength,channels=HIDDEN){
    if(!Array.isArray(packed)||packed.length<2)return Array(expectedLength).fill(0);
    const scales=Array.isArray(packed[0])?packed[0]:Array(channels).fill(1/7),bytes=base64Decode(packed[1]);
    const count=Math.min(expectedLength,Number(packed[2])||expectedLength),result=Array(expectedLength).fill(0);
    for(let i=0;i<count;i++){
      const byte=bytes[i>>1]||0,nibble=(i&1)?byte>>4:byte&15,q=nibble>=8?nibble-16:nibble;
      const scale=clamp(Number(scales[i%channels])||1/7,1e-9,10);result[i]=q*scale;
    }
    return result;
  }

  // Legacy V13 saves store canonical FEN position keys as packed 4-bit piece codes
  // plus side/castling/en-passant metadata. This reduces repeated board text
  // while keeping a reversible, human-independent representation.
  const PIECE_TO_NIBBLE={p:1,n:2,b:3,r:4,q:5,k:6,P:7,N:8,B:9,R:10,Q:11,K:12};
  const NIBBLE_TO_PIECE=['','p','n','b','r','q','k','P','N','B','R','Q','K'];
  function packPositionKey(value){
    const raw=fenKey(value),parts=raw.split(' ');if(parts.length<4)return raw;
    const ranks=parts[0].split('/');if(ranks.length!==8)return raw;
    const bytes=new Uint8Array(34),board=[];
    for(const rank of ranks){let file=0;for(const token of rank){if(/[1-8]/.test(token)){const count=Number(token);file+=count;for(let empty=0;empty<count;empty++)board.push(0);}else{if(!(token in PIECE_TO_NIBBLE)||file>=8)return raw;board.push(PIECE_TO_NIBBLE[token]);file++;}}if(file!==8)return raw;}
    if(board.length!==64||!['w','b'].includes(parts[1]))return raw;
    for(let i=0;i<64;i++){const at=i>>1,code=board[i];if(i&1)bytes[at]|=code<<4;else bytes[at]=code;}
    const rights=parts[2]==='-'?'':parts[2];let flags=0;for(const [char,bit] of [['K',1],['Q',2],['k',4],['q',8]])if(rights.includes(char))flags|=bit;
    bytes[32]=(parts[1]==='b'?1:0)|(flags<<1);
    const ep=parts[3];bytes[33]=/^[a-h][36]$/.test(ep)?(8-Number(ep[1]))*8+ep.charCodeAt(0)-97:255;
    return '~'+base64Encode(bytes);
  }
  function unpackPositionKey(value){
    const raw=String(value||'');if(!raw.startsWith('~'))return raw;
    const bytes=base64Decode(raw.slice(1));if(bytes.length!==34)return raw;
    const ranks=[];for(let rank=0;rank<8;rank++){let row='',empty=0;for(let file=0;file<8;file++){const i=rank*8+file,byte=bytes[i>>1]||0,code=(i&1)?byte>>4:byte&15,piece=NIBBLE_TO_PIECE[code]||'';if(!piece)empty++;else{if(empty){row+=empty;empty=0;}row+=piece;}}if(empty)row+=empty;ranks.push(row);}
    const meta=bytes[32]||0,rightsBits=meta>>1,rights=[['K',1],['Q',2],['k',4],['q',8]].filter(([,bit])=>rightsBits&bit).map(([char])=>char).join('')||'-',epIndex=bytes[33],ep=epIndex===255||epIndex>63?'-':`abcdefgh`[epIndex%8]+String(8-Math.floor(epIndex/8));
    return `${ranks.join('/')} ${(meta&1)?'b':'w'} ${rights} ${ep}`;
  }

  // V14 per-pet LoRA adapter: rank-8 delta on the 48x48 residual projection.
  // Wire format: uint16 little-endian payload byte length, two Float32 scales,
  // then signed Int4 A/B values (low nibble first). Length is read dynamically.
  const V14_RANK=8;
  function freshV14Adapter(){const A=new Float32Array(HIDDEN*V14_RANK);for(let i=0;i<A.length;i++)A[i]=Math.sin((i+1)*12.9898)*0.001;return {version:14,rank:V14_RANK,scale:1/V14_RANK,A,B:new Float32Array(V14_RANK*HIDDEN),steps:0};}
  function packV14Adapter(adapter){
    const count=adapter.A.length+adapter.B.length,bytes=new Uint8Array(2+12+Math.ceil(count/2));
    let peakA=0,peakB=0;for(const v of adapter.A)peakA=Math.max(peakA,Math.abs(v));for(const v of adapter.B)peakB=Math.max(peakB,Math.abs(v));const scaleA=peakA?peakA/7:1e-7,scaleB=peakB?peakB/7:1e-7;
    const payloadLength=bytes.length-2;bytes[0]=payloadLength&255;bytes[1]=(payloadLength>>>8)&255;
    const scales=new DataView(bytes.buffer);scales.setFloat32(2,scaleA,true);scales.setFloat32(6,scaleB,true);scales.setUint32(10,Math.max(0,adapter.steps|0),true);
    let at=14;for(let i=0;i<count;i++){const value=i<adapter.A.length?adapter.A[i]:adapter.B[i-adapter.A.length],scale=i<adapter.A.length?scaleA:scaleB,q=clamp(Math.round(value/scale),-7,7),n=q<0?q+16:q,idx=at+(i>>1);if(i&1)bytes[idx]|=n<<4;else bytes[idx]=n;}
    let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary);
  }
  function unpackV14Adapter(encoded){
    if(!encoded)return freshV14Adapter();let binary=atob(encoded),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(bytes.length<14)throw new Error('V14 adapter header is truncated.');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),payload=view.getUint16(0,true);
    if(payload!==bytes.length-2||payload<8)throw new Error('V14 adapter byte-length header mismatch.');
    const expected=Math.ceil((HIDDEN*V14_RANK+V14_RANK*HIDDEN)/2);if(payload-12!==expected)throw new Error('V14 adapter tensor length mismatch.');
    const adapter=freshV14Adapter();adapter.scaleA=view.getFloat32(2,true);adapter.scaleB=view.getFloat32(6,true);adapter.steps=view.getUint32(10,true);if(!(adapter.scaleA>0&&adapter.scaleB>0))throw new Error('Invalid V14 adapter scales.');
    const count=adapter.A.length+adapter.B.length;for(let i=0;i<count;i++){const b=bytes[14+(i>>1)],n=(i&1)?b>>4:b&15,q=n>=8?n-16:n,v=q*(i<adapter.A.length?adapter.scaleA:adapter.scaleB);if(i<adapter.A.length)adapter.A[i]=v;else adapter.B[i-adapter.A.length]=v;}
    return adapter;
  }

  // Stage 3.6 dual-perspective adapters are compact rank-1 Bond and rank-2
  // Arena bias deltas. Both adapters are packed together in the single player .chelo file.
  function freshDualAdapter(rank){return {rank,shift:8,aW:new Int8Array(32*rank),aB:new Int8Array(32*rank),b:new Int8Array(rank),steps:0};}
  function packDualAdapter(adapter){
    const rank=adapter?.rank===2?2:1,shift=clamp(adapter?.shift|0,0,14),aW=adapter?.aW||new Int8Array(32*rank),aB=adapter?.aB||new Int8Array(32*rank),b=adapter?.b||new Int8Array(rank);
    if(aW.length!==32*rank||aB.length!==32*rank||b.length!==rank)throw new Error('Dual LoRA adapter tensor shape mismatch.');
    const bytes=new Uint8Array(4+64*rank+rank),view=new DataView(bytes.buffer);bytes[0]=rank;bytes[1]=shift;view.setUint16(2,Math.max(0,adapter?.steps|0)&65535,true);let at=4;
    for(let i=0;i<aW.length;i++)bytes[at++]=aW[i]&255;for(let i=0;i<aB.length;i++)bytes[at++]=aB[i]&255;for(let i=0;i<b.length;i++)bytes[at++]=b[i]&255;
    return base64Encode(bytes);
  }
  function unpackDualAdapter(encoded,expectedRank){
    if(!encoded)return freshDualAdapter(expectedRank);const bytes=base64Decode(encoded);if(bytes.length<5)throw new Error('Dual LoRA adapter is truncated.');
    const rank=bytes[0],shift=bytes[1],expected=4+65*rank;if((rank!==1&&rank!==2)||rank!==expectedRank||shift>14||bytes.length!==expected)throw new Error('Dual LoRA adapter header/shape mismatch.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),adapter=freshDualAdapter(rank);adapter.shift=shift;adapter.steps=view.getUint16(2,true);let at=4;
    for(let i=0;i<adapter.aW.length;i++)adapter.aW[i]=bytes[at++]>127?bytes[at-1]-256:bytes[at-1];
    for(let i=0;i<adapter.aB.length;i++)adapter.aB[i]=bytes[at++]>127?bytes[at-1]-256:bytes[at-1];
    for(let i=0;i<adapter.b.length;i++)adapter.b[i]=bytes[at++]>127?bytes[at-1]-256:bytes[at-1];
    return adapter;
  }
  function freshDualLora(){return {bond:freshDualAdapter(1),arena:freshDualAdapter(2)};}
  function normaliseDualLora(value){
    const source=value&&typeof value==='object'?value:{};
    const normalise=(item,rank)=>typeof item==='string'?unpackDualAdapter(item,rank):(()=>{const out=freshDualAdapter(rank),x=item&&typeof item==='object'?item:{};out.shift=clamp(Number(x.shift)|0,0,14);out.steps=Math.max(0,Number(x.steps)|0);for(const [key,length] of [['aW',32*rank],['aB',32*rank],['b',rank]]){const values=x[key];if(values&&values.length===length)for(let i=0;i<length;i++)out[key][i]=clamp(Number(values[i])|0,-128,127);}return out;})();
    return {bond:normalise(source.bond,1),arena:normalise(source.arena,2)};
  }
  function packDualLora(value){const source=normaliseDualLora(value);return {bond:packDualAdapter(source.bond),arena:packDualAdapter(source.arena)};}
  function unpackDualLora(value){const source=value&&typeof value==='object'?value:{};return {bond:unpackDualAdapter(source.bond,1),arena:unpackDualAdapter(source.arena,2)};}

  function createModel(seed=1){
    let state=(Number(seed)>>>0)||1;
    const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296*2-1;};
    return {
      w1:Array.from({length:FEATURES*HIDDEN},()=>Number((random()*0.025).toFixed(7))),
      b1:Array(HIDDEN).fill(0),
      // A zero-initialised residual refinement block adds representational
      // capacity without changing any imported V11/V12 prediction at birth.
      w2:Array(HIDDEN*HIDDEN).fill(0),b2:Array(HIDDEN).fill(0),
      // Small random output weights avoid a dead-zero TD signal on neutral
      // self-play while keeping a fresh model's values centred near zero.
      // Three-class outcome head: win, draw, loss. A softmax output gives
      // calibrated-class candidates; search consumes P(win)-P(loss).
      wOut:Array.from({length:3*HIDDEN},()=>Number((random()*0.018).toFixed(7))),
      bOut:[0,0,0],
      pFrom:Array.from({length:64*HIDDEN},()=>Number((random()*0.012).toFixed(7))),
      pTo:Array.from({length:64*HIDDEN},()=>Number((random()*0.012).toFixed(7))),
      pPiece:Array.from({length:6*HIDDEN},()=>Number((random()*0.012).toFixed(7))),
      pPromo:Array.from({length:5*HIDDEN},()=>Number((random()*0.012).toFixed(7))),
      // Low-rank source/destination interaction lets move preference depend on
      // the ordered from→to pair while keeping the policy head compact.
      pFromRank:Array.from({length:64*POLICY_RANK},()=>Number((random()*0.12).toFixed(7))),
      pToRank:Array.from({length:64*POLICY_RANK},()=>Number((random()*0.12).toFixed(7))),
      pStateRank:Array.from({length:HIDDEN*POLICY_RANK},()=>Number((random()*0.12).toFixed(7))),
      pFromBias:Array(64).fill(0),pToBias:Array(64).fill(0),pPieceBias:Array(6).fill(0),pPromoBias:Array(5).fill(0),
      steps:0,policySteps:0,episodes:0,loss:0,lastDelta:0,wdlLoss:0
    };
  }

  function squareIndex(square,side='w'){
    if(typeof square!=='string'||!/^[a-h][1-8]$/.test(square))return -1;
    let file=square.charCodeAt(0)-97,rank=8-Number(square[1]);
    if(side==='b'){file=7-file;rank=7-rank;}
    return rank*8+file;
  }

  function moveDescriptor(x,move,side='w'){
    const uci=typeof move==='string'?move:move?.uci||`${move?.from||''}${move?.to||''}${move?.promotion||''}`;
    if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci))return null;
    const from=squareIndex(uci.slice(0,2),side),to=squareIndex(uci.slice(2,4),side);
    const code=Number(x[from])||0;
    return {from,to,piece:code?((code-1)%6):0,promo:PROMO_CODE[uci[4]]||0};
  }

  class CheloBrain {
    constructor(storageKey='chelo_pet_1',options={}){
      this.storageKey=storageKey;this.persist=options.persist!==false;this.onSave=typeof options.onSave==='function'?options.onSave:null;this.policyLearning=options.policyLearning!==false;this.v14Mode=options.v14Mode===true;
      const entitlement=options.plan||(root.CHELO_ENTITLEMENT||root.CHESSLING_ENTITLEMENT)?.plan;
      this.plan=entitlement==='pro'?'pro':'free';
      this.limit=this.plan==='pro'?PRO_LIMIT:FREE_LIMIT;
      this.data=options.data?this.normalise(this.expandData(options.data)):this.load();
      // V14 always receives its immutable shared Float32 base from the app/worker
      // asset loader. Pet data and legacy saves may contain older model arrays;
      // they are never allowed to replace this checkpoint.
      if(options.v14Mode===true){
        const base=options.baseModel;
        const expected={w1:FEATURES*HIDDEN,b1:HIDDEN,w2:HIDDEN*HIDDEN,b2:HIDDEN,wOut:3*HIDDEN,bOut:3,pFrom:64*HIDDEN,pTo:64*HIDDEN,pPiece:6*HIDDEN,pPromo:5*HIDDEN,pFromRank:64*POLICY_RANK,pToRank:64*POLICY_RANK,pStateRank:HIDDEN*POLICY_RANK,pFromBias:64,pToBias:64,pPieceBias:6,pPromoBias:5};
        if(!base||Object.entries(expected).some(([key,length])=>!Array.isArray(base[key])||base[key].length!==length))throw new Error('The V14 frozen Float32 base is missing or has an incompatible tensor shape.');
        for(const [key] of Object.entries(expected))this.data.model[key]=Array.from(new Float32Array(base[key]));
        this.data.v14BaseVersion=options.baseVersion||'v13-f32-policy-2026-11-19-seed-20261119';
      }
      // The previous per-pet V14 adapter is retired. The shared V37 base plus
      // compact Bond/Arena adapters are the only portable learning path.
      this.v14Adapter=freshV14Adapter();
      // The benchmark harness can provide a deterministic seed for reproducible
      // fresh-checkpoint comparisons. Normal browser saves are never reseeded.
      if(!options.data&&options.persist===false&&options.seed!==undefined){
        this.data.model=createModel(options.seed);
      }
      this.lastSearch=null;
      // A Pro pet opened under a Free entitlement is reduced before use. This
      // enforces the active plan cap immediately, not only after the next move.
      if(this.size()>this.limit){
        this.pruneToBudget();
        if(this.size()>this.limit)throw new Error(`This pet's saved brain cannot fit the current ${this.limit/1024} KiB plan limit.`);
        if(this.persist)this.save();
      }
    }

    defaults(){
      const stamp=now();
      return {
        schema:16,petName:'Chelo',handle:'',trainerName:'',gen:1,xp:0,
        // Internal adaptive challenge estimate. This is not a certified chess Elo
        // and is kept separate from Mastery and Arena rank.
        elo:100,trainerWinStreak:0,ratingGames:0,
        wins:0,losses:0,draws:0,games:0,
        weights:{},policy:{},traits:{bold:50,curious:50,patient:50},memories:[],
        model:createModel(stamp),v14Adapter:null,dualLora:freshDualLora(),replay:[],memory:{},humanOpenings:{},openingReplies:{},pending:[],
        geneticTrace:{p:0,n:0,b:0,r:0,q:0},lastHumanMove:null,
        mastery:{tier:'Unbenchmarked',games:0,score:null},createdAt:stamp,updatedAt:stamp
      };
    }

    normalise(source){
      const base=this.defaults(),old=source&&typeof source==='object'?source:{};
      const data={...base,...old,schema:16};
      // Earlier V6 builds gave every untouched hatchling an arbitrary 300
      // challenge estimate. Move only never-calibrated pets to the gentler baseline.
      if((Number(old.ratingGames)||0)===0&&Number(old.elo)===300)data.elo=100;
      data.weights={};data.policy={};data.v14Adapter=null;delete data.practiceGames;data.dualLora=normaliseDualLora(old.dualLora);
      data.xp=Math.max(0,Math.floor(Number(old.xp)||0));
      data.traits={...base.traits,...(old.traits||{})};
      for(const key of Object.keys(data.traits)){const value=Number(data.traits[key]);data.traits[key]=clamp(Number.isFinite(value)?value:50,0,100);}
      data.memories=(Array.isArray(old.memories)?old.memories:[]).filter(item=>item&&STORY_KIND_TO_CODE[item.kind]).slice(-12).map(item=>({kind:item.kind,day:Math.max(0,Math.floor(Number(item.day)||0)),plies:clamp(Math.floor(Number(item.plies)||0),0,600),tactical:clamp(Math.floor(Number(item.tactical)||0),0,40),trait:TRAIT_KEYS.includes(item.trait)?item.trait:'curious'}));
      const oldMemory=old.memory&&typeof old.memory==='object'?old.memory:{};
      data.memory={};
      for(const [position,moves] of Object.entries(oldMemory)){
        const key=compactMemoryKey(position);data.memory[key]||={};
        for(const [move,value] of Object.entries(moves||{})){
          if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))continue;
          const prior=data.memory[key][move]||{};data.memory[key][move]={score:clamp(Number(value?.score)||0,-100,100),visits:Math.max(0,Number(value?.visits)||0),mirror:Math.max(0,Number(value?.mirror)||0),outcomes:Math.max(0,Number(value?.outcomes)||0),last:Math.max(0,Number(value?.last)||0),tactical:Math.max(0,Number(value?.tactical)||0),...prior};
        }
      }
      // Opening tables and replay buffers belonged to the retired V14 learner.
      // The V16 save keeps only compact episodic outcomes plus Bond/Arena adapters.
      data.humanOpenings={};data.openingReplies={};data.replay=[];
      data.pending=Array.isArray(old.pending)?old.pending.filter(item=>item&&typeof item.f==='string'&&typeof item.m==='string').map(item=>({f:item.f.startsWith('h')?item.f:`${fenKey(item.f)} 0 1`,k:compactMemoryKey(item.k||item.f),m:item.m,r:!!item.r,ply:Math.max(0,Number(item.ply)||0),side:item.side==='b'?'b':'w',at:Number(item.at)||0,pred:Number(item.pred)||0})):[];
      data.geneticTrace={...base.geneticTrace,...(old.geneticTrace||{})};
      data.mastery={...base.mastery,...(old.mastery||{})};
      const model=old.model&&typeof old.model==='object'?old.model:null;
      const isCurrent=model&&Array.isArray(model.w1)&&model.w1.length===FEATURES*HIDDEN&&Array.isArray(model.wOut)&&model.wOut.length===3*HIDDEN&&Array.isArray(model.w2)&&model.w2.length===HIDDEN*HIDDEN;
      const isPrevious48=model&&Array.isArray(model.w1)&&model.w1.length===FEATURES*HIDDEN&&Array.isArray(model.wOut)&&model.wOut.length===3*HIDDEN&&!Array.isArray(model.w2);
      const isPrevious40=model&&Array.isArray(model.w1)&&model.w1.length===FEATURES*V10_HIDDEN&&Array.isArray(model.wOut)&&model.wOut.length===3*V10_HIDDEN;
      const isPrevious24=model&&Array.isArray(model.w1)&&model.w1.length===FEATURES*PREVIOUS_HIDDEN&&Array.isArray(model.wOut)&&model.wOut.length===3*PREVIOUS_HIDDEN;
      const isLegacy=model&&Array.isArray(model.w1)&&model.w1.length===FEATURES*LEGACY_HIDDEN&&Array.isArray(model.w2)&&model.w2.length===LEGACY_HIDDEN;
      if(isCurrent||isPrevious48||isPrevious40||isPrevious24){
        const sourceHidden=(isCurrent||isPrevious48)?HIDDEN:(isPrevious40?V10_HIDDEN:PREVIOUS_HIDDEN), fresh=base.model;
        const copyRows=(target,source,rows,fromWidth,toWidth)=>{for(let row=0;row<rows;row++)for(let h=0;h<Math.min(fromWidth,toWidth);h++)target[row*toWidth+h]=clamp(Number(source?.[row*fromWidth+h])||0,-3,3);};
        copyRows(fresh.w1,model.w1,FEATURES,sourceHidden,HIDDEN);
        if(Array.isArray(model.w2)&&model.w2.length===HIDDEN*HIDDEN)copyRows(fresh.w2,model.w2,HIDDEN,HIDDEN,HIDDEN);
        for(let h=0;h<HIDDEN;h++)fresh.b2[h]=clamp(Number(model.b2?.[h])||0,-3,3);
        copyRows(fresh.wOut,model.wOut,3,sourceHidden,HIDDEN);
        copyRows(fresh.pFrom,model.pFrom,64,sourceHidden,HIDDEN);
        copyRows(fresh.pTo,model.pTo,64,sourceHidden,HIDDEN);
        copyRows(fresh.pPiece,model.pPiece,6,sourceHidden,HIDDEN);
        copyRows(fresh.pPromo,model.pPromo,5,sourceHidden,HIDDEN);
        for(let h=0;h<Math.min(sourceHidden,HIDDEN);h++)fresh.b1[h]=clamp(Number(model.b1?.[h])||0,-3,3);
        for(let c=0;c<3;c++)fresh.bOut[c]=clamp(Number(model.bOut?.[c])||0,-3,3);
        for(let r=0;r<POLICY_RANK;r++)for(let h=0;h<Math.min(sourceHidden,HIDDEN);h++)fresh.pStateRank[h*POLICY_RANK+r]=clamp(Number(model.pStateRank?.[h*POLICY_RANK+r]??fresh.pStateRank[h*POLICY_RANK+r])||0,-3,3);
        for(const key of ['pFromRank','pToRank','pFromBias','pToBias','pPieceBias','pPromoBias'])fresh[key]=Array.from({length:fresh[key].length},(_,i)=>clamp(Number(model[key]?.[i]??fresh[key][i])||0,-3,3));
        fresh.steps=Math.max(0,Math.floor(Number(model.steps)||0));fresh.policySteps=Math.max(0,Math.floor(Number(model.policySteps)||0));fresh.episodes=Math.max(0,Math.floor(Number(model.episodes)||0));fresh.loss=clamp(Number(model.loss)||0,0,2);fresh.lastDelta=clamp(Number(model.lastDelta)||0,-2,2);fresh.wdlLoss=clamp(Number(model.wdlLoss)||0,0,5);
        data.model=fresh;
      }else if(isLegacy){
        // V5 16-wide scalar value model migrates into the first 16 channels of
        // the 48-wide trunk. Its scalar preference initializes opposing W/L
        // logits; the new draw class starts neutral. No prior strength is claimed.
        const fresh=base.model;
        for(let row=0;row<FEATURES;row++)for(let h=0;h<LEGACY_HIDDEN;h++)fresh.w1[row*HIDDEN+h]=clamp(Number(model.w1[row*LEGACY_HIDDEN+h])||0,-3,3);
        for(let h=0;h<LEGACY_HIDDEN;h++){
          fresh.b1[h]=clamp(Number(model.b1?.[h])||0,-3,3);
          const oldOut=clamp(Number(model.w2[h])||0,-3,3);
          fresh.wOut[h]=oldOut*0.5;fresh.wOut[HIDDEN+h]=0;fresh.wOut[2*HIDDEN+h]=-oldOut*0.5;
          for(let sq=0;sq<64;sq++){
            fresh.pFrom[sq*HIDDEN+h]=Number(model.pFrom?.[sq*LEGACY_HIDDEN+h])||0;
            fresh.pTo[sq*HIDDEN+h]=Number(model.pTo?.[sq*LEGACY_HIDDEN+h])||0;
          }
          for(let t=0;t<6;t++)fresh.pPiece[t*HIDDEN+h]=Number(model.pPiece?.[t*LEGACY_HIDDEN+h])||0;
          for(let t=0;t<5;t++)fresh.pPromo[t*HIDDEN+h]=Number(model.pPromo?.[t*LEGACY_HIDDEN+h])||0;
        }
        const oldBias=Number(model.b2)||0;fresh.bOut=[oldBias*0.5,0,-oldBias*0.5];
        for(const key of ['pFromBias','pToBias','pPieceBias','pPromoBias'])fresh[key]=Array.from({length:fresh[key].length},(_,i)=>Number(model[key]?.[i])||0);
        fresh.steps=Math.max(0,Number(model.steps)||0);fresh.policySteps=Math.max(0,Number(model.policySteps)||0);fresh.episodes=Math.max(0,Number(model.episodes)||0);fresh.loss=Number(model.loss)||0;fresh.lastDelta=Number(model.lastDelta)||0;
        data.model=fresh;
      }else{
        // V2/V3/V4 dimensions are incompatible. Preserve identity and episodic memories.
        data.model=base.model;data.replay=[];data.pending=data.pending.filter(item=>item.f&&item.m).map(item=>({...item,x:null}));
      }
      data.elo=clamp(Number.isFinite(Number(data.elo))?Math.round(Number(data.elo)):300,100,2400);
      data.trainerWinStreak=clamp(Math.floor(Number(data.trainerWinStreak)||0),0,1000);
      data.ratingGames=Math.max(0,Math.floor(Number(data.ratingGames)||0));
      for(const field of ['wins','losses','draws','games','gen'])data[field]=Math.max(0,Math.floor(Number(data[field])||(field==='gen'?1:0)));
      return data;
    }

    load(){
      if(!this.persist)return this.defaults();
      try{const raw=localStorage.getItem(this.storageKey);if(!raw)return this.defaults();const parsed=JSON.parse(raw);return parsed&&typeof parsed==='object'?this.normalise(this.expandData(parsed)):this.defaults();}
      catch(error){console.warn('Chelo started a fresh brain because its save could not be read.',error);return this.defaults();}
    }

    compactData(data=this.data){
      // V16 stores only identity/progression, compact memories and the two
      // C++-consumed adapters. Shared neural weights and retired V14 tensors
      // are hosted once and never copied into a pet save.
      const memoryRows=Object.entries(data.memory||{}).map(([position,moves])=>[
        compactMemoryKey(position),Object.entries(moves||{}).map(([move,value])=>[
          encodeSearchMove(move),clamp(Math.round(Number(value.score)||0),-100,100),
          clamp(Math.round(Number(value.visits)||0),0,65535),clamp(Math.round(Number(value.mirror)||0),0,255),
          clamp(Math.round(Number(value.outcomes)||0),0,255),Math.floor((Number(value.last)||0)/86400000),
          clamp(Math.round(Number(value.tactical)||0),0,255)
        ])
      ]);
      const memoryLookup=new Map();
      memoryRows.forEach(([position,moves],positionIndex)=>moves.forEach((item,moveIndex)=>memoryLookup.set(`${position}\u0000${decodeSearchMove(item[0])}`,[positionIndex,moveIndex])));
      const pendingRows=(data.pending||[]).map(item=>{
        const position=compactMemoryKey(item.k||item.f),pair=memoryLookup.get(`${position}\u0000${item.m}`);
        return pair?[pair[0],pair[1],item.r?1:0,item.ply,item.side==='b'?1:0,Math.floor((Number(item.at)||0)/86400000),Number((Number(item.pred)||0).toFixed(3)),packPositionKey(item.f)]
          :[-1,-1,item.r?1:0,item.ply,item.side==='b'?1:0,Math.floor((Number(item.at)||0)/86400000),Number((Number(item.pred)||0).toFixed(3)),packPositionKey(item.f),encodeSearchMove(item.m),position];
      });
      return {
        v:16,
        i:[data.petName,data.handle,Number(data.gen)||1,Number(data.wins)||0,Number(data.losses)||0,Number(data.draws)||0,Number(data.games)||0,Number(data.xp)||0],
        t:['bold','curious','patient'].map(key=>Math.round(Number(data.traits?.[key])||0)),
        dl:packDualLora(data.dualLora),m:memoryRows,u:pendingRows,
        e:(Array.isArray(data.memories)?data.memories:[]).slice(-12).map(item=>[STORY_KIND_TO_CODE[item.kind]||0,Math.max(0,Math.floor(Number(item.day)||0)),clamp(Math.floor(Number(item.plies)||0),0,600),clamp(Math.floor(Number(item.tactical)||0),0,40),Math.max(0,TRAIT_KEYS.indexOf(item.trait))]).filter(item=>item[0]),
        y:[data.mastery?.tier||'Unbenchmarked',Number(data.mastery?.games)||0,data.mastery?.score==null?null:Number(data.mastery.score),clamp(Math.round(Number(data.elo)||100),100,2400),Math.max(0,Math.floor(Number(data.trainerWinStreak)||0)),Math.max(0,Math.floor(Number(data.ratingGames)||0))],
        c:Number(data.createdAt)||0,vv:Number(data.updatedAt)||0
      };
    }

    expandData(source){
      if(source&&source.v===16&&Array.isArray(source.i)){
        const memory=Object.fromEntries((source.m||[]).map(row=>[
          compactMemoryKey(row?.[0]),Object.fromEntries((row?.[1]||[]).map(item=>[
            decodeSearchMove(item[0]),{score:item[1]||0,visits:item[2]||0,mirror:item[3]||0,outcomes:item[4]||0,last:(item[5]||0)*86400000,tactical:item[6]||0}
          ]))
        ]));
        const pending=(source.u||[]).map(item=>{
          const row=item[0]>=0?source.m?.[item[0]]:null,moveRow=row?.[1]?.[item[1]],position=compactMemoryKey(row?.[0]||item[9]||'');
          const packedFen=item[7]||'';
          const fen=packedFen?`${unpackPositionKey(packedFen)} 0 1`:unpackPositionKey(row?.[0]||'');
          return {f:fen,k:position,m:moveRow?decodeSearchMove(moveRow[0]):decodeSearchMove(item[8]||0),r:!!item[2],ply:item[3]||0,side:item[4]?'b':'w',at:(item[5]||0)*86400000,pred:Number(item[6])||0};
        });
        const oldV16Identity=source.i.length>=10,hasPracticeCounter=source.i.length===9;
        const genIndex=oldV16Identity?3:2,winsIndex=genIndex+1,lossesIndex=genIndex+2,drawsIndex=genIndex+3,gamesIndex=genIndex+4,xpIndex=oldV16Identity?9:hasPracticeCounter?8:7;
        return {schema:16,petName:source.i[0]||'Chelo',handle:source.i[1]||'',trainerName:oldV16Identity?(source.i[2]||''):'',gen:source.i[genIndex]||1,
          wins:source.i[winsIndex]||0,losses:source.i[lossesIndex]||0,draws:source.i[drawsIndex]||0,games:source.i[gamesIndex]||0,xp:source.i[xpIndex]||0,
          traits:{bold:source.t?.[0]??50,curious:source.t?.[1]??50,patient:source.t?.[2]??50},memory,pending,replay:[],humanOpenings:{},openingReplies:{},
          memories:(source.e||[]).map(row=>({kind:STORY_CODE_TO_KIND[row?.[0]],day:Math.max(0,Number(row?.[1])||0),plies:Math.max(0,Number(row?.[2])||0),tactical:Math.max(0,Number(row?.[3])||0),trait:TRAIT_KEYS[Number(row?.[4])||0]||'bold'})).filter(item=>item.kind).slice(-12),
          dualLora:source.dl?unpackDualLora(source.dl):freshDualLora(),mastery:source.y?{tier:source.y[0],games:source.y[1],score:source.y[2]}:undefined,
          elo:clamp(Math.round(Number(source.y?.[3])||300),100,2400),trainerWinStreak:Math.max(0,Number(source.y?.[4])||0),ratingGames:Math.max(0,Number(source.y?.[5])||0),
          createdAt:source.c||now(),updatedAt:source.vv||now(),v14Adapter:null,geneticTrace:{p:0,n:0,b:0,r:0,q:0},lastHumanMove:null};
      }
      if(!source||!Array.isArray(source.i)||![3,4,5,6,7,8,9,10,11,12,13,14,15].includes(source.v))return source;
      const i=source.i;
      const unpackMap=(rows,kind)=>Object.fromEntries((Array.isArray(rows)?rows:[]).map(row=>{
        const entries=Array.isArray(row?.[1])?row[1]:[];
        return [unpackPositionKey(row?.[0]),Object.fromEntries(entries.map(item=>kind==='memory'?[item[0],{score:item[1],visits:item[2],mirror:item[3],outcomes:item[4],last:item[5],tactical:Number(item[6])||0}]:kind==='opening'?[item[0],{count:item[1],last:item[2]}]:[item[0],{count:item[1],score:item[2],last:item[3]}]))];
      }));
      const isV5=source.v===5,isV6=source.v===6,isV7=source.v===7,isV8=source.v===8,isV9=source.v===9,isV10=source.v===10,isV11=source.v===11,isV12=source.v===12,isV13=source.v===13,isV14=source.v===14||source.v===15,isCurrent=isV5||isV6||isV7||isV8||isV9||isV10||isV11||isV12||isV13||isV14;
      const humanRows=isCurrent?source.o:source.h;
      const replyRows=isV6||isV7||isV8||isV9||isV10||isV11||isV12||isV13||isV14?[]:(isV5?source.q:source.o);
      const pendingRows=isCurrent?source.u:source.q;
      const pending=(Array.isArray(pendingRows)?pendingRows:[]).map(item=>{
        if(isV6||isV7||isV8||isV9||isV10||isV11||isV12||isV13||isV14){const [pi,mi,resolved,ply,side,at,pred,fallbackFen,fallbackMove]=item;const row=pi>=0?source.m?.[pi]:null;return {f:unpackPositionKey(row?.[0]||fallbackFen||''),m:row?.[1]?.[mi]?.[0]||fallbackMove||'',r:!!resolved,ply,side,at,pred};}
        if(isV5)return {f:item[0],m:item[1],r:!!item[2],ply:item[3],side:item[4],at:item[5],pred:item[6]};
        if(source.v===4)return {f:item[0],m:item[1],r:!!item[3],ply:item[4],side:item[5],at:item[6],pred:item[7]};
        return {f:item[0],m:item[1],r:!!item[6],ply:item[7],side:item[8],at:item[9],pred:0};
      });
      const expanded={schema:source.v,petName:i[0]||'Chelo',handle:i[1]||'',trainerName:i[2]||'',gen:i[3]||1,elo:i[4]||100,trainerReferenceElo:i[5]||1000,
        wins:i[6]||0,losses:i[7]||0,draws:i[8]||0,games:i[9]||0,practiceGames:i[10]||0,
        traits:{bold:source.t?.[0],curious:source.t?.[1],patient:source.t?.[2]},
        memory:unpackMap(source.m,'memory'),humanOpenings:unpackMap(humanRows,'opening'),openingReplies:unpackMap(replyRows,'reply'),pending,
        replay:(isV6||isV7||isV8||isV9||isV10||isV11||isV12||isV13||isV14)?(source.r||[]).map(item=>{const [pi,mi,y,n,p,side,fallbackFen,fallbackMove]=item;const row=pi>=0?source.m?.[pi]:null;return {f:unpackPositionKey(row?.[0]||fallbackFen||''),m:row?.[1]?.[mi]?.[0]||fallbackMove||'',y,n,p,side:side?'b':'w'};}):isV5?(source.r||[]).map(item=>({f:item[0],m:item[1],y:item[2],n:item[3],p:item[4],side:item[5]?'b':'w'})):[],
        geneticTrace:Object.fromEntries(['p','n','b','r','q'].map((key,index)=>[key,source.g?.[index]||0])),
        lastHumanMove:source.l?{fen:source.l[0],move:source.l[1],mirror:source.l[2],ply:source.l[3],at:source.l[4]}:null,
        mastery:source.y?{tier:source.y[0],games:source.y[1],score:source.y[2]}:undefined,
        createdAt:source.c||now(),updatedAt:(isCurrent?source.vv:source.u)||now(),v14Adapter:null,dualLora:source.dl?unpackDualLora(source.dl):freshDualLora()
      };
      if((isV13||isV14)&&Number(source.n?.mv)===8){
        const n=source.n||{};expanded.model={w1:unpackInt4(n.a,FEATURES*HIDDEN),b1:unpackWeights(n.b,HIDDEN),w2:unpackInt4(n.h2,HIDDEN*HIDDEN),b2:unpackWeights(n.b2,HIDDEN),wOut:unpackWeights(n.c,3*HIDDEN),bOut:Array.from({length:3},(_,i)=>Number(n.d?.[i])||0),
          pFrom:unpackInt4(n.e,64*HIDDEN),pTo:unpackInt4(n.f,64*HIDDEN),pPiece:unpackInt4(n.g,6*HIDDEN),pPromo:unpackInt4(n.h,5*HIDDEN),pFromRank:unpackInt4(n.fr,64*POLICY_RANK,POLICY_RANK),pToRank:unpackInt4(n.tr,64*POLICY_RANK,POLICY_RANK),pStateRank:unpackInt4(n.sr,HIDDEN*POLICY_RANK,POLICY_RANK),pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z,wdlLoss:n.wl};
      }else if((isV11||isV12)&&Number(source.n?.mv)===7){
        const n=source.n||{};expanded.model={w1:unpackInt4(n.a,FEATURES*HIDDEN),b1:unpackWeights(n.b,HIDDEN),wOut:unpackWeights(n.c,3*HIDDEN),bOut:Array.from({length:3},(_,i)=>Number(n.d?.[i])||0),
          pFrom:unpackInt4(n.e,64*HIDDEN),pTo:unpackInt4(n.f,64*HIDDEN),pPiece:unpackInt4(n.g,6*HIDDEN),pPromo:unpackInt4(n.h,5*HIDDEN),
          pFromRank:unpackInt4(n.fr,64*POLICY_RANK,POLICY_RANK),pToRank:unpackInt4(n.tr,64*POLICY_RANK,POLICY_RANK),pStateRank:unpackInt4(n.sr,HIDDEN*POLICY_RANK,POLICY_RANK),
          pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z,wdlLoss:n.wl};
      }else if(isV10&&Number(source.n?.mv)===6){
        const n=source.n||{};expanded.model={w1:unpackInt4(n.a,FEATURES*V10_HIDDEN),b1:unpackWeights(n.b,V10_HIDDEN),wOut:unpackWeights(n.c,3*V10_HIDDEN),bOut:Array.from({length:3},(_,i)=>Number(n.d?.[i])||0),
          pFrom:unpackInt4(n.e,64*V10_HIDDEN),pTo:unpackInt4(n.f,64*V10_HIDDEN),pPiece:unpackInt4(n.g,6*V10_HIDDEN),pPromo:unpackInt4(n.h,5*V10_HIDDEN),
          pFromRank:unpackInt4(n.fr,64*POLICY_RANK,POLICY_RANK),pToRank:unpackInt4(n.tr,64*POLICY_RANK,POLICY_RANK),pStateRank:unpackInt4(n.sr,V10_HIDDEN*POLICY_RANK,POLICY_RANK),
          pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z,wdlLoss:n.wl};
      }else if(isV9&&Number(source.n?.mv)===5){
        const n=source.n||{};expanded.model={w1:unpackWeights(n.a,FEATURES*PREVIOUS_HIDDEN),b1:unpackWeights(n.b,PREVIOUS_HIDDEN),wOut:unpackWeights(n.c,3*PREVIOUS_HIDDEN),bOut:Array.from({length:3},(_,i)=>Number(n.d?.[i])||0),
          pFrom:unpackInt4(n.e,64*PREVIOUS_HIDDEN),pTo:unpackInt4(n.f,64*PREVIOUS_HIDDEN),pPiece:unpackInt4(n.g,6*PREVIOUS_HIDDEN),pPromo:unpackInt4(n.h,5*PREVIOUS_HIDDEN),
          pFromRank:unpackInt4(n.fr,64*POLICY_RANK,POLICY_RANK),pToRank:unpackInt4(n.tr,64*POLICY_RANK,POLICY_RANK),pStateRank:unpackInt4(n.sr,PREVIOUS_HIDDEN*POLICY_RANK,POLICY_RANK),
          pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z,wdlLoss:n.wl};
      }else if(isV8&&Number(source.n?.mv)===4){
        const n=source.n||{};expanded.model={w1:unpackWeights(n.a,FEATURES*PREVIOUS_HIDDEN),b1:unpackWeights(n.b,PREVIOUS_HIDDEN),wOut:unpackWeights(n.c,3*PREVIOUS_HIDDEN),bOut:Array.from({length:3},(_,i)=>Number(n.d?.[i])||0),
          pFrom:unpackInt4(n.e,64*PREVIOUS_HIDDEN),pTo:unpackInt4(n.f,64*PREVIOUS_HIDDEN),pPiece:unpackInt4(n.g,6*PREVIOUS_HIDDEN),pPromo:unpackInt4(n.h,5*PREVIOUS_HIDDEN),pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z,wdlLoss:n.wl};
      }else if(isV7&&Number(source.n?.mv)===3){
        const n=source.n||{};expanded.model={w1:unpackWeights(n.a,FEATURES*PREVIOUS_HIDDEN),b1:unpackWeights(n.b,PREVIOUS_HIDDEN),wOut:unpackWeights(n.c,3*PREVIOUS_HIDDEN),bOut:Array.from({length:3},(_,i)=>Number(n.d?.[i])||0),
          pFrom:unpackWeights(n.e,64*PREVIOUS_HIDDEN),pTo:unpackWeights(n.f,64*PREVIOUS_HIDDEN),pPiece:unpackWeights(n.g,6*PREVIOUS_HIDDEN),pPromo:unpackWeights(n.h,5*PREVIOUS_HIDDEN),pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z,wdlLoss:n.wl};
      }else if((isV5||isV6)&&Number(source.n?.mv)===2){
        const n=source.n||{};expanded.model={w1:unpackWeights(n.a,FEATURES*LEGACY_HIDDEN),b1:unpackWeights(n.b,LEGACY_HIDDEN),w2:unpackWeights(n.c,LEGACY_HIDDEN),b2:n.d,
          pFrom:unpackWeights(n.e,64*LEGACY_HIDDEN),pTo:unpackWeights(n.f,64*LEGACY_HIDDEN),pPiece:unpackWeights(n.g,6*LEGACY_HIDDEN),pPromo:unpackWeights(n.h,5*LEGACY_HIDDEN),pFromBias:unpackWeights(n.j,64),pToBias:unpackWeights(n.k,64),pPieceBias:unpackWeights(n.u,6),pPromoBias:unpackWeights(n.v,5),steps:n.s,policySteps:n.p,episodes:n.x,loss:n.l,lastDelta:n.z};
      }else{
        // V2/V3/V4 feature schemas cannot be mapped directly to the current square
        // planes. Their episodic position/opening memories are retained; model/replay
        // vectors are reinitialized because they lack the original 64-square state.
        expanded.model=null;expanded.replay=[];
      }
      return expanded;
    }

    size(data=this.data){return byteLength(this.compactData(data));}
    memoryCount(){return Object.keys(this.data.memory).length;}
    maxReplay(){return this.plan==='pro'?1600:160;}
    maxPending(){return this.plan==='pro'?1200:120;}

    memoryUtility(moves,at=now()){
      let total=0;
      for(const value of Object.values(moves||{})){
        const visits=Math.max(0,Number(value.visits)||0),outcomes=Math.max(0,Number(value.outcomes)||0),tactical=Math.max(0,Number(value.tactical)||0);
        const meanImpact=Math.abs(Number(value.score)||0)/Math.max(1,visits);
        const age=Math.max(0,at-(Number(value.last)||at)),recency=Math.exp(-age/(45*24*60*60*1000));
        // A rarely revisited capture/check pattern receives a deliberate
        // protection bonus instead of being evicted solely for being old.
        const rareTactic=tactical>0&&visits<=3?3.5+Math.min(3,tactical*0.75):Math.min(1.5,tactical*0.12);
        total+=Math.min(3,Math.log2(1+visits)*0.75)+Math.min(2,outcomes*0.4)+Math.min(2,meanImpact*0.08)+recency*0.6+rareTactic;
      }
      return total;
    }

    pruneToBudget(){
      while(this.data.pending.length>this.maxPending()){
        const resolved=this.data.pending.findIndex(item=>item.r);this.data.pending.splice(resolved>=0?resolved:0,1);
      }
      while(this.data.replay.length>this.maxReplay()){
        let worst=0;for(let i=1;i<this.data.replay.length;i++)if((this.data.replay[i].p||0)<(this.data.replay[worst].p||0))worst=i;
        this.data.replay.splice(worst,1);
      }
      let measuredSize=this.size(),target=this.limit-768;
      const pruneMapByUtility=(field,utility)=>{
        if(measuredSize<=target)return;
        const original=this.data[field]||{},keys=Object.keys(original);
        if(!keys.length)return;
        keys.sort((a,b)=>utility(original[a])-utility(original[b]));
        // Binary-search the smallest low-utility prefix that must be removed.
        // This avoids serialising the entire save after every tiny deletion.
        let low=1,high=keys.length,best=keys.length;
        while(low<=high){
          const remove=Math.floor((low+high)/2),candidate={};
          for(let i=remove;i<keys.length;i++)candidate[keys[i]]=original[keys[i]];
          this.data[field]=candidate;
          const bytes=this.size();
          if(bytes<=target){best=remove;high=remove-1;}else low=remove+1;
        }
        const retained={};for(let i=best;i<keys.length;i++)retained[keys[i]]=original[keys[i]];
        this.data[field]=retained;measuredSize=this.size();
      };
      const mapUtility=map=>Object.values(map||{}).reduce((sum,item)=>sum+Math.min(8,Number(item.count)||0)*0.2+Math.min(4,Math.abs(Number(item.score)||0)*0.03)+Math.exp(-Math.max(0,now()-(Number(item.last)||now()))/(30*24*60*60*1000)),0);
      pruneMapByUtility('humanOpenings',mapUtility);
      pruneMapByUtility('openingReplies',mapUtility);
      pruneMapByUtility('memory',moves=>this.memoryUtility(moves));
      while(this.data.replay.length&&measuredSize>target){
        this.data.replay.sort((a,b)=>(a.p||0)-(b.p||0));
        const batch=Math.max(1,Math.ceil(this.data.replay.length*0.05));this.data.replay.splice(0,batch);measuredSize=this.size();
      }
      while(this.data.pending.length&&measuredSize>target){
        const resolved=this.data.pending.findIndex(item=>item.r);this.data.pending.splice(resolved>=0?resolved:0,1);measuredSize=this.size();
      }
      // Never wipe all learned experiences as an emergency shortcut. If the
      // core model itself cannot fit, fail visibly and leave existing pet data intact.
      if(measuredSize>this.limit)throw new Error(`Chelo core model exceeds the ${this.limit/1024} KiB brain budget.`);
      this.lastStorageReport={bytes:measuredSize,limit:this.limit,remaining:this.limit-measuredSize,memoryPositions:this.memoryCount(),replay:this.data.replay.length,pending:this.data.pending.length};
    }

    pruneForStoragePressure(){
      // QuotaExceeded is not a licence to erase the pet's history. Trim small,
      // low-utility batches and retry; if the browser still refuses the write,
      // preserve the in-memory pet state and report failure for the UI to surface.
      const trimOldest=map=>{
        const keys=Object.keys(map||{}).sort((a,b)=>{
          const last=value=>Math.max(0,...Object.values(value||{}).map(item=>Number(item.last)||0));
          return last(map[a])-last(map[b]);
        });
        for(const key of keys.slice(0,Math.max(1,Math.ceil(keys.length*0.05))))delete map[key];
      };
      trimOldest(this.data.humanOpenings);trimOldest(this.data.openingReplies);
      const replay=this.data.replay;
      if(replay.length){replay.sort((a,b)=>(a.p||0)-(b.p||0));replay.splice(0,Math.max(1,Math.ceil(replay.length*0.05)));}
      const memories=Object.keys(this.data.memory).sort((a,b)=>this.memoryUtility(this.data.memory[a])-this.memoryUtility(this.data.memory[b]));
      if(memories.length){const removable=memories.filter(key=>!Object.values(this.data.memory[key]||{}).some(value=>(Number(value.tactical)||0)>0));const candidates=removable.length?removable:memories;for(const key of candidates.slice(0,Math.max(1,Math.ceil(candidates.length*0.02))))delete this.data.memory[key];}
      const resolved=this.data.pending.findIndex(item=>item.r);if(resolved>=0)this.data.pending.splice(resolved,1);
    }

    save(){
      this.data.updatedAt=now();this.pruneToBudget();
      if(!this.persist){
        if(this.onSave){try{const result=this.onSave(this.compactData());if(result&&typeof result.catch==='function')result.catch(error=>{this.lastSaveError=String(error?.message||error);console.error('Chelo could not persist its unified player save.',error);});}catch(error){this.lastSaveError=String(error?.message||error);return false;}}
        return true;
      }
      let lastError=null;
      for(let attempt=0;attempt<3;attempt++){
        try{localStorage.setItem(this.storageKey,JSON.stringify(this.compactData()));return true;}
        catch(error){lastError=error;if(attempt<2)this.pruneForStoragePressure();}
      }
      console.error('Chelo could not persist its latest pet state; learning remains in memory and was not deliberately erased.',lastError);
      this.lastSaveError=String(lastError?.message||lastError||'Storage unavailable');
      return false;
    }

    simplifyFen(fen){return compactMemoryKey(fen);}
    entry(fen,move){const key=this.simplifyFen(fen);this.data.memory[key]||={};this.data.memory[key][move]||={score:0,visits:0,mirror:0,outcomes:0,last:now(),tactical:0};const item=this.data.memory[key][move];item.last=now();return item;}

    observeHumanMove(fen,move,ply=0){
      const key=this.simplifyFen(fen);
      // Owner moves are observations, not instructions. Keep the sequence so a
      // later, consequence-aware learner can infer recurring preferences. Never
      // manufacture a mirrored reply or reward a move merely because it appeared.
      if(ply<=12){
        this.data.humanOpenings[key]||={};
        const item=this.data.humanOpenings[key][move]||{count:0,last:0};
        item.count++;item.last=now();this.data.humanOpenings[key][move]=item;
      }
      this.data.lastHumanMove={fen:key,move,mirror:'',ply,at:now()};
      this.save();
    }

    extractFeatures(chess,perspective=chess.turn()){
      const vector=Array(VECTOR_SIZE).fill(0),board=chess.board(),own=perspective==='b'?'b':'w',opp=own==='w'?'b':'w';
      for(let r=0;r<8;r++)for(let c=0;c<8;c++){
        const piece=board[r][c];if(!piece)continue;
        const rr=own==='w'?r:7-r,cc=own==='w'?c:7-c,square=rr*8+cc;
        const code=TYPE_CODE[piece.type];if(!code)continue;
        vector[square]=piece.color===own?code:code+6;
      }
      const fen=chess.fen(),parts=fen.split(/\s+/),rights=parts[2]||'-',ep=parts[3]||'-';
      const globals=vector.slice(SQUARES);
      globals[0]=chess.turn()===own?1:0;
      globals[1]=Number(rights.includes(own==='w'?'K':'k'));
      globals[2]=Number(rights.includes(own==='w'?'Q':'q'));
      globals[3]=Number(rights.includes(opp==='w'?'K':'k'));
      globals[4]=Number(rights.includes(opp==='w'?'Q':'q'));
      globals[5]=Number(typeof chess.inCheck==='function'&&chess.inCheck(own));
      globals[6]=Number(typeof chess.inCheck==='function'&&chess.inCheck(opp));
      globals[7]=ep!=='-'?1:0;
      if(/^[a-h][36]$/.test(ep))globals[8+(ep.charCodeAt(0)-97)]=1;
      for(let i=0;i<GLOBALS;i++)vector[SQUARES+i]=globals[i]||0;
      return vector;
    }

    featuresFromFen(fen,perspective=null){
      try{const C=Core();if(!C)return Array(VECTOR_SIZE).fill(0);const chess=new C(fen);return this.extractFeatures(chess,perspective||chess.turn());}
      catch{return Array(VECTOR_SIZE).fill(0);}
    }

    quantise(features){return features.slice(0,VECTOR_SIZE).map(v=>clamp(Math.round(Number(v)||0),0,12));}
    dequantise(features){return features.slice(0,VECTOR_SIZE).map(v=>clamp(Number(v)||0,0,12));}

    activeRows(vector){
      const rows=[];
      for(let square=0;square<SQUARES;square++){
        const code=Number(vector[square])||0;if(code>=1&&code<=12)rows.push(square*PLANES+code-1);
      }
      for(let i=0;i<GLOBALS;i++)if(Number(vector[SQUARES+i])>0)rows.push(SQUARES*PLANES+i);
      return rows;
    }

    finishForward(hidden1,rows=[]){
      const m=this.data.model,refined=Array(HIDDEN).fill(0),residual=Array(HIDDEN).fill(0);
      for(let out=0;out<HIDDEN;out++){
        let z=m.b2[out]||0;
        for(let input=0;input<HIDDEN;input++){
          let w=m.w2[out*HIDDEN+input]||0;
          if(this.v14Mode)for(let k=0;k<V14_RANK;k++)w+=(this.v14Adapter.B[out*V14_RANK+k]*this.v14Adapter.A[k*HIDDEN+input])/V14_RANK;
          z+=w*hidden1[input];
        }
        residual[out]=Math.tanh(z);refined[out]=hidden1[out]+residual[out];
      }
      const logits=Array(3).fill(0);for(let c=0;c<3;c++){let z=m.bOut[c]||0;for(let h=0;h<HIDDEN;h++)z+=(m.wOut[c*HIDDEN+h]||0)*refined[h];logits[c]=clamp(z,-12,12);}
      const max=Math.max(...logits),exps=logits.map(z=>Math.exp(z-max)),sum=exps.reduce((a,b)=>a+b,0)||1,wdl=exps.map(z=>z/sum);
      return {value:wdl[0]-wdl[2],wdl,logits,hidden:refined,hidden1,residual,rows};
    }

    forward(features){
      const x=Array.isArray(features)&&features.length===VECTOR_SIZE?features:Array(VECTOR_SIZE).fill(0),m=this.data.model;
      const hidden1=Array(HIDDEN).fill(0),rows=this.activeRows(x);
      for(let h=0;h<HIDDEN;h++){
        let z=m.b1[h]||0;for(const row of rows)z+=(m.w1[row*HIDDEN+h]||0)*(row<SQUARES*PLANES?1:Number(x[SQUARES+(row-SQUARES*PLANES)]||0));
        hidden1[h]=Math.tanh(z);
      }
      return this.finishForward(hidden1,rows);
    }

    makeSearchAccumulator(chess){
      const build=perspective=>{
        const exact=this.extractFeatures(chess,perspective),pre=new Float32Array(HIDDEN),m=this.data.model;
        for(let h=0;h<HIDDEN;h++){let z=m.b1[h]||0;for(let sq=0;sq<64;sq++){const code=exact[sq];if(code)z+=m.w1[(sq*PLANES+code-1)*HIDDEN+h]||0;}for(let g=0;g<GLOBALS;g++)if(exact[64+g])z+=m.w1[(SQUARES*PLANES+g)*HIDDEN+h]||0;pre[h]=z;}
        return {features:Uint8Array.from(exact),pre};
      };
      return {w:build('w'),b:build('b')};
    }

    searchGlobals(chess,perspective){
      const own=perspective,opp=own==='w'?'b':'w',s=chess.s,rights=s.c||'',out=new Uint8Array(GLOBALS),ep=s.ep;
      out[0]=s.t===own?1:0;out[1]=rights.includes(own==='w'?'K':'k')?1:0;out[2]=rights.includes(own==='w'?'Q':'q')?1:0;
      out[3]=rights.includes(opp==='w'?'K':'k')?1:0;out[4]=rights.includes(opp==='w'?'Q':'q')?1:0;
      out[5]=chess.inCheck(own)?1:0;out[6]=chess.inCheck(opp)?1:0;out[7]=ep>=0?1:0;
      if(ep>=0)out[8+(ep&7)]=1;return out;
    }

    applySearchAccumulator(accumulator,chess,move){
      const changed=[];
      if(move){
        changed.push(square88FromName(move.from),square88FromName(move.to));
        if(move.flags==='ep')changed.push(square88FromName(move.to)+(move.color==='w'?16:-16));
        if(move.flags==='castleK'||move.flags==='castleQ'){const from=square88FromName(move.from);changed.push(move.flags==='castleK'?from+3:from-4,move.flags==='castleK'?from+1:from-1);}
      }
      const m=this.data.model,undo=[];
      for(const perspective of ['w','b']){
        const state=accumulator[perspective],features=state.features,pre=state.pre;
        for(const sq88 of changed){
          if(sq88<0||(sq88&0x88))continue;
          const row=sq88>>4,file=sq88&7,rel=perspective==='w'?(row*8+file):((7-row)*8+(7-file)),piece=chess.s.b[sq88];
          let code=0;if(piece){const type=TYPE_CODE[piece.toLowerCase()];code=piece===piece.toUpperCase()?(perspective==='w'?type:type+6):(perspective==='b'?type:type+6);}
          const before=features[rel]||0;if(before===code)continue;
          undo.push({side:perspective,index:rel,before,after:code,global:false});
          for(let h=0;h<HIDDEN;h++){
            let delta=0;if(before)delta-=m.w1[(rel*PLANES+before-1)*HIDDEN+h]||0;if(code)delta+=m.w1[(rel*PLANES+code-1)*HIDDEN+h]||0;
            pre[h]+=delta;
          }
          features[rel]=code;
        }
        const globals=this.searchGlobals(chess,perspective);
        for(let g=0;g<GLOBALS;g++){
          const before=features[64+g]||0,after=globals[g]||0;if(before===after)continue;
          undo.push({side:perspective,index:64+g,before,after,global:true});
          const row=SQUARES*PLANES+g;for(let h=0;h<HIDDEN;h++)pre[h]+=(after-before)*(m.w1[row*HIDDEN+h]||0);
          features[64+g]=after;
        }
      }
      return undo;
    }

    restoreSearchAccumulator(accumulator,undo){
      if(!undo?.length)return;const m=this.data.model;
      for(let i=undo.length-1;i>=0;i--){
        const item=undo[i],state=accumulator[item.side],features=state.features,pre=state.pre;
        if(item.global){const row=SQUARES*PLANES+(item.index-64);for(let h=0;h<HIDDEN;h++)pre[h]+=(item.before-item.after)*(m.w1[row*HIDDEN+h]||0);}
        else{const row=item.index,before=item.before,after=item.after;for(let h=0;h<HIDDEN;h++){let delta=0;if(after)delta-=m.w1[(row*PLANES+after-1)*HIDDEN+h]||0;if(before)delta+=m.w1[(row*PLANES+before-1)*HIDDEN+h]||0;pre[h]+=delta;}}
        features[item.index]=item.before;
      }
    }

    updateSearchAccumulator(parent,chess,move){
      const next={w:{features:parent.w.features.slice(),pre:parent.w.pre.slice()},b:{features:parent.b.features.slice(),pre:parent.b.pre.slice()}};
      this.applySearchAccumulator(next,chess,move);return next;
    }

    forwardFromAccumulator(accumulator,perspective){
      const state=accumulator[perspective==='b'?'b':'w'],hidden1=Array(HIDDEN);for(let h=0;h<HIDDEN;h++)hidden1[h]=Math.tanh(state.pre[h]);
      return this.finishForward(hidden1,[]);
    }

    // Search-only scalar path: computes the frozen value head without building
    // WDL/logit objects or invoking the 4,096-action policy head.
    forwardValueFromAccumulator(accumulator,perspective){
      const state=accumulator[perspective==='b'?'b':'w'],m=this.data.model;
      const hidden1=new Float32Array(HIDDEN),refined=new Float32Array(HIDDEN);
      for(let h=0;h<HIDDEN;h++)hidden1[h]=Math.tanh(state.pre[h]);
      for(let out=0;out<HIDDEN;out++){
        let z=m.b2[out]||0;
        for(let input=0;input<HIDDEN;input++){
          let w=m.w2[out*HIDDEN+input]||0;
          if(this.v14Mode)for(let k=0;k<V14_RANK;k++)w+=(this.v14Adapter.B[out*V14_RANK+k]*this.v14Adapter.A[k*HIDDEN+input])/V14_RANK;
          z+=w*hidden1[input];
        }
        refined[out]=hidden1[out]+Math.tanh(z);
      }
      const logits=[0,0,0];
      for(let c=0;c<3;c++){let z=m.bOut[c]||0;for(let h=0;h<HIDDEN;h++)z+=(m.wOut[c*HIDDEN+h]||0)*refined[h];logits[c]=clamp(z,-12,12);}
      const max=Math.max(logits[0],logits[1],logits[2]);
      const win=Math.exp(logits[0]-max),draw=Math.exp(logits[1]-max),loss=Math.exp(logits[2]-max);
      return (win-loss)/(win+draw+loss||1);
    }

    predict(features){return this.forward(features).value;}
    predictWDL(features){const {wdl}=this.forward(features);return {win:wdl[0],draw:wdl[1],loss:wdl[2]};}

    backpropHidden(gradient,forward,features,rate=1){
      if(this.v14Mode)return;
      const m=this.data.model,x=Array.isArray(features)&&features.length===VECTOR_SIZE?features:Array(VECTOR_SIZE).fill(0),hidden1=forward.hidden1||forward.hidden||Array(HIDDEN).fill(0),residual=forward.residual||Array(HIDDEN).fill(0),rows=forward.rows||this.activeRows(x),firstGradient=Array(HIDDEN).fill(0);
      // h2 = h1 + tanh(W2*h1 + b2). The skip path preserves prior behaviour.
      for(let out=0;out<HIDDEN;out++){
        const back=gradient[out]*(1-residual[out]*residual[out]);m.b2[out]=clamp((m.b2[out]||0)+rate*back,-3,3);
        for(let input=0;input<HIDDEN;input++){
          const index=out*HIDDEN+input,weight=m.w2[index]||0;
          firstGradient[input]+=gradient[out]*(out===input?1:0)+back*weight;
          m.w2[index]=clamp(weight+rate*back*hidden1[input],-3,3);
        }
      }
      for(let h=0;h<HIDDEN;h++){
        const back=firstGradient[h]*(1-hidden1[h]*hidden1[h]);m.b1[h]=clamp(m.b1[h]+rate*back,-3,3);
        for(const row of rows){const input=row<SQUARES*PLANES?1:Number(x[SQUARES+(row-SQUARES*PLANES)]||0);m.w1[row*HIDDEN+h]=clamp(m.w1[row*HIDDEN+h]+rate*back*input,-3,3);}
      }
    }

    trainSample(features,target,importance=1){
      if(this.v14Mode)return {trained:false,frozenBase:true,error:0,loss:0};
      const x=Array.isArray(features)&&features.length===VECTOR_SIZE?features:Array(VECTOR_SIZE).fill(0);
      target=clamp(Number(target)||0,-1,1);importance=clamp(Number(importance)||1,0.05,2);
      const m=this.data.model,{value,wdl,hidden,hidden1,residual,rows}=this.forward(x);
      const desired=[Math.max(0,target),1-Math.abs(target),Math.max(0,-target)];
      // Cross-entropy over win/draw/loss classes. Soft targets preserve the
      // uncertainty of TD feedback instead of collapsing every position to a
      // single scalar label. Small label smoothing prevents brittle certainty.
      const smooth=0.015,targets=desired.map(v=>v*(1-smooth)+smooth/3);
      const rate=0.006/Math.sqrt(1+m.steps/9000),old=m.wOut.slice(),grad=targets.map((v,i)=>(v-wdl[i])*importance);
      const hiddenGradient=Array(HIDDEN).fill(0);
      for(let c=0;c<3;c++)for(let h=0;h<HIDDEN;h++){
        const index=c*HIDDEN+h;hiddenGradient[h]+=grad[c]*(old[index]||0);
        m.wOut[index]=clamp((m.wOut[index]||0)+rate*grad[c]*hidden[h],-3,3);
      }
      for(let c=0;c<3;c++)m.bOut[c]=clamp((m.bOut[c]||0)+rate*grad[c],-3,3);
      this.backpropHidden(hiddenGradient,{hidden1,residual,rows},x,rate);
      const loss=-targets.reduce((sum,t,i)=>sum+t*Math.log(Math.max(1e-8,wdl[i])),0);
      m.steps++;m.loss=m.steps===1?loss:m.loss*0.98+loss*0.02;m.wdlLoss=m.loss;m.lastDelta=target-value;
      return {before:value,error:target-value,loss,wdl:{win:wdl[0],draw:wdl[1],loss:wdl[2]}};
    }

    policyStateProjection(hidden,weights=this.data.model.pStateRank){
      const projection=Array(POLICY_RANK).fill(0);
      for(let r=0;r<POLICY_RANK;r++)for(let h=0;h<HIDDEN;h++)projection[r]+=hidden[h]*(weights[h*POLICY_RANK+r]||0);
      return projection;
    }

    policyLogit(hidden,descriptor,stateProjection=null){
      if(!descriptor)return 0;const m=this.data.model,H=HIDDEN;
      let logit=(m.pFromBias[descriptor.from]||0)+(m.pToBias[descriptor.to]||0)+(m.pPieceBias[descriptor.piece]||0)+(m.pPromoBias[descriptor.promo]||0);
      for(let h=0;h<H;h++){
        logit+=hidden[h]*(
          (m.pFrom[descriptor.from*H+h]||0)+
          (m.pTo[descriptor.to*H+h]||0)+
          (m.pPiece[descriptor.piece*H+h]||0)+
          (m.pPromo[descriptor.promo*H+h]||0)
        );
      }
      const projection=stateProjection||this.policyStateProjection(hidden);
      for(let r=0;r<POLICY_RANK;r++)logit+=(m.pFromRank[descriptor.from*POLICY_RANK+r]||0)*(m.pToRank[descriptor.to*POLICY_RANK+r]||0)*projection[r];
      return clamp(logit,-12,12);
    }

    policyDistribution(features,moves,side='w',cachedForward=null){
      const list=(Array.isArray(moves)?moves:[]).map(move=>({move:typeof move==='string'?move:move?.uci,descriptor:moveDescriptor(features,move,side)})).filter(item=>item.move&&item.descriptor);
      if(!list.length)return new Map();
      const hidden=(cachedForward||this.forward(features)).hidden,projection=this.policyStateProjection(hidden),logits=list.map(item=>this.policyLogit(hidden,item.descriptor,projection)),max=Math.max(...logits);
      const exps=logits.map(value=>Math.exp(clamp(value-max,-30,0))),sum=exps.reduce((a,b)=>a+b,0)||1;
      return new Map(list.map((item,index)=>[item.move,exps[index]/sum]));
    }

    policyProbability(features,move,side='w',moves=null){
      if(Array.isArray(moves))return this.policyDistribution(features,moves,side).get(typeof move==='string'?move:move?.uci)||0;
      const descriptor=moveDescriptor(features,move,side);return sigmoid(this.policyLogit(this.forward(features).hidden,descriptor));
    }

    trainV14AdapterPolicy(features,chosen,list,side='w',importance=1){
      const x=Array.isArray(features)&&features.length===VECTOR_SIZE?features:Array(VECTOR_SIZE).fill(0),m=this.data.model,adapter=this.v14Adapter;
      const {hidden,hidden1,residual}=this.forward(x),projection=this.policyStateProjection(hidden),logits=list.map(item=>this.policyLogit(hidden,item.descriptor,projection)),max=Math.max(...logits),exps=logits.map(v=>Math.exp(clamp(v-max,-30,0))),sum=exps.reduce((a,b)=>a+b,0)||1,probs=exps.map(v=>v/sum),chosenIndex=list.findIndex(item=>item.move===chosen);
      if(chosenIndex<0)return {trained:false,probability:0};
      const rate=0.0015/Math.sqrt(1+adapter.steps/12000),hiddenGradient=Array(HIDDEN).fill(0),labelSmooth=0.01;
      for(let i=0;i<list.length;i++){const coefficient=((i===chosenIndex?1-labelSmooth+labelSmooth/list.length:labelSmooth/list.length)-probs[i])*importance*rate,d=list[i].descriptor;
        for(let h=0;h<HIDDEN;h++)hiddenGradient[h]+=coefficient*((m.pFrom[d.from*HIDDEN+h]||0)+(m.pTo[d.to*HIDDEN+h]||0)+(m.pPiece[d.piece*HIDDEN+h]||0)+(m.pPromo[d.promo*HIDDEN+h]||0));
      }
      // Backprop through frozen tanh residual into A/B only. W0, trunk and
      // policy/value heads are read-only in V14 mode.
      const gradZ=hiddenGradient.map((g,o)=>g*(1-residual[o]*residual[o]));
      const oldA=adapter.A.slice(),oldB=adapter.B.slice();
      for(let o=0;o<HIDDEN;o++)for(let k=0;k<V14_RANK;k++){let ah=0;for(let j=0;j<HIDDEN;j++)ah+=oldA[k*HIDDEN+j]*hidden1[j];adapter.B[o*V14_RANK+k]=clamp(oldB[o*V14_RANK+k]+rate*gradZ[o]*ah/V14_RANK,-1,1);}
      for(let k=0;k<V14_RANK;k++)for(let j=0;j<HIDDEN;j++){let gb=0;for(let o=0;o<HIDDEN;o++)gb+=gradZ[o]*oldB[o*V14_RANK+k];adapter.A[k*HIDDEN+j]=clamp(oldA[k*HIDDEN+j]+rate*gb*hidden1[j]/V14_RANK,-1,1);}
      adapter.steps++;this.data.model.policySteps++;return {trained:true,probability:probs[chosenIndex],adapterSteps:adapter.steps};
    }

    trainPolicyChoice(features,move,legalMoves,side='w',advantage=0,importance=1){
      if(!this.policyLearning)return {trained:false,probability:0,disabled:true};
      const x=Array.isArray(features)&&features.length===VECTOR_SIZE?features:Array(VECTOR_SIZE).fill(0);
      const chosen=typeof move==='string'?move:move?.uci;
      const list=(Array.isArray(legalMoves)?legalMoves:[]).map(item=>({move:typeof item==='string'?item:item?.uci,descriptor:moveDescriptor(x,item,side)})).filter(item=>item.move&&item.descriptor);
      if(!chosen||!list.some(item=>item.move===chosen)||list.length<2)return {trained:false,probability:0};
      advantage=clamp(Number(advantage)||0,-1,1);importance=clamp(Number(importance)||1,0.05,2);
      if(Math.abs(advantage)<0.0001)return {trained:false,probability:0};
      if(this.v14Mode)return this.trainV14AdapterPolicy(x,chosen,list,side,importance*advantage);
      const m=this.data.model,{hidden,hidden1,residual,rows}=this.forward(x),stateRankBefore=m.pStateRank.slice(),projection=this.policyStateProjection(hidden,stateRankBefore),logits=list.map(item=>this.policyLogit(hidden,item.descriptor,projection)),max=Math.max(...logits);
      const exps=logits.map(value=>Math.exp(clamp(value-max,-30,0))),sum=exps.reduce((a,b)=>a+b,0)||1,probs=exps.map(value=>value/sum);
      const chosenIndex=list.findIndex(item=>item.move===chosen),chosenProbability=probs[chosenIndex];
      const rate=0.0028/Math.sqrt(1+m.policySteps/16000),strength=rate*importance*advantage,labelSmooth=0.02;
      const hiddenGradient=Array(HIDDEN).fill(0);
      for(let i=0;i<list.length;i++){
        const item=list[i],d=item.descriptor,target=(i===chosenIndex?1-labelSmooth+labelSmooth/list.length:labelSmooth/list.length),coefficient=(target-probs[i])*strength;
        for(let h=0;h<HIDDEN;h++){
          const fi=d.from*HIDDEN+h,ti=d.to*HIDDEN+h,pi=d.piece*HIDDEN+h,ri=d.promo*HIDDEN+h;
          const context=(m.pFrom[fi]||0)+(m.pTo[ti]||0)+(m.pPiece[pi]||0)+(m.pPromo[ri]||0);
          hiddenGradient[h]+=coefficient*context;
          m.pFrom[fi]=clamp(m.pFrom[fi]+coefficient*hidden[h],-3,3);
          m.pTo[ti]=clamp(m.pTo[ti]+coefficient*hidden[h],-3,3);
          m.pPiece[pi]=clamp(m.pPiece[pi]+coefficient*hidden[h],-3,3);
          m.pPromo[ri]=clamp(m.pPromo[ri]+coefficient*hidden[h],-3,3);
        }
        // Backpropagate the low-rank, state-conditioned from/to interaction.
        for(let r=0;r<POLICY_RANK;r++){
          const stateValue=projection[r];
          const fi=d.from*POLICY_RANK+r,ti=d.to*POLICY_RANK+r,from=m.pFromRank[fi]||0,to=m.pToRank[ti]||0,product=from*to;
          for(let h=0;h<HIDDEN;h++){
            const si=h*POLICY_RANK+r,stateWeight=stateRankBefore[si]||0;
            hiddenGradient[h]+=coefficient*product*stateWeight;
            m.pStateRank[si]=clamp((m.pStateRank[si]||0)+coefficient*product*hidden[h],-3,3);
          }
          m.pFromRank[fi]=clamp(from+coefficient*stateValue*to,-3,3);
          m.pToRank[ti]=clamp(to+coefficient*stateValue*from,-3,3);
        }
        m.pFromBias[d.from]=clamp(m.pFromBias[d.from]+coefficient,-3,3);
        m.pToBias[d.to]=clamp(m.pToBias[d.to]+coefficient,-3,3);
        m.pPieceBias[d.piece]=clamp(m.pPieceBias[d.piece]+coefficient,-3,3);
        m.pPromoBias[d.promo]=clamp(m.pPromoBias[d.promo]+coefficient,-3,3);
      }
      this.backpropHidden(hiddenGradient,{hidden1,residual,rows},x,1);
      m.policySteps++;return {trained:true,probability:chosenProbability,advantage};
    }

    legalMovesFromFen(fen){
      try{const C=Core();if(!C)return [];return new C(fen).moves({verbose:true,skipSan:true}).map(move=>move.uci);}
      catch{return [];}
    }

    addReplay(fen,move,target,priority=0,side=null){
      const key=this.simplifyFen(fen),turn=side==='b'?'b':side==='w'?'w':(String(fen).split(/\s+/)[1]||'w');
      const existing=this.data.replay.find(item=>item.f===key&&item.m===move);
      if(existing){existing.y=clamp(Math.round((existing.y*existing.n+clamp(target,-1,1)*100)/(existing.n+1)),-100,100);existing.n++;existing.p=Math.max(existing.p,Math.round(clamp(priority,0,2)*100));return;}
      this.data.replay.push({f:key,m:move,y:Math.round(clamp(target,-1,1)*100),n:1,p:Math.round(clamp(priority,0,2)*100),side:turn});
      if(this.data.replay.length>this.maxReplay()){
        this.data.replay.sort((a,b)=>b.p-a.p);this.data.replay.length=this.maxReplay();
      }
    }

    replayLearn(){
      const pool=this.data.replay;if(!pool.length){this.data.model.episodes++;return;}
      // Half the minibatch targets surprising/high-error examples; the other
      // half rotates across the whole buffer so a few old high-priority items
      // cannot monopolise learning. The cursor is deterministic and resumable.
      const ranked=pool.map((item,index)=>({item,index})).sort((a,b)=>b.item.p-a.item.p);
      const primary=ranked.slice(0,16),rotationStart=(this.data.model.steps*16)%Math.max(1,pool.length),rotated=[];
      for(let i=0;i<Math.min(16,pool.length);i++)rotated.push({item:pool[(rotationStart+i)%pool.length],index:(rotationStart+i)%pool.length});
      const selected=[...new Map([...primary,...rotated].map(x=>[x.index,x])).values()].map(x=>x.item);
      for(let epoch=0;epoch<2;epoch++)for(const item of selected){
        const x=this.featuresFromFen(item.f,item.side),target=item.y/100,preUpdate=this.predict(x),advantage=clamp(target-preUpdate,-1,1);
        const importance=clamp(0.6+Math.min(0.55,(item.p||0)/220),0.5,1.2);
        const learned=this.trainSample(x,target,importance);
        // Policy advantage must use the prediction before the value update.
        this.trainPolicyChoice(x,item.m,this.legalMovesFromFen(item.f),item.side,advantage,importance*0.8);
        // Refresh stale priorities as the model learns each example. This lets
        // mastered items yield replay capacity to new surprising experiences.
        item.p=Math.max(1,Math.round(Math.abs(learned.error)*100));
      }
      this.data.model.episodes++;
    }

    evaluate(chess,perspective=chess.turn()){
      return Math.round(this.predict(this.extractFeatures(chess,perspective))*1000);
    }

    observePetMove(fen,move,meta={},ply=0,chessAfter=null){
      const key=this.simplifyFen(fen),side=meta.side==='w'?'w':meta.side==='b'?'b':(String(fen).split(/\s+/)[1]||'w');
      const entry=this.entry(key,move);entry.visits++;
      const isNew=entry.visits===1;
      if(meta.captured||meta.gaveCheck)entry.tactical=clamp((Number(entry.tactical)||0)+(meta.captured?2:0)+(meta.gaveCheck?3:0),0,40);
      if(meta.captured)this.data.traits.bold=clamp(this.data.traits.bold+0.6,0,100);
      if(isNew)this.data.traits.curious=clamp(this.data.traits.curious+0.3,0,100);
      if(!meta.captured&&!meta.gaveCheck)this.data.traits.patient=clamp(this.data.traits.patient+0.2,0,100);
      this.data.pending.push({f:`${fenKey(fen)} 0 1`,k:key,m:move,r:0,ply,side,at:now(),pred:0});
      // V5's raw opening-frequency table is deliberately not extended: usage
      // alone is not evidence that a move was successful. Consequences are
      // recorded through delayed TD feedback and canonical position memory.
      if(chessAfter)this.recordGeneticPosition(chessAfter,side);
      this.save();
    }

    recordGeneticPosition(chess,side='b'){
      if(!chess)return;const counts={p:0,n:0,b:0,r:0,q:0};
      for(const row of chess.board())for(const piece of row)if(piece&&piece.color===side&&counts[piece.type]!==undefined)counts[piece.type]++;
      for(const type of Object.keys(counts))this.data.geneticTrace[type]=(this.data.geneticTrace[type]||0)*0.94+counts[type]*0.06;
    }

    resolveLastPetMove(chess){
      // A reply resolves the temporal context, but does not train a retired JS
      // learner. Final outcome feedback is applied to the same compact adapter
      // that the C++/WASM engine reads.
      let item=null;
      for(let i=this.data.pending.length-1;i>=0;i--)if(!this.data.pending[i].r){item=this.data.pending[i];break;}
      if(!item)return;
      item.r=1;
      const entry=this.entry(item.k||item.f,item.m);
      if(chess&&typeof chess.game_over==='function'&&chess.game_over())entry.outcomes++;
      this.save();
    }

    adaptiveSearchProfile(){
      // Private challenge dial, not a measured chess Elo. Hatchlings begin with
      // a deliberately small search budget; controlled results grow it gradually.
      const rating=clamp(Number(this.data.elo)||100,100,2400),progress=(rating-100)/(2400-100);
      const eased=progress*progress*(3-2*progress);
      return {
        challengeRating:rating,
        maxNodes:Math.round(500+eased*120000),
        maxTimeMs:Math.round(65+eased*655),
        maxDepth:Math.round(1+eased*11)
      };
    }

    updateAdaptiveChallenge(outcome){
      // Player victory means Chelo should gradually raise its challenge.
      // Pet victory lowers it gently; draws cause only a small upward nudge.
      const previous=clamp(Number(this.data.elo)||100,100,2400);
      let delta=0;
      if(outcome==='loss'){
        this.data.trainerWinStreak=Math.min(1000,(Number(this.data.trainerWinStreak)||0)+1);
        const streak=this.data.trainerWinStreak;
        delta=streak>=8?72:streak>=4?54:36;
      }else if(outcome==='draw'){
        this.data.trainerWinStreak=0;delta=8;
      }else if(outcome==='win'){
        this.data.trainerWinStreak=0;delta=-42;
      }
      this.data.ratingGames=(Number(this.data.ratingGames)||0)+1;
      this.data.elo=clamp(Math.round(previous+delta),100,2400);
      return {previous,current:this.data.elo,delta:this.data.elo-previous,games:this.data.ratingGames,streak:this.data.trainerWinStreak};
    }

    generation(){const g=this.data.gen;if(g<2)return 'Hatchling';if(g<4)return 'Apprentice Tactician';if(g<8)return 'Trap Hunter';if(g<15)return 'Veteran Strategist';return 'Chess Monster';}
    growthLevel(){return Math.max(1,Number(this.data.gen)||1);}
    masteryTier(){return this.data.mastery?.tier||'Unbenchmarked';}
    recordMatchMemory(outcome,finalPosition=null){
      const history=finalPosition&&typeof finalPosition.historyMoves==='function'?finalPosition.historyMoves():[];
      const plies=history.length||Math.min(600,(this.data.pending.length||1)*2);
      const tactical=this.data.pending.reduce((count,item)=>count+((Number(this.entry(item.k||item.f,item.m).tactical)||0)>0?1:0),0);
      const kind=outcome==='win'?(tactical?'tactical-win':'battle-win'):outcome==='loss'?(tactical?'tactical-lesson':'battle-loss'):(plies>=80?'endurance-draw':'draw');
      if(outcome==='win'&&tactical)this.data.traits.bold=clamp(this.data.traits.bold+0.8,0,100);
      else if(outcome==='loss')this.data.traits.curious=clamp(this.data.traits.curious+0.8,0,100);
      else if(outcome==='draw')this.data.traits.patient=clamp(this.data.traits.patient+0.5,0,100);
      const trait=TRAIT_KEYS.slice().sort((a,b)=>this.data.traits[b]-this.data.traits[a])[0]||'curious';
      this.data.memories.push({kind,day:Math.floor(now()/86400000),plies,tactical:Math.min(40,tactical),trait});
      this.data.memories=this.data.memories.slice(-12);
      return this.latestMemory();
    }

    latestMemory(){
      const item=this.data.memories?.at(-1);if(!item)return '';
      const messages={
        'battle-win':'Won a trainer battle and kept the lesson',
        'tactical-win':'Found a tactical breakthrough in a trainer battle',
        'battle-loss':'Turned a tough trainer game into a lesson',
        'tactical-lesson':'A tactical defeat became its newest lesson',
        'draw':'Held the board to a draw',
        'endurance-draw':'Stayed composed through a long drawn game'
      };
      return messages[item.kind]||'Added a new chess memory';
    }

    personality(){
      const traits=this.data.traits,ranked=Object.entries(traits).sort((a,b)=>b[1]-a[1]);
      const [lead,second]=ranked;
      if(lead[1]-second[1]<2)return 'Still finding its style';
      if(lead[0]==='bold')return second[0]==='patient'?'Calculated attacker':second[0]==='curious'?'Fearless explorer':'Tactical challenger';
      if(lead[0]==='curious')return second[0]==='patient'?'Methodical explorer':second[0]==='bold'?'Curious opportunist':'Curious explorer';
      return second[0]==='bold'?'Calm tactician':second[0]==='curious'?'Thoughtful learner':'Patient planner';
    }

    orderMoves(chess,moves,ttMove=null,usePolicy=true,heuristics=null,ply=0,accumulator=null){
      // Policy inference is deliberately concentrated near the root. At deep
      // nodes and in quiescence, TT/MVV-LVA/killer/history ordering is cheaper
      // and avoids re-running the neural policy head for every capture leaf.
      const positionFeatures=usePolicy?(accumulator?Array.from(accumulator[chess.turn()].features):this.extractFeatures(chess,chess.turn())):null;
      const cachedForward=usePolicy&&accumulator?this.forwardFromAccumulator(accumulator,chess.turn()):null;
      const priors=usePolicy?this.policyDistribution(positionFeatures,moves,chess.turn(),cachedForward):new Map();
      const remembered=this.searchMemoryEnabled?this.data.memory[this.simplifyFen(chess.fen())]||{}:{};
      const side=chess.turn(),killerList=heuristics?.killers?.[ply]||[];
      return moves.sort((a,b)=>{
        const pieceValue={p:100,n:320,b:330,r:500,q:900,k:20000};
        const score=move=>{
          let value=0;if(ttMove&&move.uci===ttMove)value+=100000;
          if(move.captured){
            const victim=pieceValue[move.captured]||0,attacker=pieceValue[move.piece]||0;
            value+=10000+victim*10-attacker;
          }
          if(move.promotion)value+=8000+(pieceValue[move.promotion]||0);
          if(!move.captured&&!move.promotion&&heuristics){
            const killerIndex=killerList.indexOf(move.uci);
            if(killerIndex===0)value+=9000;else if(killerIndex===1)value+=8000;
            value+=Math.min(3000,heuristics.history.get(`${side}:${move.uci}`)||0);
          }
          const memory=remembered[move.uci];if(memory)value+=memory.score*4;
          value+=(priors.get(move.uci)||0)*760;
          return value;
        };
        return score(b)-score(a);
      });
    }

    chooseMove(chess,options={}){
      // V14 search uses its own FastBoard from the first position check onward.
      // Keep ChessCore as the canonical UI/adapter/.chelo implementation and as
      // the fallback search path when the worker engine is deliberately disabled.
      const fastSearch=root.CheloFastSearch||root.ChesslingFastSearch;
      if(options.fastSearch!==false&&fastSearch)return fastSearch.search(this,chess,options);
      if(chess.game_over())return {move:null,depth:0,nodes:0,drawNodes:0,score:0,terminal:true};
      const legal=chess.moves({verbose:true,skipSan:true});if(!legal.length)return {move:null,depth:0,nodes:0,drawNodes:0,score:null,terminal:true};
      const start=now(),timeLimit=Math.max(50,Number(options.timeMs)||420),nodeLimit=Math.max(1000,Number(options.nodeLimit)||30000),maxDepth=clamp(Math.floor(Number(options.maxDepth)||6),1,12),usePolicy=options.usePolicy!==false,policyPlyLimit=clamp(Math.floor(Number(options.policyPlyLimit===undefined?2:options.policyPlyLimit)||0),0,8),useHistory=options.useHistory!==false,incremental=options.incremental!==false,usePvs=options.usePvs!==false;
      this.searchMemoryEnabled=Object.keys(this.data.memory||{}).length>0;
      // A loaded Polyglot book is searched before the timed tree. A verified
      // legal hit returns immediately without spending a search millisecond.
      const bookKey=polyglotHash(chess),bookMove=polyglotBookLookup(options.bookBinary,bookKey,legal);
      if(bookMove)return {move:bookMove,depth:0,nodes:0,drawNodes:0,score:null,elapsed:now()-start,nps:0,book:true,bookLookup:'binary-search'};
      const memoryKey=this.simplifyFen(chess.fen()),remembered=this.data.memory[memoryKey]||{};
      const table=new TypedTranspositionTable(TT_SIZE);const INF=SEARCH_INF,rootKey=bookKey;let nodes=0,drawNodes=0,stopped=false;const deadline=start+timeLimit;
      const heuristics={killers:Array.from({length:maxDepth+16},()=>[]),history:new Map()};
      const rootAccumulator=incremental?this.makeSearchAccumulator(chess):null;
      const accumulatorPush=(acc,position,move)=>incremental?this.applySearchAccumulator(acc,position,move):null;
      const accumulatorPop=(acc,undo)=>{if(incremental)this.restoreSearchAccumulator(acc,undo);};
      const rememberQuietCutoff=(move,depth,ply,side)=>{
        if(move.captured||move.promotion)return;
        const list=heuristics.killers[ply]||(heuristics.killers[ply]=[]);
        if(list[0]!==move.uci){list.unshift(move.uci);list.length=Math.min(2,list.length);}
        const key=`${side}:${move.uci}`,next=(heuristics.history.get(key)||0)+depth*depth*16;heuristics.history.set(key,Math.min(50000,next));
      };
      const terminal=(position,moves,ply)=>!moves.length?(position.inCheck()?-MATE_SCORE+ply:0):null;
      const mopUpBonus=position=>{
        const board=position.s.b;let ownKing=-1,enemyKing=-1,ownMaterial=0,enemyMaterial=0;
        for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=board[sq];if(!p)continue;
          const type=p.toLowerCase(),value=type==='q'?900:type==='r'?500:type==='b'?330:type==='n'?320:type==='p'?100:0;
          if(type==='k'){if(p===position.turn().toUpperCase())ownKing=sq;else enemyKing=sq;}
          else if(p===position.turn())ownMaterial+=value;else enemyMaterial+=value;
        }
        if(enemyKing<0||ownKing<0||ownMaterial<=enemyMaterial+250)return 0;
        const file=enemyKing&7,rank=enemyKing>>4,edge=Math.min(file,7-file,rank,7-rank);
        const cornerPressure=(7-edge)*7;
        const kingDistance=Math.abs((ownKing&7)-file)+Math.abs((ownKing>>4)-rank);
        return Math.max(0,cornerPressure+Math.max(0,12-kingDistance)*2);
      };
      const evaluateForTurn=(position,acc)=>{
        const value=acc?this.forwardValueFromAccumulator(acc,position.turn()):this.evaluate(position,position.turn());
        return Math.round(value*1000)+mopUpBonus(position);
      };
      const isSearchDraw=position=>{
        const key=position.positionKey(),draw=position.s.half>=150||position.insufficient()||position.positions.filter(item=>item===key).length>=3;
        if(draw)drawNodes++;return draw;
      };
      const hasNonPawnMaterial=position=>{
        const b=position.s.b;for(let i=0;i<128;i++){if(i&0x88){i+=7;continue;}const p=b[i];if(p&&p.toLowerCase()!=='k'&&p.toLowerCase()!=='p')return true;}return false;
      };
      const quiescence=(position,alpha,beta,ply,qDepth,acc)=>{
        nodes++;if(nodes>=nodeLimit||now()>=deadline){stopped=true;return evaluateForTurn(position,acc);}
        const inCheck=position.inCheck(),all=position.moves({verbose:true,skipSan:true}),end=terminal(position,all,ply);if(end!==null)return end;
        if(isSearchDraw(position))return 0;
        const stand=evaluateForTurn(position,acc);
        if(!inCheck){if(stand>=beta)return beta;if(stand>alpha)alpha=stand;if(qDepth<=0)return stand;}
        else if(qDepth<=-6){let best=-INF;for(const move of all){position.move(move.uci,{skipSan:true});const accUndo=accumulatorPush(acc,position,move),score=isSearchDraw(position)?0:-evaluateForTurn(position,acc);position.undo();accumulatorPop(acc,accUndo);best=Math.max(best,score);}return best;}
        const candidates=inCheck?all:all.filter(m=>m.captured||m.promotion),ordered=this.orderMoves(position,candidates,null,false,useHistory?heuristics:null,ply,acc);let best=inCheck?-INF:stand;
        for(const move of ordered){if(stopped)break;position.move(move.uci,{skipSan:true});const accUndo=accumulatorPush(acc,position,move);const score=-quiescence(position,-beta,-alpha,ply+1,qDepth-1,acc);position.undo();accumulatorPop(acc,accUndo);best=Math.max(best,score);alpha=Math.max(alpha,score);if(alpha>=beta)break;}
        return best;
      };
      const negamax=(position,depth,alpha,beta,ply,acc,allowNull=true)=>{
        nodes++;if(nodes>=nodeLimit||now()>=deadline){stopped=true;return evaluateForTurn(position,acc);}
        const moves=position.moves({verbose:true,skipSan:true}),end=terminal(position,moves,ply);if(end!==null)return end;
        if(isSearchDraw(position))return 0;
        if(depth<=0)return quiescence(position,alpha,beta,ply,5,acc);
        const key=polyglotHash(position),alphaOriginal=alpha,betaOriginal=beta,repetitionCount=position.positions.filter(item=>item===position.positionKey()).length;
        // Halfmove and repetition are path-sensitive but not part of Polyglot's
        // key. Disable score cutoffs near automatic draw boundaries / repetitions.
        const pathSensitive=position.s.half>=135||repetitionCount>1;
        const cached=table.probe(key,depth,alpha,beta,ply);let ttMove=cached.move;
        if(cached.hit&&!pathSensitive&&cached.cutoff)return cached.score;
        const inCheck=position.inCheck(),pvNode=beta-alpha>1;
        // Null move (R=2): no check, no PV node, no consecutive nulls, and no
        // king+pawn-only ending where zugzwang is a realistic risk.
        if(allowNull&&depth>=3&&!inCheck&&!pvNode&&hasNonPawnMaterial(position)){
          const saved=position.s;position.s={...saved,t:saved.t==='w'?'b':'w',ep:-1,half:saved.half+1};
          position.positions.push(position.positionKey());const nullUndo=accumulatorPush(acc,position,null);
          const nullScore=-negamax(position,depth-1-2,-beta,-beta+1,ply+1,acc,false);
          position.positions.pop();position.s=saved;accumulatorPop(acc,nullUndo);
          if(stopped)return nullScore;
          if(nullScore>=beta){
            // Deep fail-high verification reduces zugzwang/mate-window false cuts.
            if(depth>=6){const verify=negamax(position,depth-1-2,beta-1,beta,ply,acc,false);if(verify<beta)return verify;}
            return nullScore;
          }
        }
        const side=position.turn(),ordered=this.orderMoves(position,moves,ttMove,false,useHistory?heuristics:null,ply,acc);let best=-INF,bestMove=null,moveIndex=0;
        for(const move of ordered){
          if(stopped)break;
          const quiet=!move.captured&&!move.promotion,reduce=quiet&&!inCheck&&depth>=3&&moveIndex>=3?(depth>=6&&moveIndex>=8?2:1):0;
          position.move(move.uci,{skipSan:true});const accUndo=accumulatorPush(acc,position,move);let score;
          if(moveIndex===0||!usePvs){score=-negamax(position,depth-1,-beta,-alpha,ply+1,acc,true);}
          else{
            // LMR scouts late quiet moves at reduced depth; every fail-high is
            // re-searched at full depth before it can affect the principal line.
            score=-negamax(position,depth-1-reduce,-alpha-1,-alpha,ply+1,acc,true);
            if(!stopped&&score>alpha)score=-negamax(position,depth-1,-beta,-alpha,ply+1,acc,true);
          }
          position.undo();accumulatorPop(acc,accUndo);moveIndex++;
          if(score>best){best=score;bestMove=move.uci;}
          if(score>alpha)alpha=score;
          if(alpha>=beta){if(useHistory)rememberQuietCutoff(move,depth,ply,side);break;}
        }
        if(best===-INF)best=evaluateForTurn(position,acc);
        if(!pathSensitive){const flag=best<=alphaOriginal?TT_ALPHA:best>=betaOriginal?TT_BETA:TT_EXACT;table.store(key,depth,best,flag,bestMove,ply);}
        return best;
      };
      let rootResults=legal.map(move=>({move:move.uci,score:-INF})),completedDepth=0,previousBest=null;
      for(let depth=1;depth<=maxDepth;depth++){
        if(stopped)break;
        const rootCached=table.probe(rootKey,depth,-INF,INF,0),rootHashMove=rootCached.move||previousBest;
        const ordered=this.orderMoves(chess,legal.slice(),rootHashMove,usePolicy,useHistory?heuristics:null,0,rootAccumulator),iteration=[];
        let rootAlpha=-INF,bestRootResult=null;
        for(let index=0;index<ordered.length;index++){
          if(stopped)break;const move=ordered[index];chess.move(move.uci,{skipSan:true});const accUndo=accumulatorPush(rootAccumulator,chess,move);let score;
          if(index===0||!options.rootPvs)score=-negamax(chess,depth-1,-INF,INF,1,rootAccumulator,true);
          else{score=-negamax(chess,depth-1,-rootAlpha-1,-rootAlpha,1,rootAccumulator,true);if(!stopped&&score>rootAlpha)score=-negamax(chess,depth-1,-INF,-rootAlpha,1,rootAccumulator,true);}
          chess.undo();accumulatorPop(rootAccumulator,accUndo);iteration.push({move:move.uci,score});
          if(score>rootAlpha){rootAlpha=score;previousBest=move.uci;bestRootResult={move:move.uci,score};}
        }
        if(!stopped&&iteration.length===legal.length&&bestRootResult){rootResults=[bestRootResult,...iteration.filter(item=>item.move!==bestRootResult.move)];completedDepth=depth;previousBest=bestRootResult.move;table.store(rootKey,depth,bestRootResult.score,TT_EXACT,bestRootResult.move,0);}
        if(now()>=deadline||nodes>=nodeLimit)break;
      }
      if(completedDepth===0){rootResults=legal.map(move=>{chess.move(move.uci,{skipSan:true});const accUndo=accumulatorPush(rootAccumulator,chess,move);const score=-evaluateForTurn(chess,rootAccumulator);chess.undo();accumulatorPop(rootAccumulator,accUndo);return {move:move.uci,score};});rootResults.sort((a,b)=>b.score-a.score);}
      const rootFeatures=incremental?Array.from(rootAccumulator[chess.turn()].features):this.extractFeatures(chess,chess.turn()),rootPolicy=usePolicy?this.policyDistribution(rootFeatures,legal,chess.turn(),incremental?this.forwardFromAccumulator(rootAccumulator,chess.turn()):null):new Map();
      const elapsed=Math.max(1,now()-start),result={move:rootResults[0]?.move||legal[0].uci,depth:completedDepth,nodes,drawNodes,score:rootResults[0]?.score??null,elapsed,nps:Math.round(nodes*1000/elapsed),interrupted:stopped,policyPrior:rootPolicy.get(rootResults[0]?.move||legal[0].uci)||0,pvs:usePvs,historyOrdering:useHistory,rootPvs:options.rootPvs!==false,incremental,ttHits:table.hits,ttStores:table.stores,ttSize:TT_SIZE,nullMovePruning:true,lmr:true,policyPlyLimit};
      this.lastSearch=result;return result;
    }

    dualNnueState(fen){
      const model=root.CheloDualNNUE?.model,C=Core();
      if(!model||!C)return null;
      let chess;try{chess=new C(fen);}catch{return null;}
      const board=chess.board(),white=new Int32Array(32),black=new Int32Array(32);
      for(let h=0;h<32;h++){
        let dw=0,db=0;
        for(const adapter of [this.data.dualLora.bond,this.data.dualLora.arena]){
          let bondW=0,bondB=0;
          for(let k=0;k<adapter.rank;k++){bondW+=adapter.aW[h*adapter.rank+k]*adapter.b[k];bondB+=adapter.aB[h*adapter.rank+k]*adapter.b[k];}
          dw+=bondW>>adapter.shift;db+=bondB>>adapter.shift;
        }
        white[h]=clamp(model.whiteB[h]+dw,-32768,32767);
        black[h]=clamp(model.blackB[h]+db,-32768,32767);
      }
      // C++ applies the adapter delta first, then adds every piece row with
      // signed-16-bit saturation. Mirror that ordering exactly.
      for(let r=0;r<8;r++)for(let c=0;c<8;c++){
        const piece=board[r][c];if(!piece)continue;
        const sq=r*8+c,type=TYPE_CODE[piece.type],isWhite=piece.color==='w';
        const whiteCode=isWhite?type:type+6,blackCode=isWhite?type+6:type;
        const wr=(sq*12+whiteCode-1)*32,br=((sq^56)*12+blackCode-1)*32;
        for(let h=0;h<32;h++){white[h]=clamp(white[h]+model.whiteW[wr+h],-32768,32767);black[h]=clamp(black[h]+model.blackW[br+h],-32768,32767);}
      }
      const side=chess.turn()==='b'?1:0,stm=side?black:white,nstm=side?white:black;
      const gradStm=new Float32Array(32),gradNstm=new Float32Array(32),factor=1000/model.outputDivisor;
      let sum=model.outputB;
      for(let h=0;h<32;h++){
        const x=clamp(stm[h],0,255),y=clamp(nstm[h],0,255),ow=model.outputW[h],on=model.outputW[h+32];
        sum+=x*x*ow+y*y*on;gradStm[h]=2*x*ow*factor;gradNstm[h]=2*y*on*factor;
      }
      return {score:Math.round(sum*factor),side,gradWhite:side?gradNstm:gradStm,gradBlack:side?gradStm:gradNstm};
    }

    trainDualAdapter(fen,target,petSide='b',layer='bond',importance=1,tactical=false){
      const adapter=this.data.dualLora?.[layer];if(!adapter)return {trained:false,reason:'unknown-layer'};
      const state=this.dualNnueState(fen);if(!state)return {trained:false,reason:'shared-v37-unavailable'};
      // The V37 evaluator is expressed from side-to-move. Convert the final
      // outcome into that same perspective, then perform bounded sign-SGD on
      // the low-rank integer adapter. No shared model weights are modified.
      const signedTarget=(state.side===(petSide==='b'?1:0)?target:-target),targetCp=signedTarget*220,error=targetCp-state.score;
      if(Math.abs(error)<8)return {trained:false,reason:'small-residual',score:state.score};
      const rank=adapter.rank,channels=rank===2?(tactical?2:1):1;
      adapter.shift=6;adapter.b[0]=64;if(rank===2)adapter.b[1]=64;
      const updates=[];
      const apply=(weights,gradient,channel,count)=>{
        const ranked=Array.from({length:32},(_,h)=>({h,g:gradient[h],magnitude:Math.abs(gradient[h])})).sort((a,b)=>b.magnitude-a.magnitude).slice(0,count);
        for(const item of ranked){if(item.magnitude<0.025)continue;const index=item.h*rank+channel,delta=Math.sign(error*item.g);if(!delta)continue;const before=weights[index];weights[index]=clamp(before+delta,-48,48);if(weights[index]!==before)updates.push({channel,h:item.h,delta});}
      };
      apply(adapter.aW,state.gradWhite,0,channels===2?3:4);
      apply(adapter.aB,state.gradBlack,0,channels===2?3:4);
      if(channels===2){apply(adapter.aW,state.gradWhite,1,2);apply(adapter.aB,state.gradBlack,1,2);}
      if(updates.length){adapter.steps=Math.min(65535,(adapter.steps||0)+1);}
      return {trained:updates.length>0,updates:updates.length,score:state.score,target:targetCp,layer};
    }

    outcomeFor(item,winner){return winner==='draw'?0:winner===item.side?0.95:-0.95;}

    reinforce(outcome,finalPosition=null,context={}){
      if(outcome==='practice')return {trained:false,reason:'practice-disabled'};
      if(context?.layer==='arena')return {trained:false,reason:'arena-attestation-required'};
      const result=finalPosition&&typeof finalPosition.result==='function'?finalPosition.result():null;
      const winner=result==='w'||result==='b'?result:result==='draw'?'draw':(outcome==='win'?'b':outcome==='loss'?'w':'draw');
      const layer='bond';
      const training={updatedPositions:0,updatedCoefficients:0,skippedPositions:0,skipReasons:{}};
      {
        for(const item of this.data.pending){
          const target=this.outcomeFor(item,winner),entry=this.entry(item.f,item.m),importance=1+Math.min(0.5,(Number(entry.tactical)||0)/20);
          const update=this.trainDualAdapter(item.f,target,item.side,layer,importance,(Number(entry.tactical)||0)>0);
          if(update?.trained){training.updatedPositions++;training.updatedCoefficients+=Number(update.updates)||0;}
          else{training.skippedPositions++;const reason=update?.reason||'no-coefficient-change';training.skipReasons[reason]=(training.skipReasons[reason]||0)+1;}
          entry.score=clamp(entry.score+(target>0?4:target<0?-4:1),-100,100);
          entry.outcomes++;
          entry.last=now();
        }
        this.data.games++;
        if(outcome==='win')this.data.wins++;else if(outcome==='loss')this.data.losses++;else this.data.draws++;
        this.data.xp=Math.max(0,this.data.xp)+Math.max(1,this.data.pending.length);
        this.data.gen=1+Math.floor(this.data.xp/80);
      }
      const memory=this.recordMatchMemory(outcome,finalPosition);
      const challenge=this.updateAdaptiveChallenge(outcome);
      this.data.pending=[];
      this.save();
      return {trained:training.updatedPositions>0,layer:'bond',memory,updates:this.data.dualLora.bond.steps,challenge,...training};
    }

    resetPending(){this.data.pending=[];this.data.geneticTrace={p:0,n:0,b:0,r:0,q:0};this.data.lastHumanMove=null;this.save();}

    importCompactData(compact){
      const expanded=this.expandData(compact);
      if(!expanded||typeof expanded!=='object'||!expanded.memory||!expanded.petName)throw new Error('Invalid compact Chelo pet record.');
      const incoming=this.normalise(expanded);
      incoming.model=this.data.model;
      incoming.v14Adapter=null;
      const previous=this.data;this.data=incoming;this.v14Adapter=freshV14Adapter();
      try{if(!this.save())throw new Error('Chelo could not save the imported pet record.');}
      catch(error){this.data=previous;throw error;}
      return true;
    }

    // Migration-only compatibility: the app no longer imports or exports .soul files.
    importSoul(object){
      const source=object?.pet||object;
      if(source?.v===16)return this.importCompactData(source);
      const expanded=this.expandData(source);
      if(!expanded||typeof expanded!=='object'||!expanded.memory)throw new Error('This legacy save cannot be migrated.');
      const incoming=this.normalise(expanded);incoming.model=this.data.model;incoming.v14Adapter=null;
      this.data=incoming;this.v14Adapter=freshV14Adapter();this.save();return object?.activeMatch||null;
    }

  }

  root.CheloBrain=CheloBrain;
  root.ChesslingBrain=CheloBrain; // Backward-compatible V15 runtime API.
  root.CheloPolyglotHash=polyglotHash;
  root.ChesslingPolyglotHash=polyglotHash;
  root.CheloPolyglotBookLookup=polyglotBookLookup;
  root.ChesslingPolyglotBookLookup=polyglotBookLookup;
  root.ChesslingTypedTranspositionTable=TypedTranspositionTable;
  root.CHELO_BRAIN_LIMIT=FREE_LIMIT;
  root.CHESSLING_BRAIN_LIMIT=FREE_LIMIT;
  root.CHELO_FREE_BRAIN_LIMIT=FREE_LIMIT;
  root.CHESSLING_FREE_BRAIN_LIMIT=FREE_LIMIT;
  root.CHELO_PRO_BRAIN_LIMIT=PRO_LIMIT;
  root.CHESSLING_PRO_BRAIN_LIMIT=PRO_LIMIT;
  root.CHELO_MODEL_INPUTS=FEATURES;
  root.CHESSLING_MODEL_INPUTS=FEATURES;
  root.CHELO_MODEL_VECTOR_SIZE=VECTOR_SIZE;
  root.CHESSLING_MODEL_VECTOR_SIZE=VECTOR_SIZE;
  root.CHELO_MODEL_HIDDEN=HIDDEN;
  root.CHESSLING_MODEL_HIDDEN=HIDDEN;
  root.CHELO_PET_RECORD_VERSION=16;
  root.CHELO_SAVE_FORMAT_VERSION=1;
  root.CHESSLING_V14_LORA_RANK=V14_RANK;
  root.CHESSLING_MODEL_PARAMETERS=FEATURES*HIDDEN+HIDDEN+(HIDDEN*HIDDEN)+HIDDEN+(3*HIDDEN)+3+(64*HIDDEN*2)+(6*HIDDEN)+(5*HIDDEN)+64+64+6+5+(64*POLICY_RANK*2)+(HIDDEN*POLICY_RANK);
})();
