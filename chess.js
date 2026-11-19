/* Chessling ChessCore: compact offline chess rules engine. No network dependency. */
(() => {
  const FILES = 'abcdefgh';
  const OFFSETS = { n:[-33,-31,-18,-14,14,18,31,33], b:[-17,-15,15,17], r:[-16,-1,1,16], q:[-17,-16,-15,-1,1,15,16,17], k:[-17,-16,-15,-1,1,15,16,17] };
  const on = i => i >= 0 && i < 128 && !(i & 0x88);
  const idx = s => (8 - Number(s[1])) * 16 + FILES.indexOf(s[0]);
  const name = i => FILES[i & 7] + (8 - (i >> 4));
  const colorOf = p => !p ? null : p === p.toUpperCase() ? 'w' : 'b';
  const typeOf = p => p ? p.toLowerCase() : null;
  const clone = s => ({ b:s.b.slice(), t:s.t, c:s.c, ep:s.ep, half:s.half, full:s.full });

  class ChessCore {
    constructor(fen) { this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'); }
    load(fen) {
      const f=fen.trim().split(/\s+/), rows=f[0].split('/');
      if(rows.length!==8 || !/^[wb]$/.test(f[1]) || !/^(?:-|K?Q?k?q?)$/.test(f[2]) || !/^(?:-|[a-h][36])$/.test(f[3])) throw new Error('Invalid FEN');
      const b=Array(128).fill(null);
      rows.forEach((row,r)=>{ let c=0; for(const ch of row){ if(/[1-8]/.test(ch)) c+=Number(ch); else { if(!/[prnbqkPRNBQK]/.test(ch)||c>7) throw new Error('Invalid FEN rank'); b[r*16+c++]=ch; } } if(c!==8) throw new Error('Invalid FEN rank'); });
      if(b.filter(x=>x==='K').length!==1 || b.filter(x=>x==='k').length!==1) throw new Error('FEN needs both kings');
      this.s={b,t:f[1],c:f[2]==='-'?'':f[2],ep:f[3]==='-'?-1:idx(f[3]),half:Number(f[4]||0),full:Number(f[5]||1)};
      this.history=[]; this.positions=[this.positionKey()]; return true;
    }
    turn(){return this.s.t;}
    fen(){
      const rows=[]; for(let r=0;r<8;r++){let row='',empty=0;for(let c=0;c<8;c++){const p=this.s.b[r*16+c];if(!p)empty++;else{if(empty)row+=empty;empty=0;row+=p;}}if(empty)row+=empty;rows.push(row);}
      return `${rows.join('/')} ${this.s.t} ${this.s.c||'-'} ${this.s.ep<0?'-':name(this.s.ep)} ${this.s.half} ${this.s.full}`;
    }
    positionKey(){return this.s.b.map((p,i)=>on(i)?(p||'.'):'').join('')+' '+this.s.t+' '+this.s.c+' '+this.s.ep;}
    board(){const out=[];for(let r=0;r<8;r++){const row=[];for(let c=0;c<8;c++){const p=this.s.b[r*16+c];row.push(p?{type:typeOf(p),color:colorOf(p)}:null);}out.push(row);}return out;}
    get(square){const p=this.s.b[idx(square)];return p?{type:typeOf(p),color:colorOf(p)}:null;}
    attacked(target, by, state=this.s){
      const b=state.b;
      // Pawn attacks
      const pawn=by==='w'?'P':'p', pawnFrom=target+(by==='w'?16:-16);
      for(const d of [-1,1]) if(on(pawnFrom+d)&&b[pawnFrom+d]===pawn) return true;
      // Knights and kings
      const knight=by==='w'?'N':'n', king=by==='w'?'K':'k';
      for(const d of OFFSETS.n) if(on(target+d)&&b[target+d]===knight) return true;
      for(const d of OFFSETS.k) if(on(target+d)&&b[target+d]===king) return true;
      // Sliding attacks, from target outward
      for(const d of OFFSETS.q){let t=target+d,dist=1;while(on(t)){const p=b[t];if(p){if(colorOf(p)===by){const ty=typeOf(p);if(ty==='q'||(ty==='r'&&(d===-16||d===-1||d===1||d===16))||(ty==='b'&&[-17,-15,15,17].includes(d))||(ty==='k'&&dist===1))return true;}break;}t+=d;dist++;}}
      return false;
    }
    inCheck(color=this.s.t){const k=this.s.b.indexOf(color==='w'?'K':'k');return this.attacked(k,color==='w'?'b':'w');}
    pseudo(state=this.s){
      const out=[], b=state.b, us=state.t, them=us==='w'?'b':'w';
      const add=(from,to,promo='',flags='')=>{if(!on(to))return;const target=b[to];if(target&&colorOf(target)===us)return;if(typeOf(target)==='k')return;out.push({from,to,promotion:promo,flags});};
      for(let from=0;from<128;from++){if(!on(from))continue;const p=b[from];if(!p||colorOf(p)!==us)continue;const ty=typeOf(p);
        if(ty==='p'){
          const dir=us==='w'?-16:16, start=us==='w'?6:1, promoRank=us==='w'?0:7, one=from+dir;
          const addPawn=(to,flags='')=>{if((to>>4)===promoRank){for(const pr of ['q','r','b','n'])add(from,to,pr,flags);}else add(from,to,'',flags);};
          if(on(one)&&!b[one]){addPawn(one);const two=from+dir*2;if((from>>4)===start&&!b[two])add(from,two,'','double');}
          for(const df of [-1,1]){const to=one+df;if(!on(to))continue;if(b[to]&&colorOf(b[to])===them)addPawn(to,'capture');else if(to===state.ep)add(from,to,'','ep');}
        }else{
          const ds=OFFSETS[ty];for(const d of ds){let to=from+d;while(on(to)){if(!b[to])add(from,to);else{if(colorOf(b[to])===them)add(from,to,'','capture');break;}if(ty==='n'||ty==='k')break;to+=d;}}
          if(ty==='k'){
            const home=us==='w'?116:4, rank=us==='w'?7:0, kingChar=us==='w'?'K':'k', rookChar=us==='w'?'R':'r';
            if(from===home&&!this.inCheck(us)){
              const ks=us==='w'?'K':'k', qs=us==='w'?'Q':'q';
              if(state.c.includes(ks)&&b[home+3]===rookChar&&!b[home+1]&&!b[home+2]&&!this.attacked(home+1,them,state)&&!this.attacked(home+2,them,state))out.push({from,to:home+2,promotion:'',flags:'castleK'});
              if(state.c.includes(qs)&&b[home-4]===rookChar&&!b[home-1]&&!b[home-2]&&!b[home-3]&&!this.attacked(home-1,them,state)&&!this.attacked(home-2,them,state))out.push({from,to:home-2,promotion:'',flags:'castleQ'});
            }
          }
        }
      }
      return out;
    }
    applyTo(state,m){
      const s=clone(state), b=s.b, piece=b[m.from], captured=b[m.to], us=state.t;
      b[m.from]=null;b[m.to]=m.promotion?(us==='w'?m.promotion.toUpperCase():m.promotion):piece;
      if(m.flags==='ep')b[m.to+(us==='w'?16:-16)]=null;
      if(m.flags==='castleK'||m.flags==='castleQ'){const rf=m.flags==='castleK'?m.from+3:m.from-4,rt=m.flags==='castleK'?m.from+1:m.from-1;b[rt]=b[rf];b[rf]=null;}
      let c=s.c;
      if(piece==='K')c=c.replace(/[KQ]/g,'');if(piece==='k')c=c.replace(/[kq]/g,'');
      const rookRights={119:'K',112:'Q',7:'k',0:'q'};
      if(typeOf(piece)==='r'&&rookRights[m.from])c=c.replace(rookRights[m.from],'');
      if(typeOf(captured)==='r'&&rookRights[m.to])c=c.replace(rookRights[m.to],'');
      s.c=c;s.ep=(typeOf(piece)==='p'&&Math.abs(m.to-m.from)===32)?(m.to+m.from)/2:-1;
      s.half=(typeOf(piece)==='p'||captured||m.flags==='ep')?0:s.half+1;
      if(us==='b')s.full++;s.t=us==='w'?'b':'w';return s;
    }
    legalMoves(state=this.s){return this.pseudo(state).filter(m=>{const next=this.applyTo(state,m),k=next.b.indexOf(state.t==='w'?'K':'k');return !this.attacked(k,state.t==='w'?'b':'w',next);});}
    moves(opts={}){const ms=this.legalMoves();if(opts.square){const sqi=idx(opts.square);return ms.filter(m=>m.from===sqi).map(m=>opts.verbose?this.verbose(m):this.uci(m));}return ms.map(m=>opts.verbose?this.verbose(m):this.uci(m));}
    uci(m){return name(m.from)+name(m.to)+(m.promotion||'');}
    verbose(m){const p=this.s.b[m.from], cap=m.flags==='ep'?(this.s.t==='w'?'p':'P'):this.s.b[m.to];return {from:name(m.from),to:name(m.to),promotion:m.promotion||undefined,flags:m.flags,color:this.s.t,piece:typeOf(p),captured:typeOf(cap),san:this.uci(m)};}
    move(input){let chosen=null;const legal=this.legalMoves();if(typeof input==='string'){chosen=legal.find(m=>this.uci(m)===input);}else if(input&&input.from&&input.to){chosen=legal.find(m=>name(m.from)===input.from&&name(m.to)===input.to&&(!m.promotion||m.promotion===(input.promotion||'q')));}
      if(!chosen)return null;const before=clone(this.s), verbose=this.verbose(chosen);this.history.push({before,move:verbose});this.s=this.applyTo(this.s,chosen);this.positions.push(this.positionKey());return verbose;
    }
    undo(){const h=this.history.pop();if(!h)return null;this.s=h.before;this.positions.pop();return h.move;}
    historyMoves(){return this.history.map(h=>h.move);}
    inCheckmate(){return this.inCheck()&&this.legalMoves().length===0;}
    inStalemate(){return !this.inCheck()&&this.legalMoves().length===0;}
    insufficient(){const pieces=[];for(let i=0;i<128;i++)if(on(i)&&this.s.b[i]&&typeOf(this.s.b[i])!=='k')pieces.push({t:typeOf(this.s.b[i]),sq:(i&7)+(i>>4)});if(!pieces.length)return true;if(pieces.length===1&&['b','n'].includes(pieces[0].t))return true;if(pieces.every(p=>p.t==='b')&&new Set(pieces.map(p=>p.sq%2)).size===1)return true;return false;}
    inThreefold(){const k=this.positionKey();return this.positions.filter(x=>x===k).length>=3;}
    inDraw(){const repetitions=this.positions.filter(x=>x===this.positionKey()).length;return this.inStalemate()||this.insufficient()||this.s.half>=150||repetitions>=5;}
    game_over(){return this.inCheckmate()||this.inDraw();}
    result(){if(this.inCheckmate())return this.s.t==='w'?'b':'w';if(this.inDraw())return 'draw';return null;}
    pgn(){return this.history.map((h,i)=>`${i%2===0?Math.floor(i/2)+1+'. ':''}${h.move.san}`).join(' ');}
  }
  window.ChessCore=ChessCore;
})();
