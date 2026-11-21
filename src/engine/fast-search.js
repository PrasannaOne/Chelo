/*
 * Chelo FastBoard search path.
 * Search-only 0x88 mailbox, packed moves, typed undo/accumulator frames,
 * paired-word Zobrist repetition accounting, and a preallocated recursive hot path.
 * Source-level object/array churn is avoided; V8 runtime allocation is audited separately.
 * ChessCore remains the public UI/adapter/.chelo compatibility implementation.
 */
(() => {
  'use strict';
  const root = typeof self !== 'undefined' ? self : globalThis;
  const MAX_PLY = 128;
  const MAX_MOVES = 256;
  const UNDO_FEATURES_PER_PLY = 48;
  const TT_SIZE = 1 << 18;
  const EVAL_CACHE_SIZE=1<<16;
  const EVAL_KEYS=new Uint16Array(EVAL_CACHE_SIZE*6),EVAL_SCORES=new Int32Array(EVAL_CACHE_SIZE),EVAL_TAGS=new Uint8Array(EVAL_CACHE_SIZE);
  let EVAL_GENERATION=0;
  const INF = 32000;
  const NEG_INF = -32000;
  const MATE = 30000;
  const NEG_MATE = -30000;
  // Precomputed exact mate-distance scores avoid a cold generic ADD feedback
  // site on the rare quiescence checkmate path (V8 deopt at bytecode offset 166).
  const FLAG_EP = 1, FLAG_CASTLE_K = 2, FLAG_CASTLE_Q = 4, FLAG_DOUBLE = 8;
  const KNIGHT = new Int8Array([-33,-31,-18,-14,14,18,31,33]);
  const DIAG = new Int8Array([-17,-15,15,17]);
  const ORTH = new Int8Array([-16,-1,1,16]);
  const KING = new Int8Array([-17,-16,-15,-1,1,15,16,17]);
  const M88 = new Int16Array(64);
  const S64 = new Int8Array(128); S64.fill(-1);
  for (let s=0;s<64;s++){const sq=((s>>3)<<4)+(s&7);M88[s]=sq;S64[sq]=s;}
  // Reverse attack-source tables preserve the original mailbox offset order.
  const PAWN_SOURCES=new Int16Array(64*4);PAWN_SOURCES.fill(-1);
  const KNIGHT_SOURCES=new Int16Array(64*8);KNIGHT_SOURCES.fill(-1);
  const KING_SOURCES=new Int16Array(64*8);KING_SOURCES.fill(-1);
  for(let target64=0;target64<64;target64++){const target=M88[target64],base=target64*4;
    let a=target+16; if(!(a&0x88)){if(!((a-1)&0x88))PAWN_SOURCES[base]=a-1;if(!((a+1)&0x88))PAWN_SOURCES[base+1]=a+1;}
    a=target-16; if(!(a&0x88)){if(!((a-1)&0x88))PAWN_SOURCES[base+2]=a-1;if(!((a+1)&0x88))PAWN_SOURCES[base+3]=a+1;}
    for(let i=0;i<8;i++){a=target+KNIGHT[i];if(!(a&0x88))KNIGHT_SOURCES[target64*8+i]=a;a=target+KING[i];if(!(a&0x88))KING_SOURCES[target64*8+i]=a;}
  }
  const VALUES = new Int16Array([0,100,320,330,500,900,20000]);
  const RIGHT_K=1,RIGHT_Q=2,RIGHT_k=4,RIGHT_q=8;
  const TYPE = p => ((p-1)%6)+1;
  const color = p => p===0?-1:(p<=6?0:1);
  const codeOf = ch => {
    if (!ch || ch==='.') return 0;
    const lower=ch.toLowerCase(),t=lower==='p'?1:lower==='n'?2:lower==='b'?3:lower==='r'?4:lower==='q'?5:6;
    return ch===ch.toUpperCase()?t:t+6;
  };
  const sq64 = sq88 => ((sq88>>4)<<3)+(sq88&7);
  const clamp=(n,a,b)=>n<a?a:n>b?b:n;
  // Date.now() is a primitive-returning clock; avoid per-call Performance API wrappers in the node loop.
  const now=()=>Date.now()|0;
  // Search evaluation is fixed-point only. Model tensors stay frozen Float32/JS data;
  // a search-local quantised copy is built once before iterative deepening.
  const Q1=8192,Q2=4096,QOUT=8192,TANH_Q=32767;
  const TANH_Q_TABLE=new Int16Array(16385);
  for(let i=0;i<TANH_Q_TABLE.length;i++)TANH_Q_TABLE[i]=Math.round(Math.tanh((i-8192)/1024)*TANH_Q)|0;
  const EXP_Q_TABLE=new Uint16Array(3073);
  for(let i=0;i<EXP_Q_TABLE.length;i++)EXP_Q_TABLE[i]=Math.round(Math.exp(-12+i/256)*TANH_Q)|0;
  function tanhQ1(x){if(x<=-8*Q1)return -TANH_Q;if(x>=8*Q1)return TANH_Q;return TANH_Q_TABLE[((x>>3)+8192)|0]|0;}
  function tanhQ2(x){if(x<=-8*Q2)return -TANH_Q;if(x>=8*Q2)return TANH_Q;return TANH_Q_TABLE[((x>>2)+8192)|0]|0;}
  function expQOut(delta){if(delta<=-12*QOUT)return 0;if(delta>=0)return TANH_Q;return EXP_Q_TABLE[((delta+12*QOUT)>>5)|0]|0;}
  // Exact truncating integer division for the bounded scalar head numerator.
  // |numerator| <= 32,767,000 and denominator <= 98,301, so the restoring
  // divider stays inside signed-Smi ranges and does not create a float result.
  function divScalar31(numerator,denominator){
    numerator|=0;denominator|=0;if(denominator<=0)return 0;
    const negative=numerator<0;let n=negative?-numerator:numerator,q=0,r=0;
    for(let bit=24;bit>=0;bit--){r=((r<<1)|((n>>>bit)&1))|0;if(r>=denominator){r=(r-denominator)|0;q=(q|(1<<bit))|0;}}
    return q===0?0:(negative?-q:q);
  }
  // 2-ply continuation history uses previous (piece,to88) and current (piece,to64).
  // Shared typed tables are reused across serial Worker searches.
  const COUNTERMOVE=new Int32Array(16*128);
  const CONT_HISTORY=new Int16Array((16*128)*(12*64));

  // 64-bit Zobrist keys are represented as four 16-bit Smi-safe words.
  // Keeping each live JS number in [0,65535] avoids V8 HeapNumber boxing
  // when incremental XOR updates cross the signed-31-bit Smi boundary.
  const zPieceLo0=new Uint16Array(12*64),zPieceLo1=new Uint16Array(12*64);
  const zPieceHi0=new Uint16Array(12*64),zPieceHi1=new Uint16Array(12*64);
  const zRightsLo0=new Uint16Array(16),zRightsLo1=new Uint16Array(16);
  const zRightsHi0=new Uint16Array(16),zRightsHi1=new Uint16Array(16);
  const zEpLo0=new Uint16Array(8),zEpLo1=new Uint16Array(8);
  const zEpHi0=new Uint16Array(8),zEpHi1=new Uint16Array(8);
  let zSeed=0x6d2b79f5;
  function zrand(){zSeed^=zSeed<<13;zSeed^=zSeed>>>17;zSeed^=zSeed<<5;return zSeed|0;}
  function zfill(lo0,lo1,hi0,hi1,i){let v=zrand();lo0[i]=v&65535;lo1[i]=v>>>16;v=zrand();hi0[i]=v&65535;hi1[i]=v>>>16;}
  for(let i=0;i<zPieceLo0.length;i++)zfill(zPieceLo0,zPieceLo1,zPieceHi0,zPieceHi1,i);
  for(let i=0;i<16;i++)zfill(zRightsLo0,zRightsLo1,zRightsHi0,zRightsHi1,i);
  for(let i=0;i<8;i++)zfill(zEpLo0,zEpLo1,zEpHi0,zEpHi1,i);
  let zSideLo0=zrand()&65535,zSideLo1=zSeed>>>16,zSideHi0=zrand()&65535,zSideHi1=zSeed>>>16;
  const rightsFromString=s=>{let r=0;if(s.includes('K'))r|=RIGHT_K;if(s.includes('Q'))r|=RIGHT_Q;if(s.includes('k'))r|=RIGHT_k;if(s.includes('q'))r|=RIGHT_q;return r;};
  const historyKeyScratch=new Uint16Array(4);
  function hashKeyFromPositionKey(key,out){
    let hi0=0,hi1=0,lo0=0,lo1=0;const space=key.indexOf(' '),boardText=space<0?key:key.slice(0,space),parts=key.slice(space+1).split(' ');
    for(let s=0;s<64;s++){const piece=codeOf(boardText[s]);if(piece){const i=(piece-1)*64+s;hi0^=zPieceHi0[i];hi1^=zPieceHi1[i];lo0^=zPieceLo0[i];lo1^=zPieceLo1[i];}}
    if(parts[0]==='b'){hi0^=zSideHi0;hi1^=zSideHi1;lo0^=zSideLo0;lo1^=zSideLo1;}
    const rights=rightsFromString(parts[1]||'-');hi0^=zRightsHi0[rights];hi1^=zRightsHi1[rights];lo0^=zRightsLo0[rights];lo1^=zRightsLo1[rights];
    const ep=parts[2]&&parts[2]!=='-'?parts[2].charCodeAt(0)-97:-1;
    if(ep>=0){hi0^=zEpHi0[ep];hi1^=zEpHi1[ep];lo0^=zEpLo0[ep];lo1^=zEpLo1[ep];}
    out[0]=hi0;out[1]=hi1;out[2]=lo0;out[3]=lo1;
  }

  class RepetitionTable {
    constructor(capacity=8192){this.mask=capacity-1;this.hi0=new Uint16Array(capacity);this.hi1=new Uint16Array(capacity);this.lo0=new Uint16Array(capacity);this.lo1=new Uint16Array(capacity);this.counts=new Uint16Array(capacity);this.state=new Uint8Array(capacity);}
    slot(hi0,hi1,lo0,lo1){return (lo0^(lo1<<1)^(hi0<<2)^(hi1<<3))&this.mask;}
    add(hi0,hi1,lo0,lo1){let i=this.slot(hi0,hi1,lo0,lo1),first=-1;for(let n=0;n<=this.mask;n++,i=(i+1)&this.mask){const st=this.state[i];if(st===1){if(this.hi0[i]===hi0&&this.hi1[i]===hi1&&this.lo0[i]===lo0&&this.lo1[i]===lo1){if(this.counts[i]<65535)this.counts[i]++;return;}}else if(st===2){if(first<0)first=i;}else{const at=first>=0?first:i;this.state[at]=1;this.hi0[at]=hi0;this.hi1[at]=hi1;this.lo0[at]=lo0;this.lo1[at]=lo1;this.counts[at]=1;return;}}if(first>=0){this.state[first]=1;this.hi0[first]=hi0;this.hi1[first]=hi1;this.lo0[first]=lo0;this.lo1[first]=lo1;this.counts[first]=1;}}
    remove(hi0,hi1,lo0,lo1){let i=this.slot(hi0,hi1,lo0,lo1);for(let n=0;n<=this.mask;n++,i=(i+1)&this.mask){const st=this.state[i];if(st===0)return;if(st===1&&this.hi0[i]===hi0&&this.hi1[i]===hi1&&this.lo0[i]===lo0&&this.lo1[i]===lo1){if(this.counts[i]>1)this.counts[i]--;else{this.counts[i]=0;this.state[i]=2;}return;}}}
    get(hi0,hi1,lo0,lo1){let i=this.slot(hi0,hi1,lo0,lo1);for(let n=0;n<=this.mask;n++,i=(i+1)&this.mask){const st=this.state[i];if(st===0)return 0;if(st===1&&this.hi0[i]===hi0&&this.hi1[i]===hi1&&this.lo0[i]===lo0&&this.lo1[i]===lo1)return this.counts[i];}return 0;}
  }

  class FastBoard {
    constructor(chess, maxPly, model){
      if(maxPly===undefined)maxPly=MAX_PLY;
      this.b=new Int8Array(128);this.side=chess.s.t==='w'?0:1;this.rights=rightsFromString(chess.s.c||'');this.ep=chess.s.ep;this.half=chess.s.half|0;this.full=chess.s.full|0;this.nonKingCount=0;
      this.kingSq=new Int16Array(2);this.kingSq.fill(-1);
      for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=codeOf(chess.s.b[sq]);this.b[sq]=p;if(p===6)this.kingSq[0]=sq;else if(p===12)this.kingSq[1]=sq;else if(p)this.nonKingCount++;}
      this.moveLists=new Array(maxPly);this.moveScores=new Array(maxPly);this.counts=new Uint16Array(maxPly);this.undoCounts=new Uint8Array(maxPly);
      for(let p=0;p<maxPly;p++){this.moveLists[p]=new Int32Array(MAX_MOVES);this.moveScores[p]=new Int32Array(MAX_MOVES);}
      // SEE scratch is board-owned and reused; see() never allocates or recurses.
      this.seeGain=new Int32Array(40);this.seeFrom=new Int16Array(40);this.seePiece=new Int8Array(40);
      this.uPiece=new Int8Array(maxPly);this.uCaptured=new Int8Array(maxPly);this.uFrom=new Int8Array(maxPly);this.uTo=new Int8Array(maxPly);this.uCaptureSq=new Int8Array(maxPly);
      this.uRights=new Uint8Array(maxPly);this.uEp=new Int8Array(maxPly);this.uHalf=new Uint16Array(maxPly);this.uFull=new Uint16Array(maxPly);this.uSide=new Uint8Array(maxPly);
      this.uHashHi0=new Uint16Array(maxPly);this.uHashHi1=new Uint16Array(maxPly);this.uHashLo0=new Uint16Array(maxPly);this.uHashLo1=new Uint16Array(maxPly);this.uHashEp=new Int8Array(maxPly);this.uKingW=new Int8Array(maxPly);this.uKingB=new Int8Array(maxPly);
      this.uRookFrom=new Int8Array(maxPly);this.uRookTo=new Int8Array(maxPly);this.uRookPiece=new Int8Array(maxPly);this.uAccDirty=new Uint8Array(maxPly);this.uAccApplied=new Uint8Array(maxPly);this.lazyAccumulator=true;this.maxPendingAccumulator=0;this.uNull=new Uint8Array(maxPly);this.uRepAdded=new Uint8Array(maxPly);this.uNonKingCount=new Uint8Array(maxPly);this.prevMoveClass=new Int16Array(maxPly);
      this.fUndoSide=new Int8Array(maxPly*UNDO_FEATURES_PER_PLY);this.fUndoIndex=new Int16Array(maxPly*UNDO_FEATURES_PER_PLY);this.fUndoBefore=new Uint8Array(maxPly*UNDO_FEATURES_PER_PLY);this.fUndoAfter=new Uint8Array(maxPly*UNDO_FEATURES_PER_PLY);this.fUndoGlobal=new Uint8Array(maxPly*UNDO_FEATURES_PER_PLY);
      this.accFeaturesW=new Uint8Array(80);this.accFeaturesB=new Uint8Array(80);this.accPreW=new Int32Array(48);this.accPreB=new Int32Array(48);this.changedSquares=new Int16Array(maxPly*5);
      // Stage 3.6: two independent 32-unit perspectives and 128 preallocated ply frames.
      this.dualAccW=new Int16Array(128*32);this.dualAccB=new Int16Array(128*32);
      this.dualFeaturesW=new Uint8Array(64);this.dualFeaturesB=new Uint8Array(64);
      this.dualUndoCount=new Uint8Array(maxPly);this.dualUndoSide=new Int8Array(maxPly*10);this.dualUndoIndex=new Int8Array(maxPly*10);this.dualUndoBefore=new Uint8Array(maxPly*10);
      this.dualBiasW=new Int16Array(32);this.dualBiasB=new Int16Array(32);this.dualModel=null;this.dualReady=false;this.dualEvalCount=0;this.dualMaxAbsAccumulator=0;
      this.qW1=QMODEL_W1;this.qB1=QMODEL_B1;this.qW2=QMODEL_W2;this.qB2=QMODEL_B2;this.qWOut=QMODEL_WOUT;this.qBOut=QMODEL_BOUT;this.qModelReady=false;
      this.hashHi0=0;this.hashHi1=0;this.hashLo0=0;this.hashLo1=0;this.hashEp=-1;this.nullDepth=0;this.computeHash();
      this.rep=new RepetitionTable(8192);this.model=model||null;
      const history=Array.isArray(chess.positions)?chess.positions:null;
      if(history&&history.length){for(let i=0;i<history.length;i++){hashKeyFromPositionKey(history[i],historyKeyScratch);this.rep.add(historyKeyScratch[0],historyKeyScratch[1],historyKeyScratch[2],historyKeyScratch[3]);}}
      else this.rep.add(this.hashHi0,this.hashHi1,this.hashLo0,this.hashLo1);
    }
    get hashHi(){return (this.hashHi1<<16)|this.hashHi0;}
    get hashLo(){return (this.hashLo1<<16)|this.hashLo0;}
    isAttacked(target,by){
      const b=this.b;if(target<0||(target&0x88))return true;const target64=S64[target],pawn=by===0?1:7,base=target64*4,ps=by===0?base:base+2;
      let t=PAWN_SOURCES[ps];if(t>=0&&b[t]===pawn)return true;t=PAWN_SOURCES[ps+1];if(t>=0&&b[t]===pawn)return true;
      const knight=by===0?2:8,kbase=target64*8;for(let i=0;i<8;i++){t=KNIGHT_SOURCES[kbase+i];if(t>=0&&b[t]===knight)return true;}
      const king=by===0?6:12;for(let i=0;i<8;i++){t=KING_SOURCES[kbase+i];if(t>=0&&b[t]===king)return true;}
      for(let i=0;i<8;i++){const d=KING[i];let at=target+d,dist=1;while(!(at&0x88)){const p=b[at];if(p){if(color(p)===by){const ty=TYPE(p);if(ty===5||(ty===4&&(i===1||i===3||i===4||i===6))||(ty===3&&(i===0||i===2||i===5||i===7))||(ty===6&&dist===1))return true;}break;}at+=d;dist++;}}
      return false;
    }
    inCheck(side){if(side===undefined)side=this.side;return this.kingSq[side]<0||this.isAttacked(this.kingSq[side],side^1);}
    effectiveEpFile(){
      if(this.ep<0)return -1;const side=this.side,ep=this.ep,victim=ep+(side===0?16:-16),pawn=side===0?1:7;
      const source0=side===0?ep+15:ep-15,source1=side===0?ep+17:ep-17;
      for(let i=0;i<2;i++){const from=i===0?source0:source1;if(from&0x88||this.b[from]!==pawn)continue;
        const moving=this.b[from],taken=this.b[victim];this.b[from]=0;this.b[victim]=0;this.b[ep]=moving;const safe=!this.inCheck(side);this.b[ep]=0;this.b[victim]=taken;this.b[from]=moving;if(safe)return ep&7;
      }return -1;
    }
    computeHash(){let hi0=0,hi1=0,lo0=0,lo1=0;for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=this.b[sq];if(p){const i=(p-1)*64+S64[sq];hi0^=zPieceHi0[i];hi1^=zPieceHi1[i];lo0^=zPieceLo0[i];lo1^=zPieceLo1[i];}}
      hi0^=zRightsHi0[this.rights];hi1^=zRightsHi1[this.rights];lo0^=zRightsLo0[this.rights];lo1^=zRightsLo1[this.rights];if(this.side){hi0^=zSideHi0;hi1^=zSideHi1;lo0^=zSideLo0;lo1^=zSideLo1;}this.hashEp=this.effectiveEpFile();if(this.hashEp>=0){const ep=this.hashEp;hi0^=zEpHi0[ep];hi1^=zEpHi1[ep];lo0^=zEpLo0[ep];lo1^=zEpLo1[ep];}this.hashHi0=hi0;this.hashHi1=hi1;this.hashLo0=lo0;this.hashLo1=lo1;}
    initAccumulator(model,adapter,isV14){
      this.model=model;
      const dualModel=arguments.length>3?arguments[3]:((root.CheloDualNNUE||root.ChesslingDualNNUE)&&(root.CheloDualNNUE||root.ChesslingDualNNUE).model);
      const dualAdapters=arguments.length>4?arguments[4]:null;
      // Stage 3.6 is a true evaluator replacement: do not quantize, materialize,
      // or incrementally update the legacy 48-unit V14 accumulator when the
      // dual-perspective model is active. This removes duplicate hot-path work.
      if(dualModel){this.qModelReady=false;this.accFeaturesW.fill(0);this.accFeaturesB.fill(0);this.accPreW.fill(0);this.accPreB.fill(0);this.dualReady=false;this.initDualAccumulator(dualModel,dualAdapters);return;}
      this.dualReady=false;ensureQuantizedModel(model,adapter,isV14);
      this.qW1=QMODEL_W1;this.qB1=QMODEL_B1;this.qW2=QMODEL_W2;this.qB2=QMODEL_B2;this.qWOut=QMODEL_WOUT;this.qBOut=QMODEL_BOUT;
      this.qModelReady=true;
      this.accFeaturesW.fill(0);this.accFeaturesB.fill(0);this.accPreW.fill(0);this.accPreB.fill(0);
      for(let side=0;side<2;side++){
        const f=side===0?this.accFeaturesW:this.accFeaturesB;
        for(let sq=0;sq<64;sq++){const p=this.b[M88[sq]];if(!p)continue;const rel=side===0?sq:63-sq,base=TYPE(p),code=color(p)===side?base:base+6;f[rel]=code;}
        this.writeGlobals(side,f);
        const pre=side===0?this.accPreW:this.accPreB;
        for(let h=0;h<48;h++){let z=this.qB1[h]|0;for(let sq=0;sq<64;sq++){const code=f[sq];if(code)z=(z+this.qW1[(sq*12+code-1)*48+h])|0;}for(let g=0;g<16;g++){const code=f[64+g];if(code)z=(z+this.qW1[(768+g)*48+h])|0;}pre[h]=z|0;}
      }
    }
    initDualAccumulator(model,adapters){
      if(!model||model.features!==768||model.hidden!==32||model.whiteW.length!==768*32||model.blackW.length!==768*32)throw new Error('Invalid Stage 3.6 dual-perspective model.');
      this.dualModel=model;this.dualReady=true;this.dualEvalCount=0;this.dualMaxAbsAccumulator=0;
      this.dualFeaturesW.fill(0);this.dualFeaturesB.fill(0);this.dualBiasW.fill(0);this.dualBiasB.fill(0);
      const addAdapter=(adapter)=>{
        if(!adapter)return;const rank=adapter.rank|0,shift=adapter.shift|0;
        if((rank!==1&&rank!==2)||shift<0||shift>14||!adapter.aW||!adapter.aB||!adapter.b||adapter.aW.length!==32*rank||adapter.aB.length!==32*rank||adapter.b.length!==rank)return;
        for(let h=0;h<32;h++){let dw=0,db=0;for(let k=0;k<rank;k++){dw+=(adapter.aW[h*rank+k]|0)*(adapter.b[k]|0);db+=(adapter.aB[h*rank+k]|0)*(adapter.b[k]|0);}this.dualBiasW[h]=(this.dualBiasW[h]+(dw>>shift))|0;this.dualBiasB[h]=(this.dualBiasB[h]+(db>>shift))|0;}
      };
      addAdapter(adapters&&adapters.bond);addAdapter(adapters&&adapters.arena);
      for(let h=0;h<32;h++){
        this.dualAccW[h]=clamp((model.whiteB[h]|0)+this.dualBiasW[h],-32768,32767);
        this.dualAccB[h]=clamp((model.blackB[h]|0)+this.dualBiasB[h],-32768,32767);
      }
      for(let sq=0;sq<64;sq++){
        const piece=this.b[M88[sq]];if(!piece)continue;const type=TYPE(piece),pieceColor=color(piece);
        const codeW=pieceColor===0?type:type+6,relW=sq,codeB=pieceColor===1?type:type+6,relB=sq^56;
        this.dualFeaturesW[relW]=codeW;this.dualFeaturesB[relB]=codeB;
        const rowW=(relW*12+codeW-1)*32,rowB=(relB*12+codeB-1)*32;
        for(let h=0;h<32;h++){this.dualAccW[h]=clamp(this.dualAccW[h]+model.whiteW[rowW+h],-32768,32767);this.dualAccB[h]=clamp(this.dualAccB[h]+model.blackW[rowB+h],-32768,32767);}
      }
      for(let h=0;h<32;h++){const aw=Math.abs(this.dualAccW[h]),ab=Math.abs(this.dualAccB[h]);if(aw>this.dualMaxAbsAccumulator)this.dualMaxAbsAccumulator=aw;if(ab>this.dualMaxAbsAccumulator)this.dualMaxAbsAccumulator=ab;}
    }
    updateDualAccumulator(ply,changedCount,changedSquares,offset){
      const model=this.dualModel,whiteW=model.whiteW,blackW=model.blackW,whiteAcc=this.dualAccW,blackAcc=this.dualAccB,src=ply*32,dst=(ply+1)*32;
      whiteAcc.copyWithin(dst,src,src+32);blackAcc.copyWithin(dst,src,src+32);
      let count=0;const undoBase=ply*10;
      for(let j=0;j<changedCount;j++){
        const sq=changedSquares[offset+j],piece=this.b[M88[sq]],type=piece?TYPE(piece):0,pieceColor=piece?color(piece):-1;
        const codeW=piece?(pieceColor===0?type:type+6):0,codeB=piece?(pieceColor===1?type:type+6):0;
        const relW=sq,relB=sq^56;
        let before=this.dualFeaturesW[relW];
        if(before!==codeW){
          const at=undoBase+count++,row=relW*12,oldRow=(row+before-1)*32,newRow=(row+codeW-1)*32;
          this.dualUndoSide[at]=0;this.dualUndoIndex[at]=relW;this.dualUndoBefore[at]=before;
          for(let h=0;h<32;h++){let v=whiteAcc[dst+h];if(before)v-=whiteW[oldRow+h];if(codeW)v+=whiteW[newRow+h];whiteAcc[dst+h]=v>32767?32767:v< -32768?-32768:v;}
          this.dualFeaturesW[relW]=codeW;
        }
        before=this.dualFeaturesB[relB];
        if(before!==codeB){
          const at=undoBase+count++,row=relB*12,oldRow=(row+before-1)*32,newRow=(row+codeB-1)*32;
          this.dualUndoSide[at]=1;this.dualUndoIndex[at]=relB;this.dualUndoBefore[at]=before;
          for(let h=0;h<32;h++){let v=blackAcc[dst+h];if(before)v-=blackW[oldRow+h];if(codeB)v+=blackW[newRow+h];blackAcc[dst+h]=v>32767?32767:v< -32768?-32768:v;}
          this.dualFeaturesB[relB]=codeB;
        }
      }
      this.dualUndoCount[ply]=count;
      for(let h=0;h<32;h++){const aw=Math.abs(whiteAcc[dst+h]),ab=Math.abs(blackAcc[dst+h]);if(aw>this.dualMaxAbsAccumulator)this.dualMaxAbsAccumulator=aw;if(ab>this.dualMaxAbsAccumulator)this.dualMaxAbsAccumulator=ab;}
    }
    restoreDualAccumulator(ply){
      const base=ply*10,count=this.dualUndoCount[ply];
      for(let j=count-1;j>=0;j--){const at=base+j,side=this.dualUndoSide[at],index=this.dualUndoIndex[at],before=this.dualUndoBefore[at];if(side===0)this.dualFeaturesW[index]=before;else this.dualFeaturesB[index]=before;}
      this.dualUndoCount[ply]=0;
    }
    copyDualAccumulatorToChild(ply){const src=ply*32,dst=(ply+1)*32;this.dualAccW.copyWithin(dst,src,src+32);this.dualAccB.copyWithin(dst,src,src+32);this.dualUndoCount[ply]=0;}
    writeGlobals(side,f){const opp=side^1,r=this.rights;f[64]=this.side===side?1:0;
      f[65]=!!(r&(side===0?RIGHT_K:RIGHT_k))?1:0;f[66]=!!(r&(side===0?RIGHT_Q:RIGHT_q))?1:0;
      f[67]=!!(r&(opp===0?RIGHT_K:RIGHT_k))?1:0;f[68]=!!(r&(opp===0?RIGHT_Q:RIGHT_q))?1:0;
      f[69]=this.inCheck(side)?1:0;f[70]=this.inCheck(opp)?1:0;f[71]=this.ep>=0?1:0;
      for(let g=72;g<80;g++)f[g]=0;if(this.ep>=0)f[72+(this.ep&7)]=1;
    }
    updateAccumulator(ply,changedCount,changedSquares,offset){
      const base=ply*UNDO_FEATURES_PER_PLY;let count=0;const weights=this.qW1,features=this.accFeaturesW,other=this.accFeaturesB;
      for(let side=0;side<2;side++){const f=side===0?features:other;
        for(let j=0;j<changedCount;j++){const s=changedSquares[offset+j],p=this.b[M88[s]],rel=side===0?s:63-s;const after=p?(color(p)===side?TYPE(p):TYPE(p)+6):0,before=f[rel];if(before===after)continue;const at=base+count++;this.fUndoSide[at]=side;this.fUndoIndex[at]=rel;this.fUndoBefore[at]=before;this.fUndoAfter[at]=after;this.fUndoGlobal[at]=0;f[rel]=after;
        }
        const r=this.rights,opp=side^1;
        for(let g=0;g<16;g++){let after=0;if(g===0)after=this.side===side?1:0;else if(g===1)after=!!(r&(side===0?RIGHT_K:RIGHT_k))?1:0;else if(g===2)after=!!(r&(side===0?RIGHT_Q:RIGHT_q))?1:0;else if(g===3)after=!!(r&(opp===0?RIGHT_K:RIGHT_k))?1:0;else if(g===4)after=!!(r&(opp===0?RIGHT_Q:RIGHT_q))?1:0;else if(g===5)after=this.inCheck(side)?1:0;else if(g===6)after=this.inCheck(opp)?1:0;else if(g===7)after=this.ep>=0?1:0;else if(this.ep>=0&&g===8+(this.ep&7))after=1;
          const idx=64+g,before=f[idx];if(before===after)continue;const at=base+count++;this.fUndoSide[at]=side;this.fUndoIndex[at]=idx;this.fUndoBefore[at]=before;this.fUndoAfter[at]=after;this.fUndoGlobal[at]=1;f[idx]=after;
        }
      }
      this.undoCounts[ply]=count;this.uAccDirty[ply]=1;this.uAccApplied[ply]=0;
      if(!this.lazyAccumulator)this.applyAccumulatorDelta(ply);
    }
    applyAccumulatorDelta(ply){
      const base=ply*UNDO_FEATURES_PER_PLY,count=this.undoCounts[ply],weights=this.qW1,preW=this.accPreW,preB=this.accPreB;
      for(let j=0;j<count;j++){const at=base+j,side=this.fUndoSide[at],idx=this.fUndoIndex[at],before=this.fUndoBefore[at],after=this.fUndoAfter[at],pre=side===0?preW:preB;
        if(this.fUndoGlobal[at]){const row=768+(idx-64),delta=after-before;for(let h=0;h<48;h++)pre[h]=(pre[h]+delta*weights[row*48+h])|0;}
        else{const rowBefore=(idx*12+before-1)*48,rowAfter=(idx*12+after-1)*48;for(let h=0;h<48;h++){let d=0;if(before)d=(d-weights[rowBefore+h])|0;if(after)d=(d+weights[rowAfter+h])|0;pre[h]=(pre[h]+d)|0;}}
      }
      this.uAccApplied[ply]=1;
    }
    materializeAccumulator(ply){
      // At most the pending path from root to the current node is visited.
      // The current board position is at ply; moves [0, ply) lead to it.
      let pending=0;for(let p=0;p<ply;p++)if(this.uAccDirty[p]&&!this.uAccApplied[p])pending++;if(pending>this.maxPendingAccumulator)this.maxPendingAccumulator=pending;
      for(let p=0;p<ply;p++)if(this.uAccDirty[p]&&!this.uAccApplied[p])this.applyAccumulatorDelta(p);
    }
    restoreAccumulator(ply){
      const base=ply*UNDO_FEATURES_PER_PLY,count=this.undoCounts[ply],weights=this.qW1,applied=this.uAccApplied[ply],preW=this.accPreW,preB=this.accPreB;
      for(let j=count-1;j>=0;j--){const at=base+j,side=this.fUndoSide[at],idx=this.fUndoIndex[at],before=this.fUndoBefore[at],after=this.fUndoAfter[at],f=side===0?this.accFeaturesW:this.accFeaturesB;
        if(applied){const pre=side===0?preW:preB;
          if(this.fUndoGlobal[at]){const row=768+(idx-64),delta=before-after;for(let h=0;h<48;h++)pre[h]=(pre[h]+delta*weights[row*48+h])|0;}
          else{const rowBefore=(idx*12+before-1)*48,rowAfter=(idx*12+after-1)*48;for(let h=0;h<48;h++){let d=0;if(after)d=(d-weights[rowAfter+h])|0;if(before)d=(d+weights[rowBefore+h])|0;pre[h]=(pre[h]+d)|0;}}
        }
        f[idx]=before;
      }
      this.undoCounts[ply]=0;this.uAccDirty[ply]=0;this.uAccApplied[ply]=0;
    }
    generatePseudo(ply){const out=this.moveLists[ply];let n=0;const b=this.b,side=this.side;
      for(let sq=0;sq<64;sq++){const from=((sq>>3)<<4)|(sq&7),piece=b[from];if(!piece||color(piece)!==side)continue;const ty=TYPE(piece);
        if(ty===1){const dir=side===0?-16:16,start=side===0?6:1,promoRank=side===0?0:7,one=from+dir;
          if(!(one&0x88)&&!b[one]){if((one>>4)===promoRank){{const _to=one,_from64=S64[from],_to64=S64[_to],_captured=(b[one])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((4)<<20)|((0)<<24);}{const _to=one,_from64=S64[from],_to64=S64[_to],_captured=(b[one])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((3)<<20)|((0)<<24);}{const _to=one,_from64=S64[from],_to64=S64[_to],_captured=(b[one])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((2)<<20)|((0)<<24);}{const _to=one,_from64=S64[from],_to64=S64[_to],_captured=(b[one])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((1)<<20)|((0)<<24);}}else{{const _to=one,_from64=S64[from],_to64=S64[_to],_captured=(b[one])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((0)<<24);}const two=from+dir*2;if((from>>4)===start&&!b[two]){const _to=two,_from64=S64[from],_to64=S64[_to],_captured=(b[two])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((FLAG_DOUBLE)<<24);}}}
          for(let k=-1;k<=1;k+=2){const to=one+k;if(to&0x88)continue;if(b[to]&&color(b[to])!==side){if((to>>4)===promoRank){{const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((4)<<20)|((0)<<24);}{const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((3)<<20)|((0)<<24);}{const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((2)<<20)|((0)<<24);}{const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((1)<<20)|((0)<<24);}}else {const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((0)<<24);}}else if(to===this.ep&&!b[to]){const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(side===0?7:1)||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((FLAG_EP)<<24);}}
        }else{const dirs=ty===2?KNIGHT:ty===3?DIAG:ty===4?ORTH:KING,slide=ty===3||ty===4||ty===5;const dirCount=ty===5||ty===6?8:dirs.length;
          for(let di=0;di<dirCount;di++){const d=ty===5||ty===6?KING[di]:dirs[di];let to=from+d;while(!(to&0x88)){if(!b[to]){const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((0)<<24);}else{if(color(b[to])!==side){const _to=to,_from64=S64[from],_to64=S64[_to],_captured=(b[to])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((0)<<24);}break;}if(!slide)break;to+=d;}}
          if(ty===6){const home=side===0?116:4,ks=side===0?RIGHT_K:RIGHT_k,qs=side===0?RIGHT_Q:RIGHT_q,rook=side===0?4:10,enemy=side^1;if(from===home&&!this.inCheck(side)){
              if((this.rights&ks)&&b[home+3]===rook&&!b[home+1]&&!b[home+2]&&!this.isAttacked(home+1,enemy)&&!this.isAttacked(home+2,enemy)){const _to=home+2,_from64=S64[from],_to64=S64[_to],_captured=(b[home+2])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((FLAG_CASTLE_K)<<24);}
              if((this.rights&qs)&&b[home-4]===rook&&!b[home-1]&&!b[home-2]&&!b[home-3]&&!this.isAttacked(home-1,enemy)&&!this.isAttacked(home-2,enemy)){const _to=home-2,_from64=S64[from],_to64=S64[_to],_captured=(b[home-2])||b[_to];if(_from64>=0&&_to64>=0&&!(_captured&&TYPE(_captured)===6))out[n++]=_from64|(_to64<<6)|(piece<<12)|(_captured<<16)|((0)<<20)|((FLAG_CASTLE_Q)<<24);}
            }}
        }
      }return n;
    }
    makeMove(ply,move,trackRepetition){if(trackRepetition===undefined)trackRepetition=true;const from64=move&63,to64=(move>>>6)&63,from=M88[from64],to=M88[to64],piece=(move>>>12)&15,captured=(move>>>16)&15,promo=(move>>>20)&7,flags=(move>>>24)&15,side=this.side;
      this.uPiece[ply]=piece;this.uCaptured[ply]=captured;this.uNonKingCount[ply]=this.nonKingCount;this.uFrom[ply]=from;this.uTo[ply]=to;this.uCaptureSq[ply]=(flags&FLAG_EP)?to+(side===0?16:-16):to;this.uRights[ply]=this.rights;this.uEp[ply]=this.ep;this.uHalf[ply]=this.half;this.uFull[ply]=this.full;this.uSide[ply]=this.side;this.uHashHi0[ply]=this.hashHi0;this.uHashHi1[ply]=this.hashHi1;this.uHashLo0[ply]=this.hashLo0;this.uHashLo1[ply]=this.hashLo1;this.uHashEp[ply]=this.hashEp;this.uAccDirty[ply]=0;this.uAccApplied[ply]=0;this.undoCounts[ply]=0;this.dualUndoCount[ply]=0;this.uKingW[ply]=this.kingSq[0];this.uKingB[ply]=this.kingSq[1];this.uRookFrom[ply]=-1;this.uRookTo[ply]=-1;this.uRookPiece[ply]=0;this.uNull[ply]=0;this.uRepAdded[ply]=0;
      const oldRights=this.rights,oldEp=this.hashEp;let hi0=this.hashHi0,hi1=this.hashHi1,lo0=this.hashLo0,lo1=this.hashLo1;
      hi0^=zRightsHi0[oldRights];hi1^=zRightsHi1[oldRights];lo0^=zRightsLo0[oldRights];lo1^=zRightsLo1[oldRights];if(oldEp>=0){hi0^=zEpHi0[oldEp];hi1^=zEpHi1[oldEp];lo0^=zEpLo0[oldEp];lo1^=zEpLo1[oldEp];}
      const capSq=this.uCaptureSq[ply],capCode=captured;if(capCode){const ci=(capCode-1)*64+S64[capSq];hi0^=zPieceHi0[ci];hi1^=zPieceHi1[ci];lo0^=zPieceLo0[ci];lo1^=zPieceLo1[ci];}
      const fi=(piece-1)*64+from64;hi0^=zPieceHi0[fi];hi1^=zPieceHi1[fi];lo0^=zPieceLo0[fi];lo1^=zPieceLo1[fi];
      this.b[from]=0;this.b[capSq]=0;if(captured)this.nonKingCount--;this.prevMoveClass[ply+1]=((piece<<7)|to)|0;let placed=piece;if(promo){const type=promo===1?2:promo===2?3:promo===3?4:5;placed=type+(side===0?0:6);}this.b[to]=placed;const ti=(placed-1)*64+to64;hi0^=zPieceHi0[ti];hi1^=zPieceHi1[ti];lo0^=zPieceLo0[ti];lo1^=zPieceLo1[ti];
      if(TYPE(piece)===6)this.kingSq[side]=to;
      if(flags&(FLAG_CASTLE_K|FLAG_CASTLE_Q)){const rf=from+(flags&FLAG_CASTLE_K?3:-4),rt=from+(flags&FLAG_CASTLE_K?1:-1),rook=this.b[rf],rfi=(rook-1)*64+S64[rf],rti=(rook-1)*64+S64[rt];this.uRookFrom[ply]=rf;this.uRookTo[ply]=rt;this.uRookPiece[ply]=rook;hi0^=zPieceHi0[rfi]^zPieceHi0[rti];hi1^=zPieceHi1[rfi]^zPieceHi1[rti];lo0^=zPieceLo0[rfi]^zPieceLo0[rti];lo1^=zPieceLo1[rfi]^zPieceLo1[rti];this.b[rt]=rook;this.b[rf]=0;}
      if(piece===6)this.rights&=252;else if(piece===12)this.rights&=243;
      if(from64===63)this.rights&=254;else if(from64===56)this.rights&=253;else if(from64===7)this.rights&=251;else if(from64===0)this.rights&=247;
      if(capCode&&TYPE(capCode)===4){if(to64===63)this.rights&=254;else if(to64===56)this.rights&=253;else if(to64===7)this.rights&=251;else if(to64===0)this.rights&=247;}
      this.ep=(flags&FLAG_DOUBLE)?((from+to)>>1):-1;this.half=(TYPE(piece)===1||capCode)?0:this.half+1;if(side===1)this.full++;this.side^=1;
      hi0^=zRightsHi0[this.rights];hi1^=zRightsHi1[this.rights];lo0^=zRightsLo0[this.rights];lo1^=zRightsLo1[this.rights];hi0^=zSideHi0;hi1^=zSideHi1;lo0^=zSideLo0;lo1^=zSideLo1;this.hashHi0=hi0;this.hashHi1=hi1;this.hashLo0=lo0;this.hashLo1=lo1;this.hashEp=-1;if(this.ep>=0){const ep=this.ep,enemyPawn=this.side===0?1:7,src0=this.side===0?ep+15:ep-15,src1=this.side===0?ep+17:ep-17;if((!(src0&0x88)&&this.b[src0]===enemyPawn)||(!(src1&0x88)&&this.b[src1]===enemyPawn))this.hashEp=this.effectiveEpFile();}if(this.hashEp>=0){const ep=this.hashEp;this.hashHi0^=zEpHi0[ep];this.hashHi1^=zEpHi1[ep];this.hashLo0^=zEpLo0[ep];this.hashLo1^=zEpLo1[ep];}
      if(trackRepetition&&this.nullDepth===0){this.rep.add(this.hashHi0,this.hashHi1,this.hashLo0,this.hashLo1);this.uRepAdded[ply]=1;}
      // Accumulator updates are applied by makeMoveWithAccumulator; the board-only
      // form is reserved for reversible legality probes and null-independent tests.
    }
    makeMoveWithAccumulator(ply,move){
      // Same reversible board/hash operation, followed by fixed-buffer feature updates.
      this.makeMove(ply,move);let c=0,off=ply*5;const a=this.changedSquares;a[off+c++]=S64[this.uFrom[ply]];a[off+c++]=S64[this.uTo[ply]];if(this.uCaptureSq[ply]!==this.uTo[ply])a[off+c++]=S64[this.uCaptureSq[ply]];if(this.uRookFrom[ply]>=0){a[off+c++]=S64[this.uRookFrom[ply]];a[off+c++]=S64[this.uRookTo[ply]];}if(this.dualReady)this.updateDualAccumulator(ply,c,a,off);else this.updateAccumulator(ply,c,a,off);
    }
    makeNull(ply){this.uPiece[ply]=0;this.uCaptured[ply]=0;this.uFrom[ply]=-1;this.uTo[ply]=-1;this.uCaptureSq[ply]=-1;this.uRights[ply]=this.rights;this.uEp[ply]=this.ep;this.uHalf[ply]=this.half;this.uFull[ply]=this.full;this.uSide[ply]=this.side;this.uHashHi0[ply]=this.hashHi0;this.uHashHi1[ply]=this.hashHi1;this.uHashLo0[ply]=this.hashLo0;this.uHashLo1[ply]=this.hashLo1;this.uHashEp[ply]=this.hashEp;this.uAccDirty[ply]=0;this.uAccApplied[ply]=0;this.uKingW[ply]=this.kingSq[0];this.uKingB[ply]=this.kingSq[1];this.uRookFrom[ply]=-1;this.uRookTo[ply]=-1;this.uRookPiece[ply]=0;this.uNull[ply]=1;this.uRepAdded[ply]=0;
      if(this.hashEp>=0){const ep=this.hashEp;this.hashHi0^=zEpHi0[ep];this.hashHi1^=zEpHi1[ep];this.hashLo0^=zEpLo0[ep];this.hashLo1^=zEpLo1[ep];}this.hashEp=-1;this.ep=-1;this.hashHi0^=zSideHi0;this.hashHi1^=zSideHi1;this.hashLo0^=zSideLo0;this.hashLo1^=zSideLo1;this.side^=1;this.half++;this.prevMoveClass[ply+1]=0;this.undoCounts[ply]=0;
      this.nullDepth++;if(this.dualReady)this.copyDualAccumulatorToChild(ply);else this.updateGlobalsOnly(ply);
    }
    updateGlobalsOnly(ply){let count=0,base=ply*UNDO_FEATURES_PER_PLY;for(let side=0;side<2;side++){const f=side===0?this.accFeaturesW:this.accFeaturesB;for(let g=0;g<16;g++){let after=0;if(g===0)after=this.side===side?1:0;else if(g===1)after=!!(this.rights&(side===0?RIGHT_K:RIGHT_k))?1:0;else if(g===2)after=!!(this.rights&(side===0?RIGHT_Q:RIGHT_q))?1:0;else if(g===3)after=!!(this.rights&(side===1?RIGHT_K:RIGHT_k))?1:0;else if(g===4)after=!!(this.rights&(side===1?RIGHT_Q:RIGHT_q))?1:0;else if(g===5)after=this.inCheck(side)?1:0;else if(g===6)after=this.inCheck(side^1)?1:0;else if(g===7)after=this.ep>=0?1:0;else if(g>=8&&this.ep>=0&&g===8+(this.ep&7))after=1;const idx=64+g,before=f[idx];if(before===after)continue;const at=base+count++;this.fUndoSide[at]=side;this.fUndoIndex[at]=idx;this.fUndoBefore[at]=before;this.fUndoAfter[at]=after;this.fUndoGlobal[at]=1;f[idx]=after;}}this.undoCounts[ply]=count;this.uAccDirty[ply]=1;this.uAccApplied[ply]=0;if(!this.lazyAccumulator)this.applyAccumulatorDelta(ply);}
    generateLegal(ply,capturesOnly){if(capturesOnly===undefined)capturesOnly=false;const pseudo=this.generatePseudo(ply),list=this.moveLists[ply];let n=0;const side=this.side;for(let i=0;i<pseudo;i++){const move=list[i],captured=(move>>>16)&15,promo=(move>>>20)&7;if(capturesOnly&&!captured&&!promo)continue;this.makeMove(ply,move,false);this.undoCounts[ply]=0;const safe=!this.inCheck(side);this.unmakeMove(ply);if(safe)list[n++]=move;}this.counts[ply]=n;return n;}
    unmakeMove(ply){if(this.uNull[ply]){if(this.dualReady)this.restoreDualAccumulator(ply);else this.restoreAccumulator(ply);this.hashHi0=this.uHashHi0[ply];this.hashHi1=this.uHashHi1[ply];this.hashLo0=this.uHashLo0[ply];this.hashLo1=this.uHashLo1[ply];this.hashEp=this.uHashEp[ply];this.rights=this.uRights[ply];this.ep=this.uEp[ply];this.half=this.uHalf[ply];this.full=this.uFull[ply];this.side=this.uSide[ply];this.kingSq[0]=this.uKingW[ply];this.kingSq[1]=this.uKingB[ply];this.nullDepth--;this.uNull[ply]=0;return;}
      if(this.dualReady)this.restoreDualAccumulator(ply);else this.restoreAccumulator(ply);if(this.uRepAdded[ply]&&this.nullDepth===0)this.rep.remove(this.hashHi0,this.hashHi1,this.hashLo0,this.hashLo1);this.uRepAdded[ply]=0;const from=this.uFrom[ply],to=this.uTo[ply],capSq=this.uCaptureSq[ply],piece=this.uPiece[ply],captured=this.uCaptured[ply];this.b[from]=piece;this.b[to]=0;if(captured)this.b[capSq]=captured;if(this.uRookFrom[ply]>=0){this.b[this.uRookFrom[ply]]=this.uRookPiece[ply];this.b[this.uRookTo[ply]]=0;}
      this.rights=this.uRights[ply];this.ep=this.uEp[ply];this.half=this.uHalf[ply];this.full=this.uFull[ply];this.side=this.uSide[ply];this.nonKingCount=this.uNonKingCount[ply];this.hashHi0=this.uHashHi0[ply];this.hashHi1=this.uHashHi1[ply];this.hashLo0=this.uHashLo0[ply];this.hashLo1=this.uHashLo1[ply];this.hashEp=this.uHashEp[ply];this.kingSq[0]=this.uKingW[ply];this.kingSq[1]=this.uKingB[ply];
    }
    leastAttacker(target,by){
      const b=this.b;let best=-1,bestValue=INF;
      const target64=S64[target],pawnBase=target64*4+(by===0?0:2);let sq=PAWN_SOURCES[pawnBase],piece;
      if(sq>=0){piece=b[sq];if(piece&&color(piece)===by&&TYPE(piece)===1){best=sq;bestValue=VALUES[1];}}
      sq=PAWN_SOURCES[pawnBase+1];if(sq>=0){piece=b[sq];if(piece&&color(piece)===by&&TYPE(piece)===1&&VALUES[1]<bestValue){best=sq;bestValue=VALUES[1];}}
      const knightBase=target64*8;for(let i=0;i<8;i++){sq=KNIGHT_SOURCES[knightBase+i];if(sq<0)continue;piece=b[sq];if(piece&&color(piece)===by&&TYPE(piece)===2&&VALUES[2]<bestValue){best=sq;bestValue=VALUES[2];}}
      for(let i=0;i<8;i++){
        const dir=KING[i],diagonal=i===0||i===2||i===5||i===7;let at=target+dir,dist=1;
        while(!(at&0x88)){
          piece=b[at];
          if(piece){
            if(color(piece)===by){const type=TYPE(piece),slider=type===5||(diagonal&&type===3)||(!diagonal&&type===4)||(dist===1&&type===6);if(slider){const value=VALUES[type];if(value<bestValue){best=at;bestValue=value;}}}
            break;
          }
          at+=dir;dist++;
        }
      }
      return best;
    }
    see(move){
      const from=M88[move&63],to=M88[(move>>>6)&63],piece=this.b[from],captured=(move>>>16)&15,promo=(move>>>20)&7,flags=(move>>>24)&15,capSq=(flags&FLAG_EP)?to+(this.side===0?16:-16):to;
      const gains=this.seeGain,fromStack=this.seeFrom,pieceStack=this.seePiece;
      const originalFrom=this.b[from],originalTo=this.b[to],originalCap=capSq===to?originalTo:this.b[capSq];
      let placed=piece,promotionGain=0;
      if(promo){const promotionType=promo===1?2:promo===2?3:promo===3?4:5;placed=promotionType+(this.side===0?0:6);promotionGain=VALUES[promotionType]-VALUES[1];}
      if(!captured&&!promo)return 0;
      gains[0]=(captured?VALUES[TYPE(captured)]:0)+promotionGain;
      this.b[from]=0;if(capSq!==to)this.b[capSq]=0;this.b[to]=placed;
      let occupant=placed,side=this.side^1,depth=0;
      while(depth<30){
        const attackerSq=this.leastAttacker(to,side);if(attackerSq<0)break;
        const attacker=this.b[attackerSq],attackerType=TYPE(attacker);let bonus=0,placedAttacker=attacker;
        if(attackerType===1&&((side===0&&(to>>4)===0)||(side===1&&(to>>4)===7))){placedAttacker=(side===0?5:11);bonus=VALUES[5]-VALUES[1];}
        gains[depth+1]=VALUES[TYPE(occupant)]-gains[depth]+bonus;
        fromStack[depth]=attackerSq;pieceStack[depth]=attacker;
        this.b[attackerSq]=0;this.b[to]=placedAttacker;occupant=placedAttacker;side^=1;depth++;
      }
      for(let i=depth;i>0;i--){const a=-gains[i-1],b=gains[i];gains[i-1]=a>b?-a:-b;}
      for(let i=depth-1;i>=0;i--)this.b[fromStack[i]]=pieceStack[i];
      this.b[from]=originalFrom;this.b[to]=originalTo;if(capSq!==to)this.b[capSq]=originalCap;
      return gains[0];
    }
    isInsufficient(){let minors=0,bishops=-1,onlyBishops=true;for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=this.b[sq];if(!p)continue;const t=TYPE(p);if(t===1||t===4||t===5)return false;if(t===2){minors++;onlyBishops=false;}else if(t===3){minors++;const shade=((sq>>4)+(sq&7))&1;if(bishops<0)bishops=shade;else if(bishops!==shade)onlyBishops=false;}if(t===6)continue;}return minors===0||minors===1||(onlyBishops&&bishops>=0);}
    hasNonPawnMaterial(side){if(side===undefined)side=this.side;for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=this.b[sq];if(p&&color(p)===side&&TYPE(p)!==1&&TYPE(p)!==6)return true;}return false;}
    uci(move){const f=move&63,t=(move>>>6)&63,p=(move>>>20)&7;let out='abcdefgh'[f&7]+(8-(f>>3))+'abcdefgh'[t&7]+(8-(t>>3));if(p)out+=p===1?'n':p===2?'b':p===3?'r':'q';return out;}
    verifyKey(){let hi0=0,hi1=0,lo0=0,lo1=0;for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=this.b[sq];if(p){const i=(p-1)*64+S64[sq];hi0^=zPieceHi0[i];hi1^=zPieceHi1[i];lo0^=zPieceLo0[i];lo1^=zPieceLo1[i];}}hi0^=zRightsHi0[this.rights];hi1^=zRightsHi1[this.rights];lo0^=zRightsLo0[this.rights];lo1^=zRightsLo1[this.rights];if(this.side){hi0^=zSideHi0;hi1^=zSideHi1;lo0^=zSideLo0;lo1^=zSideLo1;}const ep=this.effectiveEpFile();if(ep>=0){hi0^=zEpHi0[ep];hi1^=zEpHi1[ep];lo0^=zEpLo0[ep];lo1^=zEpLo1[ep];}return hi0===this.hashHi0&&hi1===this.hashHi1&&lo0===this.hashLo0&&lo1===this.hashLo1;}

    fen(){let rows='';for(let r=0;r<8;r++){let empty=0;for(let f=0;f<8;f++){const p=this.b[r*16+f];if(!p)empty++;else{if(empty){rows+=empty;empty=0;}const base=TYPE(p),ch=base===1?'p':base===2?'n':base===3?'b':base===4?'r':base===5?'q':'k';rows+=color(p)===0?ch.toUpperCase():ch;}}if(empty)rows+=empty;if(r<7)rows+='/';}let c='';if(this.rights&1)c+='K';if(this.rights&2)c+='Q';if(this.rights&4)c+='k';if(this.rights&8)c+='q';const ep=this.ep<0?'-':'abcdefgh'[this.ep&7]+(8-(this.ep>>4));return rows+' '+(this.side?'b':'w')+' '+(c||'-')+' '+ep+' '+this.half+' '+this.full;}
  }

  function pack(from,to,piece,captured,promo,flags){return from|(to<<6)|(piece<<12)|(captured<<16)|(promo<<20)|(flags<<24);}
  const SHARED_TT_WORDS=10;
  class FastTT {
    constructor(sharedBuffer=null){
      this.hits=0;this.stores=0;this.shared=typeof SharedArrayBuffer!=='undefined'&&sharedBuffer instanceof SharedArrayBuffer;
      if(this.shared){this.words=new Int32Array(sharedBuffer);this.hi0=this.hi1=this.lo0=this.lo1=this.depth=this.flag=this.score=this.move=this.age=null;}
      else{this.hi0=new Uint16Array(TT_SIZE);this.hi1=new Uint16Array(TT_SIZE);this.lo0=new Uint16Array(TT_SIZE);this.lo1=new Uint16Array(TT_SIZE);this.depth=new Int8Array(TT_SIZE);this.depth.fill(-1);this.flag=new Uint8Array(TT_SIZE);this.score=new Int16Array(TT_SIZE);this.move=new Int32Array(TT_SIZE);this.age=new Uint8Array(TT_SIZE);this.generation=1;}
    }
    reset(){this.hits=0;this.stores=0;if(!this.shared){this.generation++;if(this.generation>255){this.age.fill(0);this.depth.fill(-1);this.generation=1;}}}
    _index(a,b,c,d){return (c^(d<<1)^(a<<2)^(b<<3))&(TT_SIZE-1);}
    _checksum(k0,k1,meta,score,move){return (k0^((k1<<11)|(k1>>>21))^meta^score^move^0x6d2b79f5)|0;}
    probe(hi0,hi1,lo0,lo1,depth,alpha,beta,ply,out){
      const i=this._index(hi0,hi1,lo0,lo1);let d,flag,score,move;
      if(this.shared){
        const b=i*SHARED_TT_WORDS,w=this.words;let valid=false;
        for(let retry=0;retry<3;retry++){
          const a=Atomics.load(w,b);if(a&1)continue;
          const k0=Atomics.load(w,b+1),k1=Atomics.load(w,b+2),meta=Atomics.load(w,b+5),sc=Atomics.load(w,b+6),mv=Atomics.load(w,b+7),sum=Atomics.load(w,b+9),z=Atomics.load(w,b);
          if(a!==z||(z&1)||sum!==this._checksum(k0,k1,meta,sc,mv))continue;
          if(k0!==(hi0|(hi1<<16))||k1!==(lo0|(lo1<<16)))continue;
          d=(meta>>>8)&255;flag=meta&255;score=sc;move=mv;valid=true;break;
        }
        if(!valid){out[0]=0;out[1]=0;return;}
      }else{
        if(this.age[i]!==this.generation||this.depth[i]<0||this.hi0[i]!==hi0||this.hi1[i]!==hi1||this.lo0[i]!==lo0||this.lo1[i]!==lo1){out[0]=0;out[1]=0;return;}
        d=this.depth[i];flag=this.flag[i];score=this.score[i];move=this.move[i];
      }
      if(score>MATE-1000)score-=ply;else if(score<NEG_MATE+1000)score+=ply;
      this.hits++;out[0]=1;out[1]=move;out[2]=score;out[3]=(d>=depth&&((flag===1)||(flag===2&&score<=alpha)||(flag===3&&score>=beta)))?1:0;
    }
    store(hi0,hi1,lo0,lo1,depth,score,flag,move,ply){
      const i=this._index(hi0,hi1,lo0,lo1);let packed=score;if(packed>MATE-1000)packed+=ply;else if(packed<NEG_MATE+1000)packed-=ply;packed=clamp(packed|0,-32768,32767);
      if(this.shared){
        const b=i*SHARED_TT_WORDS,w=this.words,seq=Atomics.load(w,b);
        if((seq&1)||Atomics.compareExchange(w,b,seq,seq+1)!==seq)return;
        const k0=hi0|(hi1<<16),k1=lo0|(lo1<<16),meta=((clamp(depth,-1,127)&255)<<8)|(flag&255),mv=move|0;
        Atomics.store(w,b+1,k0);Atomics.store(w,b+2,k1);Atomics.store(w,b+5,meta);Atomics.store(w,b+6,packed);Atomics.store(w,b+7,mv);
        Atomics.store(w,b+9,this._checksum(k0,k1,meta,packed,mv));Atomics.store(w,b,seq+2);this.stores++;return;
      }
      const same=this.age[i]===this.generation&&this.depth[i]>=0&&this.hi0[i]===hi0&&this.hi1[i]===hi1&&this.lo0[i]===lo0&&this.lo1[i]===lo1;
      if(!same&&this.depth[i]>depth&&this.age[i]===this.generation)return;
      this.hi0[i]=hi0;this.hi1[i]=hi1;this.lo0[i]=lo0;this.lo1[i]=lo1;this.depth[i]=clamp(depth,-1,127);this.score[i]=packed;this.flag[i]=flag;this.move[i]=move|0;this.age[i]=this.generation;this.stores++;
    }
  }
  const SHARED_TT=new FastTT();
  // Fixed-size integer-only evaluation scratch, indexed by ply (no views or objects).
  const SCALAR_Q1=new Int16Array(MAX_PLY*48),SCALAR_Q2=new Int16Array(MAX_PLY*48);
  // Shared immutable quantised model buffers. Worker searches are synchronous;
  // a single cache avoids rebuilding/copying ~40k weights on every move.
  const QMODEL_W1=new Int16Array(784*48),QMODEL_B1=new Int32Array(48),QMODEL_W2=new Int16Array(48*48),QMODEL_B2=new Int32Array(48),QMODEL_WOUT=new Int16Array(3*48),QMODEL_BOUT=new Int32Array(3);
  let qModelSource=null,qAdapterSource=null,qAdapterSteps=-1,qModelV14=false,qModelCached=false;
  function ensureQuantizedModel(model,adapter,isV14){
    const steps=adapter?(adapter.steps|0):0;
    if(qModelCached&&qModelSource===model&&qAdapterSource===adapter&&qAdapterSteps===steps&&qModelV14===!!isV14)return;
    const w1=model.w1||[],b1=model.b1||[],w2=model.w2||[],b2=model.b2||[],wo=model.wOut||[],bo=model.bOut||[];
    for(let i=0;i<QMODEL_W1.length;i++)QMODEL_W1[i]=Math.max(-32768,Math.min(32767,Math.round((Number(w1[i])||0)*Q1)))|0;
    for(let h=0;h<48;h++)QMODEL_B1[h]=Math.round((Number(b1[h])||0)*Q1)|0;
    for(let o=0;o<48;o++){
      const row=o*48,ab=o*4;
      for(let i=0;i<48;i++){
        let w=Number(w2[row+i])||0;
        if(isV14&&adapter){w+=(adapter.B[ab]*adapter.A[i]+adapter.B[ab+1]*adapter.A[48+i]+adapter.B[ab+2]*adapter.A[96+i]+adapter.B[ab+3]*adapter.A[144+i])/4;}
        QMODEL_W2[row+i]=Math.max(-32768,Math.min(32767,Math.round(w*Q2)))|0;
      }
      QMODEL_B2[o]=Math.round((Number(b2[o])||0)*Q2)|0;
    }
    for(let i=0;i<QMODEL_WOUT.length;i++)QMODEL_WOUT[i]=Math.max(-32768,Math.min(32767,Math.round((Number(wo[i])||0)*QOUT*2)))|0;
    for(let i=0;i<3;i++)QMODEL_BOUT[i]=Math.round((Number(bo[i])||0)*QOUT)|0;
    qModelSource=model;qAdapterSource=adapter;qAdapterSteps=steps;qModelV14=!!isV14;qModelCached=true;
  }
  function dualScalarValue(board,ply){
    const model=board.dualModel,base=ply*32,stm=board.side===0?board.dualAccW:board.dualAccB,nstm=board.side===0?board.dualAccB:board.dualAccW,weights=model.outputW;let sum=model.outputB|0;
    for(let h=0;h<32;h++){let x=stm[base+h]|0;if(x<0)x=0;else if(x>255)x=255;const activation=x*x;sum+=activation*(weights[h]|0);}
    for(let h=0;h<32;h++){let x=nstm[base+h]|0;if(x<0)x=0;else if(x>255)x=255;const activation=x*x;sum+=activation*(weights[32+h]|0);}
    board.dualEvalCount++;return Math.round((sum*1000)/model.outputDivisor)|0;
  }
  function scalarValue(brain,board,ply){
    if(board.dualReady)return dualScalarValue(board,ply);
    board.materializeAccumulator(ply);
    const base=ply*48,pre=board.side===0?board.accPreW:board.accPreB,h1=SCALAR_Q1,h2=SCALAR_Q2;
    const w2=board.qW2,b2=board.qB2,wo=board.qWOut,bo=board.qBOut;
    for(let h=0;h<48;h++)h1[base+h]=tanhQ1(pre[h])|0;
    for(let o=0;o<48;o++){
      const row=o*48;let sum=0;
      for(let i=0;i<48;i++)sum=(sum+((w2[row+i]*h1[base+i])>>15))|0;
      const z=(b2[o]+sum)|0;
      h2[base+o]=((h1[base+o]+tanhQ2(z))>>1)|0;
    }
    let logits0=bo[0]|0,logits1=bo[1]|0,logits2=bo[2]|0;
    let s0=0,s1=0,s2=0;
    for(let h=0;h<48;h++){const v=h2[base+h];s0=(s0+((wo[h]*v)>>15))|0;s1=(s1+((wo[48+h]*v)>>15))|0;s2=(s2+((wo[96+h]*v)>>15))|0;}
    logits0=(logits0+s0)|0;logits1=(logits1+s1)|0;logits2=(logits2+s2)|0;
    const max=logits0>logits1?(logits0>logits2?logits0:logits2):(logits1>logits2?logits1:logits2);
    const win=expQOut((logits0-max)|0),draw=expQOut((logits1-max)|0),loss=expQOut((logits2-max)|0),denom=win+draw+loss;
    return denom?divScalar31(((win-loss)*1000)|0,denom):0;
  }
  function fastMopUp(ctx){
    const board=ctx.board;let ownK=-1,enemyK=-1,own=0,enemy=0;
    for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=board.b[sq];if(!p)continue;const t=TYPE(p),v=t===5?900:t===4?500:t===3?330:t===2?320:t===1?100:0;if(t===6){if((p<=6?0:1)===board.side)ownK=sq;else enemyK=sq;}else if(color(p)===board.side)own+=v;else enemy+=v;}
    if(ownK<0||enemyK<0||own<=enemy+250)return 0;const f=enemyK&7,r=enemyK>>4;let edge=f,v=7-f;if(v<edge)edge=v;v=r;if(v<edge)edge=v;v=7-r;if(v<edge)edge=v;let dx=(ownK&7)-f,dy=(ownK>>4)-r;dx=dx<0?-dx:dx;dy=dy<0?-dy:dy;let inward=12-dx-dy;if(inward<0)inward=0;return ((7-edge)*7+inward*2)|0;
  }
  const KPK_NO_PROBE=2147483647;
  const ENDGAME_DRAW=2147483646;
  const END_MATERIAL=new Int8Array(2*7);
  // The compact KPK bitbase is exact. Other elementary endings use exact
  // material-theorem recognition (not a fabricated per-position bitbase).
  function probeBareKingWin(board){
    if(board.half>=90)return 0;
    END_MATERIAL.fill(0);
    let bishopMask0=0,bishopMask1=0;
    for(let sq=0;sq<128;sq++){
      if(sq&0x88){sq+=7;continue;}
      const piece=board.b[sq];if(!piece)continue;
      const side=piece<=6?0:1,type=TYPE(piece);
      if(type===6)continue;
      END_MATERIAL[side*7+type]++;
      if(type===3){const bit=1<<(((sq>>4)+(sq&7))&1);if(side===0)bishopMask0|=bit;else bishopMask1|=bit;}
    }
    const a0=END_MATERIAL[0]+END_MATERIAL[1]+END_MATERIAL[2]+END_MATERIAL[3]+END_MATERIAL[4]+END_MATERIAL[5];
    const a1=END_MATERIAL[7]+END_MATERIAL[8]+END_MATERIAL[9]+END_MATERIAL[10]+END_MATERIAL[11]+END_MATERIAL[12];
    if((a0===0)===(a1===0))return 0;
    const attacker=a0?0:1,base=attacker*7;
    const pawns=END_MATERIAL[base+1],knights=END_MATERIAL[base+2],bishops=END_MATERIAL[base+3],rooks=END_MATERIAL[base+4],queens=END_MATERIAL[base+5];
    // KBBK is not a universal win even with opposite-coloured bishops;
    // same-coloured bishops are a theoretical draw. Leave opposite-colour
    // KBBK to search/mop-up instead of falsely returning a bitbase win.
    if(pawns===0&&knights===0&&bishops===2&&rooks===0&&queens===0){
      const mask=attacker===0?bishopMask0:bishopMask1;
      return mask!==3?ENDGAME_DRAW:0;
    }
    const win=queens>0||rooks>0||(bishops>0&&knights>0);
    if(!win)return 0;
    return attacker===board.side?1600:-1600;
  }
  function probeKpkWdl(board){
    const table=root.CHESSLING_KPK_WDL;if(!table||table.length!==24576||board.nonKingCount!==1||board.half>=50||board.rights)return KPK_NO_PROBE;
    let pawnSq=-1,pawnSide=-1;
    for(let sq=0;sq<128;sq++){if(sq&0x88){sq+=7;continue;}const p=board.b[sq];if(p&&TYPE(p)===1){pawnSq=sq;pawnSide=color(p);break;}}
    if(pawnSq<0)return KPK_NO_PROBE;
    let p=((7-(pawnSq>>4))<<3)|(pawnSq&7);
    let wk=((7-(board.kingSq[pawnSide]>>4))<<3)|(board.kingSq[pawnSide]&7);
    let bk=((7-(board.kingSq[pawnSide^1]>>4))<<3)|(board.kingSq[pawnSide^1]&7);
    let stm=board.side===pawnSide?0:1;
    if(pawnSide===1){p=63-p;wk=63-wk;bk=63-bk;}
    if((p&7)>3){p^=7;wk^=7;bk^=7;}
    const rank=p>>3,file=p&7;if(rank<1||rank>6||file>3||wk===bk||wk===p||bk===p)return KPK_NO_PROBE;
    const index=((((stm*24+((rank-1)*4+file))*64+wk)*64+bk)|0);
    const won=(table[index>>3]>>(index&7))&1;
    return won?(pawnSide===board.side?1200:-1200):0;
  }
  function fastEvaluate(ctx,ply,materializeOnly){
    if(materializeOnly){ctx.board.materializeAccumulator(ply);return 0;}
    const board=ctx.board,slot=(board.hashLo0^(board.hashLo1<<1)^(board.hashHi0<<2)^(board.hashHi1<<3))&65535,keyAt=slot*6,keys=ctx.evalKeys,epKey=board.ep+1;
    if(ctx.evalTags[slot]===ctx.evalGeneration&&keys[keyAt]===board.hashHi0&&keys[keyAt+1]===board.hashHi1&&keys[keyAt+2]===board.hashLo0&&keys[keyAt+3]===board.hashLo1&&keys[keyAt+4]===epKey&&keys[keyAt+5]===board.half)return ctx.evalScores[slot]|0;
    const kpk=probeKpkWdl(board);let score;
    if(kpk!==KPK_NO_PROBE){ctx.kpkProbes++;score=kpk|0;}
    else{const bare=probeBareKingWin(board);if(bare===ENDGAME_DRAW)score=0;else if(bare)score=(bare+fastMopUp(ctx))|0;else score=(scalarValue(ctx.brain,board,ply)+fastMopUp(ctx))|0;}
    keys[keyAt]=board.hashHi0;keys[keyAt+1]=board.hashHi1;keys[keyAt+2]=board.hashLo0;keys[keyAt+3]=board.hashLo1;keys[keyAt+4]=epKey;keys[keyAt+5]=board.half;ctx.evalScores[slot]=score;ctx.evalTags[slot]=ctx.evalGeneration;return score|0;
  }
  function fastBudget(ctx){
    // Poll the shared cancellation word on every node so a finished main thread
    // can stop warm helpers without another message/event-loop round-trip.
    if(ctx.stopView&&Atomics.load(ctx.stopView,ctx.stopIndex)!==ctx.stopExpected){
      if(typeof performance!=='undefined'&&performance&&ctx.stopSignalIndex>=0&&ctx.stopLatencyIndex>=0){
        const signaled=Atomics.load(ctx.stopView,ctx.stopSignalIndex),observed=Math.round(((performance.timeOrigin||0)+performance.now())*1000);
        if(signaled>0){const latency=Math.max(0,observed-signaled);let previous=Atomics.load(ctx.stopView,ctx.stopLatencyIndex);while(latency>previous){const actual=Atomics.compareExchange(ctx.stopView,ctx.stopLatencyIndex,previous,latency);if(actual===previous)break;previous=actual;}}
      }
      ctx.stopped=true;return true;
    }
    if(ctx.nodes>=ctx.nodeLimit||(ctx.checkTime&&((ctx.nodes&1023)===0)&&((now()-ctx.start)|0)>=ctx.timeLimit)){ctx.stopped=true;return true;}return false;
  }
  function fastMoveScore(ctx,m,ply,ttMove){
    if(m===ttMove&&ttMove!==0)return 10000000;
    const cap=(m>>>16)&15,piece=(m>>>12)&15,promo=(m>>>20)&7,from=m&63,to=(m>>>6)&63;let score=0;
    const prev=ctx.board.prevMoveClass[ply]|0,cur=(((piece-1)*64)+to)|0;if(prev){if(ctx.countermove[prev]===m)score+=90000;score+=ctx.contHistory[prev*768+cur];}
    if(cap){const see=ctx.board.see(m);ctx.seeCalls++;score=500000+(see>=0?30000+see*8:see*8-30000)+VALUES[TYPE(cap)]*10-VALUES[TYPE(piece)];}
    if(promo)score+=80000+VALUES[promo===1?2:promo===2?3:promo===3?4:5];
    if(!cap&&!promo){if(ctx.killers[ply*2]===m)score+=70000;else if(ctx.killers[ply*2+1]===m)score+=60000;score+=ctx.history[ctx.board.side*4096+from*64+to];}
    return score;
  }
  function fastSortMoves(ctx,ply,count,ttMove){
    const list=ctx.board.moveLists[ply],scores=ctx.board.moveScores[ply];
    for(let i=0;i<count;i++)scores[i]=fastMoveScore(ctx,list[i],ply,ttMove);
    for(let i=1;i<count;i++){const move=list[i],score=scores[i];let j=i-1;while(j>=0&&scores[j]<score){list[j+1]=list[j];scores[j+1]=scores[j];j--;}list[j+1]=move;scores[j+1]=score;}
  }
  function fastQuietCutoff(ctx,move,depth,ply){
    const slot=ply*2;if(ctx.killers[slot]!==move){ctx.killers[slot+1]=ctx.killers[slot];ctx.killers[slot]=move;}
    const from=move&63,to=(move>>>6)&63,piece=(move>>>12)&15,prev=ctx.board.prevMoveClass[ply]|0;
    const idx=ctx.board.side*4096+from*64+to,bonus=(depth*depth*16)|0;let hv=(ctx.history[idx]+bonus)|0;if(hv>50000)hv=50000;ctx.history[idx]=hv;
    if(prev){ctx.countermove[prev]=move;const ci=prev*768+(piece-1)*64+to;let cv=(ctx.contHistory[ci]+depth*depth*8)|0;if(cv>30000)cv=30000;ctx.contHistory[ci]=cv;}
  }
  function fastNegamax(ctx,depth,alpha,beta,ply,allowNull){
    const board=ctx.board;ctx.nodes++;if(fastBudget(ctx))return fastEvaluate(ctx,ply)|0;
    if(ply>0&&(ply&1)===0)fastEvaluate(ctx,ply,true);
    const repetitions=board.nullDepth?0:board.rep.get(board.hashHi0,board.hashHi1,board.hashLo0,board.hashLo1);
    if(board.half>=100||board.isInsufficient()||repetitions>=3){ctx.drawNodes++;return 0;}
    if(depth<=0)return fastQuiescence(ctx,alpha,beta,ply,5)|0;
    const alpha0=alpha,beta0=beta,pathSensitive=board.nullDepth>0||board.half>=90||repetitions>1;
    ctx.tt.probe(board.hashHi0,board.hashHi1,board.hashLo0,board.hashLo1,depth,alpha,beta,ply,ctx.ttOut);const ttMove=ctx.ttOut[1];
    if(ctx.ttOut[0]&&ctx.ttOut[3]&&!pathSensitive)return ctx.ttOut[2];
    const inCheck=board.inCheck();
    let staticEval=0,staticMargin=0;
    if(depth<=3&&!inCheck){staticEval=fastEvaluate(ctx,ply)|0;staticMargin=(90+depth*95)|0;if(staticEval-staticMargin>=beta){ctx.rfpPrunes++;return (staticEval-staticMargin)|0;}}
    const count=board.generateLegal(ply,false);if(!count)return inCheck?((NEG_MATE|0)+(ply|0))|0:0;
    const pv=beta-alpha>1;
    // Null move: R=2 below depth six, R=3 at depth six and above.
    // Requiring own non-pawn material avoids the classic pawn-only zugzwang trap.
    if(allowNull&&depth>=3&&!inCheck&&!pv&&board.hasNonPawnMaterial(board.side)){
      const reduction=depth>=6?3:2;board.makeNull(ply);ctx.nmpCalls++;if(reduction===3)ctx.nmpR3Calls++;else ctx.nmpR2Calls++;
      const nullScore=0-fastNegamax(ctx,depth-1-reduction,0-beta,1-beta,ply+1,false);board.unmakeMove(ply);
      if(ctx.stopped)return nullScore;
      if(nullScore>=beta){
        if(depth>=6){const verify=fastNegamax(ctx,depth-1-reduction,beta-1,beta,ply,false);if(verify<beta)return verify;}
        return nullScore;
      }
    }
    fastSortMoves(ctx,ply,count,ttMove);const list=board.moveLists[ply];let best=NEG_INF,bestMove=0;
    for(let i=0;i<count;i++){
      if(ctx.stopped)break;
      const move=list[i],captured=(move>>>16)&15,promo=(move>>>20)&7,quiet=!captured&&!promo;
      if(depth<=3&&!inCheck&&i>0&&quiet&&staticEval+staticMargin<=alpha){ctx.frontierFutilityPrunes++;continue;}
      const reduce=quiet&&!inCheck&&depth>=3&&i>=3?(depth>=6&&i>=8?2:1):0;
      const shallowBadCapture=!quiet&&!promo&&captured&&depth<=3&&!pv,seeValue=captured?board.see(move):0;
      board.makeMoveWithAccumulator(ply,move);
      let score,childInCheck=false;
      if(shallowBadCapture&&seeValue<-100){childInCheck=board.inCheck();if(!childInCheck){board.unmakeMove(ply);ctx.seePrunes++;continue;}}
      if(i===0||!ctx.usePvs)score=0-fastNegamax(ctx,depth-1,0-beta,0-alpha,ply+1,true);
      else{
        score=0-fastNegamax(ctx,depth-1-reduce,0-alpha-1,0-alpha,ply+1,true);
        if(!ctx.stopped&&reduce&&score>alpha){ctx.lmrResearches++;score=0-fastNegamax(ctx,depth-1,0-alpha-1,0-alpha,ply+1,true);}
        if(!ctx.stopped&&score>alpha&&score<beta){ctx.pvsResearches++;score=0-fastNegamax(ctx,depth-1,0-beta,0-alpha,ply+1,true);}
      }
      board.unmakeMove(ply);
      if(score>best){best=score;bestMove=move;}if(score>alpha)alpha=score;
      if(alpha>=beta){if(quiet)fastQuietCutoff(ctx,move,depth,ply);break;}
    }
    if(best===NEG_INF)best=fastEvaluate(ctx,ply)|0;
    if(!pathSensitive){const flag=best<=alpha0?2:best>=beta0?3:1;ctx.tt.store(board.hashHi0,board.hashHi1,board.hashLo0,board.hashLo1,depth,best,flag,bestMove,ply);}
    return best|0;
  }
  function fastQuiescence(ctx,alpha,beta,ply,qDepth){
    const board=ctx.board;ctx.nodes++;if(fastBudget(ctx))return fastEvaluate(ctx,ply)|0;
    const inCheck=board.inCheck(),count=board.generateLegal(ply,!inCheck),repetitions=board.nullDepth?0:board.rep.get(board.hashHi0,board.hashHi1,board.hashLo0,board.hashLo1);
    if(board.half>=100||board.isInsufficient()||repetitions>=3){ctx.drawNodes++;return 0;}if(inCheck&&!count)return ((NEG_MATE|0)+(ply|0))|0;
    const stand=fastEvaluate(ctx,ply)|0;
    if(!inCheck){if(stand>=beta)return beta;if(stand>alpha)alpha=stand;if(qDepth<=0)return stand;if(count===0){if(board.generateLegal(ply,false)===0)return 0;return stand|0;}}
    else if(qDepth<=-6)return stand|0;
    fastSortMoves(ctx,ply,count,0);const list=board.moveLists[ply];let best=inCheck?NEG_INF:stand;
    for(let i=0;i<count;i++){
      if(ctx.stopped)break;const move=list[i],captured=(move>>>16)&15,see=captured?board.see(move):0;
      board.makeMoveWithAccumulator(ply,move);
      if(captured&&see<0&&!inCheck&&!board.inCheck()){board.unmakeMove(ply);ctx.seePrunes++;continue;}
      const score=0-fastQuiescence(ctx,0-beta,0-alpha,ply+1,qDepth-1);board.unmakeMove(ply);
      if(score>best)best=score;if(score>alpha)alpha=score;if(alpha>=beta)break;
    }
    return best|0;
  }
  function fastSortRootByScores(list,scores,count){for(let i=1;i<count;i++){const m=list[i],v=scores[i];let j=i-1;while(j>=0&&scores[j]<v){list[j+1]=list[j];scores[j+1]=scores[j];j--;}list[j+1]=m;scores[j+1]=v;}}
  function search(brain,chess,options={}){
    const start=now(),timeLimit=options.deterministicNodes?Infinity:Math.max(10,Number(options.maxTimeMs??options.timeMs)||420),nodeLimit=Math.max(1,Math.floor(Number(options.maxNodes??options.nodeLimit)||30000)),maxDepth=clamp(Math.floor(Number(options.maxDepth)||10),1,MAX_PLY-12);
    const board=new FastBoard(chess,MAX_PLY,brain.data.model),rootCount=board.generateLegal(0,false);
    if(!rootCount)return {move:null,depth:0,nodes:0,drawNodes:0,score:board.inCheck()?NEG_MATE:0,terminal:true};
    const rootRepetitions=board.rep.get(board.hashHi0,board.hashHi1,board.hashLo0,board.hashLo1);
    if(board.half>=150||board.isInsufficient()||rootRepetitions>=5)return {move:null,depth:0,nodes:0,drawNodes:0,score:0,terminal:true,draw:true,fastBoard:true};
    const rootList=board.moveLists[0];
    if(options.bookBinary&&(root.CheloPolyglotHash||root.ChesslingPolyglotHash)&&(root.CheloPolyglotBookLookup||root.ChesslingPolyglotBookLookup)){
      const hashFn=root.CheloPolyglotHash||root.ChesslingPolyglotHash,bookLookup=root.CheloPolyglotBookLookup||root.ChesslingPolyglotBookLookup;
      const legalBookMoves=new Array(rootCount);for(let i=0;i<rootCount;i++)legalBookMoves[i]={uci:board.uci(rootList[i])};
      const bookMove=bookLookup(options.bookBinary,hashFn(chess),legalBookMoves);
      if(bookMove)return {move:bookMove,depth:0,nodes:0,drawNodes:0,score:null,elapsed:Math.max(0,now()-start),nps:0,book:true,bookLookup:'binary-search',fastBoard:true,packedMoves:true,hashVerified:board.verifyKey(),maxNodes:nodeLimit,maxTimeMs:timeLimit,rootLegalMoves:rootCount};
    }
    board.initAccumulator(brain.data.model,brain.v14Adapter,brain.v14Mode,options.dualNnue===false?null:(options.dualNnueModel||((root.CheloDualNNUE||root.ChesslingDualNNUE)&&(root.CheloDualNNUE||root.ChesslingDualNNUE).model)),options.dualNnueAdapters||brain.data.dualLora);
    // These compact tables are learned during this search only. Clearing them
    // prevents prior calls from changing deterministic maxNodes results.
    COUNTERMOVE.fill(0);CONT_HISTORY.fill(0);
    const tt=options.sharedTTBuffer?new FastTT(options.sharedTTBuffer):SHARED_TT;tt.reset();const killers=new Int32Array(MAX_PLY*2),history=new Int32Array(2*4096),ttOut=new Int32Array(4),rootScores=new Int32Array(MAX_MOVES);
    const stopView=options.sharedStopView||(options.sharedStopBuffer?new Int32Array(options.sharedStopBuffer):null);
    const workerId=Number(options.workerId)||0;
    EVAL_GENERATION=(EVAL_GENERATION+1)&255;if(EVAL_GENERATION===0){EVAL_TAGS.fill(0);EVAL_GENERATION=1;}
    const ctx={brain,board,start,timeLimit,checkTime:Number.isFinite(timeLimit),nodeLimit,evalKeys:EVAL_KEYS,evalScores:EVAL_SCORES,evalTags:EVAL_TAGS,evalGeneration:EVAL_GENERATION,nodes:0,drawNodes:0,stopped:false,completedDepth:0,bestRoot:0,bestScore:NEG_INF,tt,killers,history,ttOut,rootScores,countermove:COUNTERMOVE,contHistory:CONT_HISTORY,seeCalls:0,seePrunes:0,nmpCalls:0,nmpR2Calls:0,nmpR3Calls:0,pvsResearches:0,lmrResearches:0,aspirationResearches:0,rfpPrunes:0,frontierFutilityPrunes:0,kpkProbes:0,usePvs:options.pvs!==false,stopView,stopIndex:Number(options.sharedStopIndex)||0,stopExpected:Number(options.sharedStopExpected??0)|0,stopSignalIndex:Number(options.sharedStopSignalIndex??2),stopLatencyIndex:Number(options.sharedStopLatencyIndex??3),workerId};
    fastSortMoves(ctx,0,rootCount,0);ctx.bestRoot=rootList[0];ctx.bestScore=NEG_INF;
    if(typeof options.__onSearchReady==='function')options.__onSearchReady();
    let previousScore=0;
    const firstDepth=clamp(Math.floor(Number(options.startDepth)||1),1,maxDepth);
    for(let depth=firstDepth;depth<=maxDepth;depth++){
      if(ctx.stopped)break;
      let window=depth===1||options.aspiration===false?INF:Math.max(1,Math.floor(Number(options.aspirationWindow)||64));
      let alpha=window===INF?NEG_INF:Math.max(NEG_INF,previousScore-window);
      let beta=window===INF?INF:Math.min(INF,previousScore+window);
      let iterationComplete=false,iterBest=NEG_INF,iterMove=0;
      while(!ctx.stopped&&!iterationComplete){
        const windowAlpha=alpha,windowBeta=beta;
        iterBest=NEG_INF;iterMove=0;
        for(let i=0;i<rootCount;i++){
          if(ctx.stopped)break;
          const move=rootList[i];board.makeMoveWithAccumulator(0,move);let score;
          if(i===0||options.rootPvs===false||!ctx.usePvs)score=0-fastNegamax(ctx,depth-1,0-beta,0-alpha,1,true);
          else{
            score=0-fastNegamax(ctx,depth-1,-alpha-1,-alpha,1,true);
            if(!ctx.stopped&&score>alpha&&score<beta){ctx.pvsResearches++;score=0-fastNegamax(ctx,depth-1,0-beta,0-alpha,1,true);}
          }
          board.unmakeMove(0);rootScores[i]=score;
          if(score>iterBest){iterBest=score;iterMove=move;}
          if(score>alpha)alpha=score;
        }
        if(ctx.stopped)break;
        if(iterBest<=windowAlpha&&windowAlpha>NEG_INF){ctx.aspirationResearches++;window=Math.min(INF,window*2);alpha=Math.max(NEG_INF,windowAlpha-window);beta=windowBeta;}
        else if(iterBest>=windowBeta&&windowBeta<INF){ctx.aspirationResearches++;window=Math.min(INF,window*2);alpha=windowAlpha;beta=Math.min(INF,windowBeta+window);}
        else iterationComplete=true;
      }
      if(!ctx.stopped&&iterationComplete&&iterMove){ctx.completedDepth=depth;ctx.bestRoot=iterMove;ctx.bestScore=iterBest;previousScore=iterBest;fastSortRootByScores(rootList,rootScores,rootCount);if(typeof options.__onIterationComplete==='function')options.__onIterationComplete(board.uci(iterMove),depth,iterBest,ctx.nodes);}
      if(ctx.stopped||ctx.nodes>=nodeLimit)break;
    }
    if(typeof options.__onSearchEnd==='function')options.__onSearchEnd(ctx.nodes,ctx.completedDepth);
    const move=board.uci(ctx.bestRoot),elapsed=Math.max(1,now()-start),hashOk=board.verifyKey();
    return {move,depth:ctx.completedDepth,nodes:ctx.nodes,drawNodes:ctx.drawNodes,score:ctx.bestScore===NEG_INF?null:ctx.bestScore,scoreExact:ctx.completedDepth>0,scoreBound:ctx.completedDepth>0?'exact':'none',workerId,elapsed,nps:Math.round(ctx.nodes*1000/elapsed),interrupted:ctx.stopped,ttSize:TT_SIZE,ttHits:tt.hits,ttStores:tt.stores,nullMovePruning:true,nullMoveR2Below6:true,nullMoveR3At6Plus:true,lmr:true,pvs:true,countermoveHistory:true,continuationHistory:true,reverseFutilityPruning:true,frontierFutilityPruning:true,kpkWdl:true,rfpPrunes:ctx.rfpPrunes,frontierFutilityPrunes:ctx.frontierFutilityPrunes,aspiration:options.aspiration!==false,see:true,seeCalls:ctx.seeCalls,seePrunes:ctx.seePrunes,nmpCalls:ctx.nmpCalls,nmpR2Calls:ctx.nmpR2Calls,nmpR3Calls:ctx.nmpR3Calls,pvsResearches:ctx.pvsResearches,lmrResearches:ctx.lmrResearches,aspirationResearches:ctx.aspirationResearches,incremental:true,fastBoard:true,packedMoves:true,zeroAllocationSourceHotPath:true,runtimeAllocationVerified:false,allocationStrategy:'preallocated-typed-buffers',lazyNnueAccumulator:true,maxLazyAccumulatorPending:board.maxPendingAccumulator,dualPerspectiveNnue:board.dualReady,dualNnueEvaluations:board.dualEvalCount,dualNnueMaxAbsAccumulator:board.dualMaxAbsAccumulator,repetitionTable:true,hashVerified:hashOk,maxNodes:nodeLimit,maxTimeMs:timeLimit,rootLegalMoves:rootCount};
  }
  root.CheloFastTT=FastTT;
  root.CheloFastBoard=FastBoard;
  root.CheloFastSearch={search,pack,probeKpkWdl,probeBareKingWin,scalarValue,divScalar31,constants:{MAX_PLY,MAX_MOVES,TT_SIZE}};
  root.ChesslingFastBoard=FastBoard;
  root.ChesslingFastSearch=root.CheloFastSearch; // Backward-compatible V15 runtime API.
})();
