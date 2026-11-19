/*
 * Chessling V4: compact, per-pet, on-device machine-learning brain.
 *
 * Learning architecture:
 *   1. A small 24 -> 12 -> 1 neural value model, trained online with TD feedback.
 *   2. A bounded experience-replay set, trained again after completed games.
 *   3. Habit memory and position/action memory remain as separate, interpretable
 *      episodic systems from the original Pawnling blueprint.
 *
 * The neural model starts with a neutral output layer. It is not preloaded with a
 * conventional chess evaluation table. Legal rules and search are shared; learned
 * model weights and experiences are individual to each pet.
 *
 * Honest limitation: this is a compact online-learning prototype, not a modern
 * grandmaster-strength neural chess engine. Its strength must be measured by the
 * held-out benchmarks documented in AI_MODEL_VALIDATION.md.
 */
(() => {
  'use strict';
  const LIMIT = 50 * 1024;
  const MAX_POSITIONS = 1000;
  const MAX_REPLAY = 128;
  const MAX_PENDING = 128;
  const INPUTS = 24;
  const HIDDEN = 12;
  const TYPES = ['p','n','b','r','q'];
  const POLICY_KEYS = ['center','advance','development','shelter'];
  const START_WEIGHTS = { p:100, n:110, b:110, r:120, q:130, k:9000 }; // V2 compatibility only; not used by the V4 evaluator.
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const now = () => Date.now();
  const byteLength = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const fenKey = fen => String(fen).trim().split(/\s+/).slice(0, 4).join(' ');
  const root = typeof window !== 'undefined' ? window : globalThis;
  const Core = () => root.ChessCore;

  function hash32(text) {
    let h = 2166136261;
    for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619); }
    return h >>> 0;
  }

  function createModel(seed = 1) {
    let state = (Number(seed) >>> 0) || 1;
    const random = () => {
      state = (Math.imul(state,1664525) + 1013904223) >>> 0;
      return (state / 4294967296) * 2 - 1;
    };
    return {
      w1:Array.from({length:INPUTS*HIDDEN},()=>Number((random()*0.08).toFixed(6))),
      b1:Array(HIDDEN).fill(0),
      w2:Array(HIDDEN).fill(0),
      b2:0,
      steps:0, episodes:0, loss:0, lastDelta:0
    };
  }

  class ChesslingBrain {
    constructor(storageKey='chessling_pet_1', options={}) {
      this.storageKey=storageKey;
      this.persist=options.persist!==false;
      this.data=options.data?this.normalise(options.data):this.load();
      this.lastSearch=null;
    }

    defaults() {
      const stamp=now();
      return {
        schema:4, petName:'Chessling', handle:'', trainerName:'', gen:1,
        elo:100, trainerReferenceElo:1000,
        wins:0, losses:0, draws:0, games:0, practiceGames:0,
        // Retained for V2 Soul compatibility and diagnostics. V4 does not use these
        // hand-authored values to evaluate positions.
        weights:{}, policy:{},
        traits:{bold:50,curious:50,patient:50},
        model:createModel(stamp), replay:[], memory:{}, humanOpenings:{}, openingReplies:{}, pending:[],
        geneticTrace:{p:0,n:0,b:0,r:0,q:0},
        lastHumanMove:null, createdAt:stamp, updatedAt:stamp
      };
    }

    normalise(source) {
      const base=this.defaults(), old=source&&typeof source==='object'?source:{};
      const data={...base,...old,schema:4};
      data.weights={...(old.weights||{})};
      data.policy={...(old.policy||{})};
      data.traits={...base.traits,...(old.traits||{})};
      for(const key of Object.keys(data.weights)) data.weights[key]=clamp(Number(data.weights[key])||START_WEIGHTS[key]||1,1,2000);
      for(const key of Object.keys(data.policy)) data.policy[key]=clamp(Number(data.policy[key])||0,-250,250);
      for(const key of Object.keys(data.traits)){const value=Number(data.traits[key]);data.traits[key]=clamp(Number.isFinite(value)?value:50,0,100);}
      data.memory=old.memory&&typeof old.memory==='object'?old.memory:{};
      data.humanOpenings=old.humanOpenings&&typeof old.humanOpenings==='object'?old.humanOpenings:{};
      data.openingReplies=old.openingReplies&&typeof old.openingReplies==='object'?old.openingReplies:{};
      data.pending=Array.isArray(old.pending)?old.pending.map(item=>({...item,x:Array.isArray(item.x)?item.x.map(v=>clamp(Number(v)||0,-100,100)):null})):[];
      data.replay=Array.isArray(old.replay)?old.replay.filter(item=>item&&Array.isArray(item.x)&&item.x.length===INPUTS).map(item=>({x:item.x.map(v=>clamp(Math.round(Number(v)||0),-100,100)),y:clamp(Number(item.y)||0,-100,100),n:Math.max(1,Number(item.n)||1),p:Math.max(0,Number(item.p)||0)})):[];
      data.geneticTrace={...base.geneticTrace,...(old.geneticTrace||{})};
      const model=old.model&&typeof old.model==='object'?old.model:null;
      if(model&&Array.isArray(model.w1)&&model.w1.length===INPUTS*HIDDEN){
        data.model={
          w1:model.w1.map(v=>clamp(Number(v)||0,-3,3)),
          b1:Array.from({length:HIDDEN},(_,i)=>clamp(Number(model.b1?.[i])||0,-3,3)),
          w2:Array.from({length:HIDDEN},(_,i)=>clamp(Number(model.w2?.[i])||0,-3,3)),
          b2:clamp(Number(model.b2)||0,-3,3),
          steps:Math.max(0,Math.floor(Number(model.steps)||0)),
          episodes:Math.max(0,Math.floor(Number(model.episodes)||0)),
          loss:clamp(Number(model.loss)||0,0,2),
          lastDelta:clamp(Number(model.lastDelta)||0,-2,2)
        };
      } else data.model=base.model;
      data.elo=Math.max(100,Number.isFinite(Number(data.elo))?Math.round(Number(data.elo)):100);
      for(const field of ['wins','losses','draws','games','practiceGames','gen']) data[field]=Math.max(0,Math.floor(Number(data[field])||(field==='gen'?1:0)));
      // Upgrade old pending entries that contain FEN but no neural feature vector.
      for(const item of data.pending) if(!item.x&&item.f) item.x=this.featuresFromFen(item.f,item.side||'b');
      return data;
    }

    load() {
      if(!this.persist)return this.defaults();
      try{
        const raw=localStorage.getItem(this.storageKey);if(!raw)return this.defaults();
        const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object')return this.defaults();
        return this.normalise(this.expandData(parsed));
      }catch(error){console.warn('Chessling started a fresh brain because its save could not be read.',error);return this.defaults();}
    }

    compactData(data=this.data) {
      const packMap=(source,kind)=>Object.entries(source||{}).map(([fen,moves])=>[fen,Object.entries(moves||{}).map(([move,value])=>kind==='memory'
        ?[move,Number(value.score)||0,Number(value.visits)||0,Number(value.mirror)||0,Number(value.outcomes)||0,Number(value.last)||0]
        :kind==='opening'?[move,Number(value.count)||0,Number(value.last)||0]:[move,Number(value.count)||0,Number(value.score)||0,Number(value.last)||0])]);
      const model=data.model||createModel(data.createdAt);
      return {
        v:4,
        i:[data.petName,data.handle,data.trainerName,data.gen,data.elo,data.trainerReferenceElo,data.wins,data.losses,data.draws,data.games,data.practiceGames],
        w:TYPES.concat(['k']).map(key=>Number(data.weights?.[key])||0),
        a:POLICY_KEYS.map(key=>Number(data.policy?.[key])||0),
        t:['bold','curious','patient'].map(key=>Number(data.traits?.[key])||0),
        n:{w:model.w1.map(v=>Number(Number(v).toFixed(5))),b:model.b1.map(v=>Number(Number(v).toFixed(5))),o:model.w2.map(v=>Number(Number(v).toFixed(5))),z:Number(Number(model.b2).toFixed(5)),s:model.steps||0,e:model.episodes||0,l:Number(Number(model.loss||0).toFixed(5)),d:Number(Number(model.lastDelta||0).toFixed(5))},
        r:(data.replay||[]).map(item=>[item.x,item.y,item.n,item.p]),
        m:packMap(data.memory,'memory'),h:packMap(data.humanOpenings,'opening'),o:packMap(data.openingReplies,'reply'),
        q:(data.pending||[]).map(item=>[item.f,item.m,item.x,item.r?1:0,item.ply,item.side,item.at||0,item.pred||0]),
        g:TYPES.map(key=>Number(data.geneticTrace?.[key])||0),
        l:data.lastHumanMove?[data.lastHumanMove.fen,data.lastHumanMove.move,data.lastHumanMove.mirror,data.lastHumanMove.ply,data.lastHumanMove.at]:null,
        c:Number(data.createdAt)||0,u:Number(data.updatedAt)||0
      };
    }

    expandData(source) {
      if(!source||!Array.isArray(source.i)||(source.v!==3&&source.v!==4))return source;
      const i=source.i;
      const unpackMap=(rows,kind)=>Object.fromEntries((Array.isArray(rows)?rows:[]).map(row=>{
        const entries=Array.isArray(row?.[1])?row[1]:[];
        return [row?.[0],Object.fromEntries(entries.map(item=>kind==='memory'?[item[0],{score:item[1],visits:item[2],mirror:item[3],outcomes:item[4],last:item[5]}]:kind==='opening'?[item[0],{count:item[1],last:item[2]}]:[item[0],{count:item[1],score:item[2],last:item[3]}]))];
      }));
      const types=TYPES.concat(['k']);
      const expanded={
        schema:source.v,petName:i[0]||'Chessling',handle:i[1]||'',trainerName:i[2]||'',gen:i[3]||1,elo:i[4]||100,trainerReferenceElo:i[5]||1000,
        wins:i[6]||0,losses:i[7]||0,draws:i[8]||0,games:i[9]||0,practiceGames:i[10]||0,
        weights:Object.fromEntries(types.map((key,index)=>[key,source.w?.[index]])),
        policy:Object.fromEntries(POLICY_KEYS.map((key,index)=>[key,source.a?.[index]])),
        traits:{bold:source.t?.[0],curious:source.t?.[1],patient:source.t?.[2]},
        memory:unpackMap(source.m,'memory'),humanOpenings:unpackMap(source.h,'opening'),openingReplies:unpackMap(source.o,'reply'),
        pending:(Array.isArray(source.q)?source.q:[]).map(item=>source.v===4?{f:item[0],m:item[1],x:item[2],r:!!item[3],ply:item[4],side:item[5],at:item[6],pred:item[7]}:{f:item[0],m:item[1],p:item[2],e:item[3],b:item[4],d:Object.fromEntries(POLICY_KEYS.map((key,index)=>[key,item[5]?.[index]||0])),r:item[6],ply:item[7],side:item[8],at:item[9]}),
        geneticTrace:Object.fromEntries(TYPES.map((key,index)=>[key,source.g?.[index]||0])),
        lastHumanMove:source.l?{fen:source.l[0],move:source.l[1],mirror:source.l[2],ply:source.l[3],at:source.l[4]}:null,
        createdAt:source.c||now(),updatedAt:source.u||now()
      };
      if(source.v===4){
        expanded.model={w1:source.n?.w,b1:source.n?.b,w2:source.n?.o,b2:source.n?.z,steps:source.n?.s,episodes:source.n?.e,loss:source.n?.l,lastDelta:source.n?.d};
        expanded.replay=(source.r||[]).map(item=>({x:item[0],y:item[1],n:item[2],p:item[3]}));
      }
      return expanded;
    }

    size(){return byteLength(this.compactData());}
    memoryCount(){return Object.keys(this.data.memory).length;}

    pruneToBudget(){
      const latest=value=>{let n=Number(value?.last)||0;if(value&&typeof value==='object')for(const child of Object.values(value))n=Math.max(n,Number(child?.last)||0);return n;};
      while(this.data.pending.length>MAX_PENDING)this.data.pending.shift();
      while(this.data.replay.length>MAX_REPLAY)this.data.replay.shift();
      while(this.memoryCount()>MAX_POSITIONS||this.size()>LIMIT-128){
        const keys=Object.keys(this.data.memory).sort((a,b)=>latest(this.data.memory[a])-latest(this.data.memory[b]));
        if(!keys.length)break;delete this.data.memory[keys[0]];
      }
      const pruneMap=map=>{const keys=Object.keys(map).sort((a,b)=>latest(map[a])-latest(map[b]));while(keys.length&&this.size()>LIMIT-128)delete map[keys.shift()];};
      pruneMap(this.data.humanOpenings);pruneMap(this.data.openingReplies);
      while(this.data.replay.length&&this.size()>LIMIT-128){
        let worst=0;for(let i=1;i<this.data.replay.length;i++)if((this.data.replay[i].p||0)<(this.data.replay[worst].p||0))worst=i;
        this.data.replay.splice(worst,1);
      }
      while(this.data.pending.length&&this.size()>LIMIT-128){
        const resolved=this.data.pending.findIndex(item=>item.r);
        this.data.pending.splice(resolved>=0?resolved:0,1);
      }
      if(this.size()>LIMIT){this.data.memory={};this.data.humanOpenings={};this.data.openingReplies={};this.data.replay=[];while(this.data.pending.length&&this.size()>LIMIT)this.data.pending.shift();}
      if(this.size()>LIMIT)throw new Error('Chessling core data exceeds the 50 KiB storage budget.');
    }

    save(){
      this.data.updatedAt=now();this.pruneToBudget();if(!this.persist)return true;
      try{localStorage.setItem(this.storageKey,JSON.stringify(this.compactData()));return true;}
      catch(error){try{this.data.memory={};this.data.humanOpenings={};this.data.openingReplies={};this.pruneToBudget();localStorage.setItem(this.storageKey,JSON.stringify(this.compactData()));return true;}catch(second){console.error('Chessling could not save its brain.',second);return false;}}
    }

    simplifyFen(fen){return fenKey(fen);}

    entry(fen,move){const key=this.simplifyFen(fen);this.data.memory[key]||={};this.data.memory[key][move]||={score:0,visits:0,mirror:0,outcomes:0,last:now()};const item=this.data.memory[key][move];item.last=now();return item;}

    observeHumanMove(fen,move,ply=0){
      const key=this.simplifyFen(fen);
      if(ply<=12){this.data.humanOpenings[key]||={};const item=this.data.humanOpenings[key][move]||{count:0,last:0};item.count++;item.last=now();this.data.humanOpenings[key][move]=item;}
      const flip=s=>s[0]+(9-Number(s[1]));
      const mirror=/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)?flip(move.slice(0,2))+flip(move.slice(2,4))+(move[4]||''):'';
      this.data.lastHumanMove={fen:key,move,mirror,ply,at:now()};this.save();
    }

    /* 24 shared board descriptors. The pet learns their importance; these are not
       preassigned centipawn values or opening-book answers. */
    extractFeatures(chess,perspective=chess.turn()){
      const board=chess.board(), own=perspective, opp=own==='w'?'b':'w';
      const counts={w:{p:0,n:0,b:0,r:0,q:0},b:{p:0,n:0,b:0,r:0,q:0}};
      const pawnSquares={w:[],b:[]};
      const central={w:{p:0,n:0,b:0,r:0,q:0,k:0},b:{p:0,n:0,b:0,r:0,q:0,k:0}};
      const pawns={w:Array(8).fill(0),b:Array(8).fill(0)};
      const kings={};const rooks=[];let pawnAdvance={w:0,b:0},development={w:0,b:0},centerOccupancy={w:0,b:0},space={w:0,b:0};
      const files='abcdefgh';
      const homeSquares={w:new Set(['b1','g1','c1','f1']),b:new Set(['b8','g8','c8','f8'])};
      const centerSquares=[[3,3],[3,4],[4,3],[4,4]];
      for(let r=0;r<8;r++)for(let c=0;c<8;c++){
        const piece=board[r][c];if(!piece)continue;
        const color=piece.color,type=piece.type,sign=color===own?1:-1;
        if(counts[color][type]!==undefined)counts[color][type]++;
        const cx=1-Math.abs(3.5-c)/3.5,cy=1-Math.abs(3.5-r)/3.5;
        central[color][type]+=clamp((cx+cy)/2,0,1);
        if(type==='p'){
          pawns[color][c]++;pawnSquares[color].push({r,file:c});
          pawnAdvance[color]+=color==='w'?(6-r)/6:(r-1)/6;
        }
        if((type==='n'||type==='b')&&!homeSquares[color].has(files[c]+(8-r)))development[color]++;
        if(centerSquares.some(([rr,cc])=>rr===r&&cc===c))centerOccupancy[color]++;
        if(color==='w'?r<4:r>3)space[color]++;
        if(type==='k')kings[color]={r,c};
        if(type==='r')rooks.push({color,file:c});
      }
      const f=Array(INPUTS).fill(0);
      const max={p:8,n:2,b:2,r:2,q:1};
      TYPES.forEach((type,i)=>f[i]=clamp((counts[own][type]-counts[opp][type])/max[type],-1,1));
      const pieceTypes=['p','n','b','r','q','k'];
      pieceTypes.forEach((type,i)=>{
        const denom=type==='p'?8:type==='q'?1:2;
        f[5+i]=clamp((central[own][type]-central[opp][type])/denom,-1,1);
      });
      f[11]=clamp((pawnAdvance[own]-pawnAdvance[opp])/8,-1,1);
      f[12]=clamp((development[own]-development[opp])/4,-1,1);
      f[13]=clamp((centerOccupancy[own]-centerOccupancy[opp])/4,-1,1);
      let centerControl={w:0,b:0};
      if(typeof chess.attacked==='function')for(const [r,c] of centerSquares){const square=r*16+c;if(chess.attacked(square,'w'))centerControl.w++;if(chess.attacked(square,'b'))centerControl.b++;}
      f[14]=clamp((centerControl[own]-centerControl[opp])/4,-1,1);
      f[15]=clamp((Number(counts[own].b>=2)-Number(counts[opp].b>=2)),-1,1);
      const doubled=color=>pawns[color].reduce((sum,n)=>sum+Math.max(0,n-1),0);
      f[16]=clamp((doubled(opp)-doubled(own))/4,-1,1);
      const isolated=color=>pawns[color].reduce((sum,n,file)=>n&&!(pawns[color][file-1]||0)&&!(pawns[color][file+1]||0)?sum+n:sum,0);
      f[17]=clamp((isolated(opp)-isolated(own))/4,-1,1);
      const passed=color=>{
        const enemy=color==='w'?'b':'w';let total=0;
        for(const pawn of pawnSquares[color]){
          const blocked=pawnSquares[enemy].some(other=>Math.abs(other.file-pawn.file)<=1&&(color==='w'?other.r<pawn.r:other.r>pawn.r));
          if(!blocked)total++;
        }
        return total;
      };
      f[18]=clamp((passed(own)-passed(opp))/4,-1,1);
      const openFiles=color=>rooks.filter(rook=>rook.color===color&&!pawns[color][rook.file]).length;
      f[19]=clamp((openFiles(own)-openFiles(opp))/2,-1,1);
      const shelter=color=>{
        const king=kings[color];if(!king)return 0;let n=0;const dir=color==='w'?-1:1;
        for(let df=-1;df<=1;df++){const file=king.c+df,rank=king.r+dir;if(file>=0&&file<8&&rank>=0&&rank<8){const p=board[rank][file];if(p&&p.type==='p'&&p.color===color)n++;}}
        return n;
      };
      f[20]=clamp((shelter(own)-shelter(opp))/3,-1,1);
      const fen=chess.fen(),rights=(fen.split(/\s+/)[2]||'-');
      f[21]=clamp(((Number(rights.includes(own==='w'?'K':'k'))+Number(rights.includes(own==='w'?'Q':'q')))-(Number(rights.includes(opp==='w'?'K':'k'))+Number(rights.includes(opp==='w'?'Q':'q'))))/2,-1,1);
      const ownInCheck=typeof chess.inCheck==='function'&&chess.inCheck(own);
      const oppInCheck=typeof chess.inCheck==='function'&&chess.inCheck(opp);
      f[22]=clamp(Number(oppInCheck)-Number(ownInCheck),-1,1);
      f[23]=clamp((space[own]-space[opp])/16,-1,1);
      return f.map(v=>clamp(Number(v)||0,-1,1));
    }

    featuresFromFen(fen,perspective='b'){
      try{const C=Core();if(!C)return Array(INPUTS).fill(0);const chess=new C(fen);return this.quantise(this.extractFeatures(chess,perspective));}
      catch{return Array(INPUTS).fill(0);}
    }

    quantise(features){return features.map(value=>clamp(Math.round(value*100),-100,100));}
    dequantise(features){return features.map(value=>clamp(Number(value)||0,-100,100)/100);}

    forward(features){
      const x=features.length===INPUTS?features:Array(INPUTS).fill(0),m=this.data.model;
      const hidden=Array(HIDDEN).fill(0);
      for(let h=0;h<HIDDEN;h++){
        let z=m.b1[h]||0;const offset=h*INPUTS;
        for(let i=0;i<INPUTS;i++)z+=(m.w1[offset+i]||0)*x[i];
        hidden[h]=Math.tanh(z);
      }
      let output=m.b2||0;for(let h=0;h<HIDDEN;h++)output+=(m.w2[h]||0)*hidden[h];
      return {value:Math.tanh(output),hidden};
    }

    predict(features){return this.forward(features).value;}

    trainSample(quantised,target,importance=1){
      const x=Array.isArray(quantised)&&quantised.length===INPUTS?this.dequantise(quantised):Array(INPUTS).fill(0);
      target=clamp(Number(target)||0,-1,1);importance=clamp(Number(importance)||1,0.05,2);
      const m=this.data.model,{value,hidden}=this.forward(x);
      const error=target-value;
      const rate=0.018/Math.sqrt(1+m.steps/5000);
      const delta=error*(1-value*value)*importance;
      const oldW2=m.w2.slice();
      for(let h=0;h<HIDDEN;h++)m.w2[h]=clamp(m.w2[h]+rate*delta*hidden[h],-3,3);
      m.b2=clamp(m.b2+rate*delta,-3,3);
      for(let h=0;h<HIDDEN;h++){
        const back=delta*oldW2[h]*(1-hidden[h]*hidden[h]);
        m.b1[h]=clamp(m.b1[h]+rate*back,-3,3);
        const offset=h*INPUTS;
        for(let i=0;i<INPUTS;i++)m.w1[offset+i]=clamp(m.w1[offset+i]+rate*back*x[i],-3,3);
      }
      m.steps++;
      const loss=error*error;m.loss=m.steps===1?loss:m.loss*0.98+loss*0.02;m.lastDelta=error;
      return {before:value,error,loss};
    }

    addReplay(x,target,priority=0){
      const key=x.join(',');const existing=this.data.replay.find(item=>item.x.join(',')===key);
      if(existing){
        // Replay targets are stored as integer hundredths. Convert the incoming
        // [-1, 1] target to the same scale before averaging; mixing units here
        // would silently dilute repeated lessons toward zero.
        existing.y=clamp(Math.round((existing.y*existing.n+clamp(target,-1,1)*100)/(existing.n+1)),-100,100);
        existing.n++;
        existing.p=Math.max(existing.p,Math.round(clamp(priority,0,2)*100));
        return;
      }
      this.data.replay.push({x:x.slice(),y:Math.round(clamp(target,-1,1)*100),n:1,p:Math.round(clamp(priority,0,2)*100)});
      if(this.data.replay.length>MAX_REPLAY){
        this.data.replay.sort((a,b)=>b.p-a.p);this.data.replay.length=MAX_REPLAY;
      }
    }

    replayLearn(){
      const selected=this.data.replay.slice().sort((a,b)=>b.p-a.p).slice(0,48);
      for(let epoch=0;epoch<3;epoch++)for(const item of selected){
        const target=item.y/100;const importance=clamp(0.65+Math.min(0.5,item.p/200),0.5,1.2);
        this.trainSample(item.x,target,importance);
      }
      this.data.model.episodes++;
    }

    materialSignal(type){
      const index=TYPES.indexOf(type);if(index<0)return 0;
      const baseline=this.predict(Array(INPUTS).fill(0));const x=Array(INPUTS).fill(0);x[index]=0.5;
      return clamp((this.predict(x)-baseline)*2,-1,1);
    }

    evaluate(chess,perspective=chess.turn()){
      const value=this.predict(this.extractFeatures(chess,perspective));
      // Mate scores are handled separately by search. This is only the learned positional value.
      return Math.round(value*1000);
    }

    observePetMove(fen,move,meta={},ply=0,chessAfter=null){
      const key=this.simplifyFen(fen),side=meta.side==='w'?'w':meta.side==='b'?'b':(String(fen).split(/\s+/)[1]||'b');
      const entry=this.entry(key,move);entry.visits++;
      const isNew=entry.visits===1,piece=meta.piece||'p';
      if(meta.captured)this.data.traits.bold=clamp(this.data.traits.bold+0.6,0,100);
      if(isNew)this.data.traits.curious=clamp(this.data.traits.curious+0.3,0,100);
      if(!meta.captured&&!meta.gaveCheck)this.data.traits.patient=clamp(this.data.traits.patient+0.2,0,100);
      const x=this.featuresFromFen(fen,side);
      this.data.pending.push({f:key,m:move,x,r:0,ply,side,at:now(),pred:this.predict(this.dequantise(x))});
      if(ply<=12&&chessAfter){
        this.data.openingReplies[key]||={};const reply=this.data.openingReplies[key][move]||{count:0,score:0,last:0};reply.count++;reply.last=now();this.data.openingReplies[key][move]=reply;
      }
      if(chessAfter)this.recordGeneticPosition(chessAfter,side);
      this.save();
    }

    recordGeneticPosition(chess,side='b'){
      if(!chess)return;
      const counts={p:0,n:0,b:0,r:0,q:0};
      for(const row of chess.board())for(const piece of row)if(piece&&piece.color===side&&counts[piece.type]!==undefined)counts[piece.type]++;
      for(const type of TYPES)this.data.geneticTrace[type]=(this.data.geneticTrace[type]||0)*0.94+counts[type]*0.06;
    }

    resolveLastPetMove(chess){
      let item=null;for(let i=this.data.pending.length-1;i>=0;i--)if(!this.data.pending[i].r){item=this.data.pending[i];break;}
      if(!item)return;
      let target=0;
      if(chess&&typeof chess.game_over==='function'&&chess.game_over()){
        const result=chess.result();target=result==='draw'?0:result===item.side?0.95:-0.95;
      }else{
        const next=this.extractFeatures(chess,item.side);
        target=0.94*this.predict(next); // two plies elapsed, so it is the same side's turn again.
      }
      const learned=this.trainSample(item.x,target,0.9);
      item.r=1;
      const entry=this.entry(item.f,item.m);
      entry.score=clamp(entry.score+learned.error*18,-100,100);entry.outcomes+=chess?.game_over?.()?1:0;
      this.data.model.lastDelta=learned.error;
      this.save();
    }

    generation(){const g=this.data.gen;if(g<2)return 'Hatchling';if(g<4)return 'Apprentice Tactician';if(g<8)return 'Trap Hunter';if(g<15)return 'Veteran Strategist';return 'Chess Monster';}
    personality(){const traits=this.data.traits,ranked=Object.entries(traits).sort((a,b)=>b[1]-a[1]);if(ranked[0][1]-ranked[1][1]<5)return 'Still finding its style';return ranked[0][0]==='bold'?'Bold and tactical':ranked[0][0]==='curious'?'Curious explorer':'Patient planner';}

    orderMoves(chess,moves,ttMove=null){
      return moves.sort((a,b)=>{
        const score=move=>{
          let value=0;if(ttMove&&move.uci===ttMove)value+=100000;
          if(move.captured)value+=10000; if(move.promotion)value+=8000;
          const key=this.simplifyFen(chess.fen()),remembered=this.data.memory[key]?.[move.uci];
          if(remembered)value+=remembered.score*4;
          return value;
        };
        return score(b)-score(a);
      });
    }

    chooseMove(chess,options={}){
      const legal=chess.moves({verbose:true,skipSan:true});if(!legal.length)return {move:null,depth:0,nodes:0,score:null};
      const start=now(),timeLimit=Math.max(80,Number(options.timeMs)||450),nodeLimit=Math.max(1000,Number(options.nodeLimit)||35000),maxDepth=5;
      const memoryKey=this.simplifyFen(chess.fen()),remembered=this.data.memory[memoryKey]||{},book=this.data.openingReplies[memoryKey]||{};
      const currentFullMove=Number(chess.fen().split(' ')[5])||1;
      const mirroredHabit=currentFullMove<=6?this.data.lastHumanMove?.mirror:'';
      const mirroredCount=this.data.lastHumanMove?.fen?(this.data.humanOpenings[this.data.lastHumanMove.fen]?.[this.data.lastHumanMove.move]?.count||0):0;
      const table=new Map(),MATE=30000,INF=32000;let nodes=0,stopped=false;const deadline=start+timeLimit;
      const terminal=(position,moves,ply)=>!moves.length?(position.inCheck()?-MATE+ply:0):null;
      const evaluateForTurn=position=>this.evaluate(position,position.turn());
      const quiescence=(position,alpha,beta,ply,qDepth)=>{
        nodes++;if(nodes>=nodeLimit||now()>=deadline){stopped=true;return evaluateForTurn(position);}
        const inCheck=position.inCheck(),all=position.moves({verbose:true,skipSan:true}),end=terminal(position,all,ply);if(end!==null)return end;
        const stand=evaluateForTurn(position);
        if(!inCheck){if(stand>=beta)return beta;if(stand>alpha)alpha=stand;if(qDepth<=0)return stand;}
        else if(qDepth<=-6){let best=-INF;for(const move of all){position.move(move.uci,{skipSan:true});const score=-evaluateForTurn(position);position.undo();best=Math.max(best,score);}return best;}
        const candidates=inCheck?all:all.filter(m=>m.captured||m.promotion),ordered=this.orderMoves(position,candidates);let best=inCheck?-INF:stand;
        for(const move of ordered){if(stopped)break;position.move(move.uci,{skipSan:true});const score=-quiescence(position,-beta,-alpha,ply+1,qDepth-1);position.undo();best=Math.max(best,score);alpha=Math.max(alpha,score);if(alpha>=beta)break;}
        return best;
      };
      const negamax=(position,depth,alpha,beta,ply)=>{
        nodes++;if(nodes>=nodeLimit||now()>=deadline){stopped=true;return evaluateForTurn(position);}
        const moves=position.moves({verbose:true,skipSan:true}),end=terminal(position,moves,ply);if(end!==null)return end;
        if(position.s.half>=150||position.positions.filter(k=>k===position.positionKey()).length>=5||position.insufficient())return 0;
        if(depth<=0)return quiescence(position,alpha,beta,ply,4);
        const key=position.positionKey()+`|${position.s.half}`,cached=table.get(key),alphaOriginal=alpha;
        if(cached&&cached.depth>=depth){if(cached.flag==='exact')return cached.score;if(cached.flag==='lower')alpha=Math.max(alpha,cached.score);else if(cached.flag==='upper')beta=Math.min(beta,cached.score);if(alpha>=beta)return cached.score;}
        const ordered=this.orderMoves(position,moves,cached?.best||null);let best=-INF,bestMove=null;
        for(const move of ordered){if(stopped)break;position.move(move.uci,{skipSan:true});const score=-negamax(position,depth-1,-beta,-alpha,ply+1);position.undo();if(score>best){best=score;bestMove=move.uci;}alpha=Math.max(alpha,score);if(alpha>=beta)break;}
        table.set(key,{depth,score:best,flag:best<=alphaOriginal?'upper':best>=beta?'lower':'exact',best:bestMove});return best;
      };
      let rootResults=legal.map(move=>({move:move.uci,score:-INF})),completedDepth=0,previousBest=null;
      for(let depth=1;depth<=maxDepth;depth++){
        if(stopped)break;const ordered=this.orderMoves(chess,legal.slice(),previousBest),iteration=[];
        for(const move of ordered){if(stopped)break;chess.move(move.uci,{skipSan:true});const score=-negamax(chess,depth-1,-INF,INF,1);chess.undo();iteration.push({move:move.uci,score});}
        if(iteration.length===legal.length){rootResults=iteration;rootResults.sort((a,b)=>b.score-a.score);completedDepth=depth;previousBest=rootResults[0]?.move||previousBest;}
        if(now()>=deadline||nodes>=nodeLimit)break;
      }
      if(completedDepth===0)rootResults=legal.map(move=>{chess.move(move.uci,{skipSan:true});const score=-this.evaluate(chess,chess.turn());chess.undo();return {move:move.uci,score};});
      const mirrorLegal=!!mirroredHabit&&legal.some(move=>move.uci===mirroredHabit);
      const mirrorProbability=mirrorLegal?Math.min(0.72,0.22+Math.log2(1+mirroredCount)*0.18):0;
      const mirrorRoll=hash32(`${memoryKey}|${mirroredHabit}|${this.data.games}|habit`)/0xffffffff;
      const mirrorThisTurn=mirrorLegal&&mirrorRoll<mirrorProbability?mirroredHabit:null;
      const score=item=>{
        const learnt=remembered[item.move]?.score||0;
        if(Math.abs(item.score)>=MATE-1000)return item.score*100+learnt;
        const reply=book[item.move]?Math.min(180,50+book[item.move].count*18+book[item.move].score*2):0;
        const mirror=mirrorThisTurn&&item.move===mirrorThisTurn?1800:0;
        const exploration=((hash32(`${memoryKey}|${item.move}|${this.data.games}`)/0xffffffff)-0.5)*60;
        return item.score+learnt*2.4+reply+mirror+exploration;
      };
      rootResults.sort((a,b)=>score(b)-score(a));
      const result={move:rootResults[0]?.move||legal[0].uci,depth:completedDepth,nodes,score:rootResults[0]?.score??null,elapsed:now()-start,mirrorProbability,mirrored:!!mirrorThisTurn};this.lastSearch=result;return result;
    }

    outcomeFor(item,winner){return winner==='draw'?0:winner===item.side?0.9:-0.9;}

    reinforce(outcome,finalPosition=null){
      const practice=outcome==='practice';const result=finalPosition&&typeof finalPosition.result==='function'?finalPosition.result():null;
      const winner=result==='w'||result==='b'?result:result==='draw'?'draw':(practice?'draw':outcome==='win'?'b':outcome==='loss'?'w':'draw');
      const baseReward=outcome==='win'?15:outcome==='loss'?-20:2;
      for(let i=0;i<this.data.pending.length;i++){
        const item=this.data.pending[i],target=this.outcomeFor(item,winner);
        if(item.x){
          const trained=this.trainSample(item.x,target,0.75);
          this.addReplay(item.x,target,Math.abs(trained.error));
          const memory=this.entry(item.f,item.m),recency=Math.pow(0.97,this.data.pending.length-1-i);
          const moveReward=practice?(target>0?15:target<0?-20:2):baseReward;
          memory.score=clamp(memory.score+moveReward*recency,-100,100);memory.outcomes++;memory.last=now();
        }
      }
      this.replayLearn();
      if(practice){
        this.data.practiceGames++;
        // No self-play result changes any rating, competitive record, or ranked statistic.
      }else{
        this.data.games++;
        if(outcome==='win')this.data.wins++;else if(outcome==='loss')this.data.losses++;else this.data.draws++;
        // Kept as a local, provisional growth meter for continuity. It is NOT Arena Elo.
        const baseline=this.data.trainerReferenceElo||1000,expected=1/(1+Math.pow(10,(baseline-this.data.elo)/400));
        const actual=outcome==='win'?1:outcome==='draw'?0.5:0;
        this.data.elo=Math.max(100,this.data.elo+Math.round(24*(actual-expected)));
      }
      this.data.gen=1+Math.floor(this.data.model.episodes/8);
      this.data.pending=[];this.data.geneticTrace={p:0,n:0,b:0,r:0,q:0};this.data.lastHumanMove=null;this.save();
    }

    resetPending(){this.data.pending=[];this.data.geneticTrace={p:0,n:0,b:0,r:0,q:0};this.data.lastHumanMove=null;this.save();}

    exportSoul(activeMatch=null){
      const result={format:'Chessling Soul',version:4,encoding:'compact-neural-json-v4',exportedAt:new Date().toISOString(),pet:this.compactData()};
      if(activeMatch)result.activeMatch=activeMatch;
      if(this.size()>LIMIT)throw new Error('Chessling brain exceeds the 50 KiB budget.');
      return JSON.stringify(result,null,2);
    }

    importSoul(object){
      const source=object?.pet||object,expanded=this.expandData(source);
      if(!expanded||typeof expanded!=='object'||(!expanded.weights&&!expanded.model)||!expanded.memory)throw new Error('This is not a valid Chessling Soul.');
      const incoming=this.normalise(expanded);
      if(byteLength(this.compactData(incoming))>LIMIT)throw new Error('This Soul is larger than the 50 KiB brain budget.');
      const previous=this.data;this.data=incoming;
      try{if(!this.save())throw new Error('The Soul could not be saved on this device.');}catch(error){this.data=previous;throw error;}
      if(this.size()>LIMIT){this.data=previous;throw new Error('Soul exceeds the 50 KiB brain budget.');}
      return object?.activeMatch||null;
    }
  }

  root.ChesslingBrain=ChesslingBrain;
  root.CHESSLING_BRAIN_LIMIT=LIMIT;
  root.CHESSLING_MODEL_INPUTS=INPUTS;
  root.CHESSLING_MODEL_HIDDEN=HIDDEN;
})();
