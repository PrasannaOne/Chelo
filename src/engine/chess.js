/*
 * Chelo ChessCore
 * Dependency-free legal chess rules for offline play and AI search.
 * 0x88 board representation; SAN for user-facing history; UCI for storage/search.
 */
(() => {
  'use strict';
  const FILES = 'abcdefgh';
  const OFFSETS = {
    n: [-33,-31,-18,-14,14,18,31,33],
    b: [-17,-15,15,17],
    r: [-16,-1,1,16],
    q: [-17,-16,-15,-1,1,15,16,17],
    k: [-17,-16,-15,-1,1,15,16,17]
  };
  const on = i => i >= 0 && i < 128 && !(i & 0x88);
  const idx = s => {
    if (typeof s !== 'string' || !/^[a-h][1-8]$/.test(s)) return -1;
    return (8 - Number(s[1])) * 16 + FILES.indexOf(s[0]);
  };
  const name = i => FILES[i & 7] + (8 - (i >> 4));
  const colorOf = p => !p ? null : p === p.toUpperCase() ? 'w' : 'b';
  const typeOf = p => p ? p.toLowerCase() : null;
  const clone = s => ({ b:s.b.slice(), t:s.t, c:s.c, ep:s.ep, half:s.half, full:s.full });
  const PROMOTION = { q:'Q', r:'R', b:'B', n:'N' };

  class ChessCore {
    constructor(fen) {
      this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    }

    load(fen) {
      if (typeof fen !== 'string') throw new TypeError('FEN must be a string.');
      const f = fen.trim().split(/\s+/);
      if (f.length < 4 || f.length > 6 || !/^[wb]$/.test(f[1])) throw new Error('Invalid FEN fields.');
      const rows = f[0].split('/');
      if (rows.length !== 8) throw new Error('FEN must contain eight ranks.');
      const b = Array(128).fill(null);
      rows.forEach((row, r) => {
        let c = 0;
        for (const ch of row) {
          if (/^[1-8]$/.test(ch)) c += Number(ch);
          else {
            if (!/^[prnbqkPRNBQK]$/.test(ch) || c >= 8) throw new Error('Invalid FEN piece placement.');
            b[r * 16 + c++] = ch;
          }
        }
        if (c !== 8) throw new Error('Each FEN rank must contain eight squares.');
      });
      if (b.filter(x => x === 'K').length !== 1 || b.filter(x => x === 'k').length !== 1) {
        throw new Error('FEN must contain exactly one king of each color.');
      }
      const castling = f[2];
      if (!(castling === '-' || (/^(?=.{1,4}$)(?!.*(.).*\1)[KQkq]+$/.test(castling)))) throw new Error('Invalid FEN castling rights.');
      const ep = f[3];
      if (!(ep === '-' || /^[a-h][36]$/.test(ep))) throw new Error('Invalid FEN en-passant square.');
      if (ep !== '-' && ((f[1] === 'w' && ep[1] !== '6') || (f[1] === 'b' && ep[1] !== '3'))) throw new Error('En-passant square does not match the side to move.');
      const half = f[4] === undefined ? 0 : Number(f[4]);
      const full = f[5] === undefined ? 1 : Number(f[5]);
      if (!Number.isInteger(half) || half < 0 || !Number.isInteger(full) || full < 1) throw new Error('Invalid FEN move counters.');
      this.s = { b, t:f[1], c:castling === '-' ? '' : castling, ep:ep === '-' ? -1 : idx(ep), half, full };
      this.history = [];
      this.positions = [this.positionKey()];
      return true;
    }

    turn() { return this.s.t; }

    fen() {
      const rows = [];
      for (let r = 0; r < 8; r++) {
        let row = '', empty = 0;
        for (let c = 0; c < 8; c++) {
          const p = this.s.b[r * 16 + c];
          if (!p) empty++;
          else { if (empty) row += empty; empty = 0; row += p; }
        }
        if (empty) row += empty;
        rows.push(row);
      }
      return `${rows.join('/')} ${this.s.t} ${this.s.c || '-'} ${this.s.ep < 0 ? '-' : name(this.s.ep)} ${this.s.half} ${this.s.full}`;
    }

    positionKey(state = this.s) {
      // FIDE repetition identity includes en-passant only when a legal EP capture exists.
      let ep = '-';
      if (state.ep >= 0) {
        const candidates = this.pseudo(state).filter(m => m.flags === 'ep');
        if (candidates.some(m => {
          const next = this.applyTo(state, m);
          const king = next.b.indexOf(state.t === 'w' ? 'K' : 'k');
          return !this.attacked(king, state.t === 'w' ? 'b' : 'w', next);
        })) ep = name(state.ep);
      }
      return state.b.map((p, i) => on(i) ? (p || '.') : '').join('') + ` ${state.t} ${state.c || '-'} ${ep}`;
    }

    board() {
      const out = [];
      for (let r = 0; r < 8; r++) {
        const row = [];
        for (let c = 0; c < 8; c++) {
          const p = this.s.b[r * 16 + c];
          row.push(p ? { type:typeOf(p), color:colorOf(p) } : null);
        }
        out.push(row);
      }
      return out;
    }

    get(square) {
      const i = idx(square);
      if (i < 0) return null;
      const p = this.s.b[i];
      return p ? { type:typeOf(p), color:colorOf(p) } : null;
    }

    attacked(target, by, state = this.s) {
      if (!on(target)) return false;
      const b = state.b;
      const pawn = by === 'w' ? 'P' : 'p';
      const pawnFrom = target + (by === 'w' ? 16 : -16);
      for (const d of [-1, 1]) if (on(pawnFrom + d) && b[pawnFrom + d] === pawn) return true;
      const knight = by === 'w' ? 'N' : 'n';
      const king = by === 'w' ? 'K' : 'k';
      for (const d of OFFSETS.n) if (on(target + d) && b[target + d] === knight) return true;
      for (const d of OFFSETS.k) if (on(target + d) && b[target + d] === king) return true;
      for (const d of OFFSETS.q) {
        let t = target + d, distance = 1;
        while (on(t)) {
          const p = b[t];
          if (p) {
            if (colorOf(p) === by) {
              const type = typeOf(p);
              if (type === 'q' ||
                  (type === 'r' && [-16,-1,1,16].includes(d)) ||
                  (type === 'b' && [-17,-15,15,17].includes(d)) ||
                  (type === 'k' && distance === 1)) return true;
            }
            break;
          }
          t += d;
          distance++;
        }
      }
      return false;
    }

    inCheck(color = this.s.t, state = this.s) {
      const king = state.b.indexOf(color === 'w' ? 'K' : 'k');
      if (king < 0) return true;
      return this.attacked(king, color === 'w' ? 'b' : 'w', state);
    }

    pseudo(state = this.s) {
      const out = [], b = state.b, us = state.t, them = us === 'w' ? 'b' : 'w';
      const add = (from, to, promotion = '', flags = '') => {
        if (!on(to)) return;
        const target = b[to];
        if (target && colorOf(target) === us) return;
        if (typeOf(target) === 'k') return;
        out.push({ from, to, promotion, flags });
      };
      for (let from = 0; from < 128; from++) {
        if (!on(from)) continue;
        const p = b[from];
        if (!p || colorOf(p) !== us) continue;
        const type = typeOf(p);
        if (type === 'p') {
          const dir = us === 'w' ? -16 : 16;
          const startRank = us === 'w' ? 6 : 1;
          const promotionRank = us === 'w' ? 0 : 7;
          const one = from + dir;
          const addPawn = (to, flags = '') => {
            if ((to >> 4) === promotionRank) for (const pr of ['q','r','b','n']) add(from, to, pr, flags);
            else add(from, to, '', flags);
          };
          if (on(one) && !b[one]) {
            addPawn(one);
            const two = from + dir * 2;
            if ((from >> 4) === startRank && on(two) && !b[two]) add(from, two, '', 'double');
          }
          for (const df of [-1, 1]) {
            const to = one + df;
            if (!on(to)) continue;
            if (b[to] && colorOf(b[to]) === them) addPawn(to, 'capture');
            else if (to === state.ep && !b[to]) add(from, to, '', 'ep');
          }
        } else {
          for (const d of OFFSETS[type]) {
            let to = from + d;
            while (on(to)) {
              if (!b[to]) add(from, to);
              else { if (colorOf(b[to]) === them) add(from, to, '', 'capture'); break; }
              if (type === 'n' || type === 'k') break;
              to += d;
            }
          }
          if (type === 'k') {
            const home = us === 'w' ? 116 : 4;
            const rook = us === 'w' ? 'R' : 'r';
            const kingSide = us === 'w' ? 'K' : 'k';
            const queenSide = us === 'w' ? 'Q' : 'q';
            if (from === home && !this.inCheck(us, state)) {
              if (state.c.includes(kingSide) && b[home + 3] === rook && !b[home + 1] && !b[home + 2] &&
                  !this.attacked(home + 1, them, state) && !this.attacked(home + 2, them, state)) {
                out.push({ from, to:home + 2, promotion:'', flags:'castleK' });
              }
              if (state.c.includes(queenSide) && b[home - 4] === rook && !b[home - 1] && !b[home - 2] && !b[home - 3] &&
                  !this.attacked(home - 1, them, state) && !this.attacked(home - 2, them, state)) {
                out.push({ from, to:home - 2, promotion:'', flags:'castleQ' });
              }
            }
          }
        }
      }
      return out;
    }

    applyTo(state, m) {
      const s = clone(state), b = s.b, piece = b[m.from], captured = b[m.to], us = state.t;
      b[m.from] = null;
      b[m.to] = m.promotion ? (us === 'w' ? m.promotion.toUpperCase() : m.promotion) : piece;
      if (m.flags === 'ep') b[m.to + (us === 'w' ? 16 : -16)] = null;
      if (m.flags === 'castleK' || m.flags === 'castleQ') {
        const rf = m.flags === 'castleK' ? m.from + 3 : m.from - 4;
        const rt = m.flags === 'castleK' ? m.from + 1 : m.from - 1;
        b[rt] = b[rf]; b[rf] = null;
      }
      let rights = s.c;
      if (piece === 'K') rights = rights.replace(/[KQ]/g, '');
      if (piece === 'k') rights = rights.replace(/[kq]/g, '');
      const rookRights = { 119:'K', 112:'Q', 7:'k', 0:'q' };
      if (typeOf(piece) === 'r' && rookRights[m.from]) rights = rights.replace(rookRights[m.from], '');
      if (typeOf(captured) === 'r' && rookRights[m.to]) rights = rights.replace(rookRights[m.to], '');
      s.c = rights;
      s.ep = typeOf(piece) === 'p' && Math.abs(m.to - m.from) === 32 ? (m.to + m.from) / 2 : -1;
      s.half = typeOf(piece) === 'p' || captured || m.flags === 'ep' ? 0 : s.half + 1;
      if (us === 'b') s.full++;
      s.t = us === 'w' ? 'b' : 'w';
      return s;
    }

    legalMoves(state = this.s) {
      return this.pseudo(state).filter(m => {
        const next = this.applyTo(state, m);
        const king = next.b.indexOf(state.t === 'w' ? 'K' : 'k');
        return !this.attacked(king, state.t === 'w' ? 'b' : 'w', next);
      });
    }

    moves(options = {}) {
      const list = this.legalMoves();
      if (options.square) {
        const squareIndex = idx(options.square);
        return list.filter(m => m.from === squareIndex).map(m => options.verbose ? this.verbose(m, !!options.skipSan) : this.uci(m));
      }
      return list.map(m => options.verbose ? this.verbose(m, !!options.skipSan) : this.uci(m));
    }

    uci(m) { return name(m.from) + name(m.to) + (m.promotion || ''); }

    sanFor(m) {
      const piece = this.s.b[m.from], type = typeOf(piece), capture = !!this.s.b[m.to] || m.flags === 'ep';
      if (m.flags === 'castleK') return this.sanSuffix(m, 'O-O');
      if (m.flags === 'castleQ') return this.sanSuffix(m, 'O-O-O');
      let san = '';
      if (type !== 'p') {
        san += type.toUpperCase();
        const alternatives = this.legalMoves().filter(other => other.from !== m.from && other.to === m.to &&
          typeOf(this.s.b[other.from]) === type && colorOf(this.s.b[other.from]) === this.s.t);
        if (alternatives.length) {
          const sameFile = alternatives.some(other => (other.from & 7) === (m.from & 7));
          const sameRank = alternatives.some(other => (other.from >> 4) === (m.from >> 4));
          if (!sameFile) san += FILES[m.from & 7];
          else if (!sameRank) san += String(8 - (m.from >> 4));
          else san += name(m.from);
        }
      } else if (capture) san += FILES[m.from & 7];
      if (capture) san += 'x';
      san += name(m.to);
      if (m.promotion) san += '=' + PROMOTION[m.promotion];
      return this.sanSuffix(m, san);
    }

    sanSuffix(m, san) {
      const next = this.applyTo(this.s, m);
      if (this.inCheck(next.t, next)) return san + (this.legalMoves(next).length ? '+' : '#');
      return san;
    }

    verbose(m, skipSan = false) {
      const p = this.s.b[m.from];
      const captured = m.flags === 'ep' ? (this.s.t === 'w' ? 'p' : 'P') : this.s.b[m.to];
      return {
        from:name(m.from), to:name(m.to), promotion:m.promotion || undefined,
        flags:m.flags, color:this.s.t, piece:typeOf(p), captured:typeOf(captured),
        san:skipSan ? this.uci(m) : this.sanFor(m), uci:this.uci(m)
      };
    }

    move(input, options = {}) {
      let chosen = null;
      const legal = this.legalMoves();
      if (typeof input === 'string') chosen = legal.find(m => this.uci(m) === input);
      else if (input && input.from && input.to) {
        chosen = legal.find(m => name(m.from) === input.from && name(m.to) === input.to &&
          (!m.promotion || m.promotion === (input.promotion || 'q')));
      }
      if (!chosen) return null;
      const before = clone(this.s);
      const verbose = this.verbose(chosen, !!options.skipSan);
      this.history.push({ before, move:verbose });
      this.s = this.applyTo(this.s, chosen);
      this.positions.push(this.positionKey());
      return verbose;
    }

    undo() {
      const item = this.history.pop();
      if (!item) return null;
      this.s = item.before;
      this.positions.pop();
      return item.move;
    }

    historyMoves() { return this.history.map(item => item.move); }
    inCheckmate() { return this.inCheck() && this.legalMoves().length === 0; }
    inStalemate() { return !this.inCheck() && this.legalMoves().length === 0; }

    insufficient() {
      const pieces = [];
      for (let i = 0; i < 128; i++) {
        if (!on(i) || !this.s.b[i] || typeOf(this.s.b[i]) === 'k') continue;
        pieces.push({ type:typeOf(this.s.b[i]), color:(i & 7) + (i >> 4) });
      }
      if (pieces.length === 0) return true;
      if (pieces.length === 1 && ['b','n'].includes(pieces[0].type)) return true;
      return pieces.every(p => p.type === 'b') && new Set(pieces.map(p => p.color % 2)).size === 1;
    }

    inThreefold() { const key = this.positionKey(); return this.positions.filter(x => x === key).length >= 3; }
    canClaimDraw() { return this.s.half >= 100 || this.inThreefold(); }
    inDraw() {
      const repetitions = this.positions.filter(x => x === this.positionKey()).length;
      return this.inStalemate() || this.insufficient() || this.s.half >= 150 || repetitions >= 5;
    }
    game_over() { return this.inCheckmate() || this.inDraw(); }
    result() { if (this.inCheckmate()) return this.s.t === 'w' ? 'b' : 'w'; if (this.inDraw()) return 'draw'; return null; }
    pgn() {
      return this.history.map((item, i) => `${i % 2 === 0 ? Math.floor(i / 2) + 1 + '. ' : ''}${item.move.san}`).join(' ');
    }
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.ChessCore = ChessCore;
})();
