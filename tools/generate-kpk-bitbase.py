#!/usr/bin/env python3
"""Generate a compact KPK WDL bitbase by retrograde analysis.

Coordinates: a1=0, white pawns advance toward rank 8. Pawn files a-d are
canonical; positions with a pawn on e-h are mirrored by the runtime probe.
The database ignores the 50-move counter and repetition history (standard
unbounded theoretical WDL). Output is exactly 24,576 bytes.
"""
from array import array
from collections import deque
from pathlib import Path
import hashlib, json, time

N = 2 * 24 * 64 * 64
WIN, DRAW = 1, 2

def file_of(s): return s & 7
def rank_of(s): return s >> 3
def adjacent(a,b): return max(abs(file_of(a)-file_of(b)), abs(rank_of(a)-rank_of(b))) <= 1

def pawn_attacks(p,bk):
    pf,pr=file_of(p),rank_of(p)
    return pr < 7 and abs(file_of(bk)-pf)==1 and rank_of(bk)==pr+1

def major_attacks(piece_sq, target, wk, kind):
    pf,pr=file_of(piece_sq),rank_of(piece_sq)
    tf,tr=file_of(target),rank_of(target)
    df,dr=tf-pf,tr-pr
    if kind == 'R':
        aligned=(df==0 or dr==0)
    else:
        aligned=(df==0 or dr==0 or abs(df)==abs(dr))
    if not aligned or (df==0 and dr==0): return False
    sf=0 if df==0 else (1 if df>0 else -1)
    sr=0 if dr==0 else (1 if dr>0 else -1)
    f,r=pf+sf,pr+sr
    while (f,r)!=(tf,tr):
        s=r*8+f
        if s==wk: return False
        f+=sf; r+=sr
    return True

def promotion_result(wk,bk,psq,kind):
    """Return WDL from pawn side's perspective after choosing Q or R."""
    # A king capture of the promoted piece is legal if the white king does not
    # protect its square. Black may choose that capture and force a draw.
    if adjacent(bk, psq) and not adjacent(wk, psq):
        return DRAW
    in_check=major_attacks(psq,bk,wk,kind)
    legal_non_capture=False
    bf,br=file_of(bk),rank_of(bk)
    for df in (-1,0,1):
        for dr in (-1,0,1):
            if not (df or dr): continue
            f,r=bf+df,br+dr
            if not (0<=f<8 and 0<=r<8): continue
            sq=r*8+f
            if sq==psq or adjacent(sq,wk): continue
            if major_attacks(psq,sq,wk,kind): continue
            legal_non_capture=True
    if legal_non_capture: return WIN
    return WIN if in_check else DRAW

def idx(stm,p,wk,bk):
    pf=file_of(p); pr=rank_of(p)
    return (((stm*24 + ((pr-1)*4+pf))*64 + wk)*64 + bk)

def valid_state(stm,p,wk,bk):
    if wk==bk or wk==p or bk==p or adjacent(wk,bk): return False
    pr=rank_of(p)
    if pr<1 or pr>6 or file_of(p)>3: return False
    # Side not to move may not have left its own king in check.
    if stm==0 and pawn_attacks(p,bk): return False
    return True

def successors(stm,p,wk,bk):
    out=[]
    if stm==0:
        wf,wr=file_of(wk),rank_of(wk)
        for df in (-1,0,1):
            for dr in (-1,0,1):
                if not (df or dr): continue
                f,r=wf+df,wr+dr
                if not (0<=f<8 and 0<=r<8): continue
                sq=r*8+f
                if sq==p or adjacent(sq,bk): continue
                out.append(('state',idx(1,p,sq,bk)))
        one=p+8
        if one<64 and one!=wk and one!=bk:
            if rank_of(p)==6:
                q=promotion_result(wk,bk,one,'Q')
                r=promotion_result(wk,bk,one,'R')
                out.append(('external',WIN if q==WIN or r==WIN else DRAW))
            else:
                out.append(('state',idx(1,one,wk,bk)))
                if rank_of(p)==1:
                    two=p+16
                    if two!=wk and two!=bk:
                        out.append(('state',idx(1,two,wk,bk)))
    else:
        bf,br=file_of(bk),rank_of(bk)
        for df in (-1,0,1):
            for dr in (-1,0,1):
                if not (df or dr): continue
                f,r=bf+df,br+dr
                if not (0<=f<8 and 0<=r<8): continue
                sq=r*8+f
                if adjacent(sq,wk): continue
                if sq==p:
                    # Capture the pawn; K vs K is drawn if not protected.
                    if not adjacent(sq,wk): out.append(('external',DRAW))
                    continue
                if pawn_attacks(p,sq): continue
                out.append(('state',idx(0,p,wk,sq)))
    return out

def main():
    t=time.time()
    valid=bytearray(N)
    stm_of=bytearray(N)
    p_of=array('b',[-1])*N
    wk_of=array('b',[-1])*N
    bk_of=array('b',[-1])*N
    outdeg=array('H',[0])*N
    # Validate/index all canonical states.
    for stm in (0,1):
        for pr in range(1,7):
            for pf in range(4):
                p=pr*8+pf
                for wk in range(64):
                    for bk in range(64):
                        i=idx(stm,p,wk,bk)
                        if valid_state(stm,p,wk,bk):
                            valid[i]=1; stm_of[i]=stm; p_of[i]=p; wk_of[i]=wk; bk_of[i]=bk
    head=array('i',[-1])*N
    parent=array('i')
    link=array('i')
    remaining=array('H',[0])*N
    status=bytearray(N)
    # Build reverse edges, while applying promotion/capture terminal results.
    for i in range(N):
        if not valid[i]: continue
        moves=successors(stm_of[i],p_of[i],wk_of[i],bk_of[i])
        outdeg[i]=len(moves); remaining[i]=len(moves)
        for kind,value in moves:
            if kind=='external':
                if stm_of[i]==0:
                    if value==WIN: status[i]=WIN
                    else: remaining[i]-=1
                else:
                    if value==DRAW: status[i]=DRAW
                    else: remaining[i]-=1
            else:
                e=len(parent); parent.append(i); link.append(head[value]); head[value]=e
        if not moves and status[i]==0:
            # No legal moves: black to move and pawn check is mate; otherwise draw.
            if stm_of[i]==1 and pawn_attacks(p_of[i],bk_of[i]): status[i]=WIN
            else: status[i]=DRAW
    queue=deque(i for i in range(N) if valid[i] and status[i])
    while queue:
        child=queue.popleft(); result=status[child]
        e=head[child]
        while e!=-1:
            par=parent[e]; e=link[e]
            if status[par]: continue
            if stm_of[par]==0:
                if result==WIN:
                    status[par]=WIN; queue.append(par)
                else:
                    if remaining[par]>0: remaining[par]-=1
                    if remaining[par]==0: status[par]=DRAW; queue.append(par)
            else:
                if result==DRAW:
                    status[par]=DRAW; queue.append(par)
                else:
                    if remaining[par]>0: remaining[par]-=1
                    if remaining[par]==0: status[par]=WIN; queue.append(par)
    # Any unresolved SCC/cycle is a draw under optimal play.
    table=bytearray(N//8)
    wins=0; valid_count=0; unresolved=0
    for i in range(N):
        if not valid[i]: continue
        valid_count+=1
        if status[i]==0: unresolved+=1
        if status[i]==WIN:
            table[i>>3]|=1<<(i&7); wins+=1
    out=Path(__file__).resolve().parents[1]/'models'/'kpk-wdl.bin'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_bytes(table)
    digest=hashlib.sha256(table).hexdigest()
    report={'format':'Chelo KPK WDL bitbase v1','bytes':len(table),'positions':N,'validPositions':valid_count,'wonPositions':wins,'drawnPositions':valid_count-wins,'unresolvedCyclesResolvedAsDraw':unresolved,'sha256':digest,'method':'retrograde attractor / minimax WDL; 1-bit per indexed state; horizontal mirror canonicalisation; ignores 50-move counter and repetition','seconds':round(time.time()-t,3)}
    (out.parent/'kpk-wdl-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__=='__main__': main()
