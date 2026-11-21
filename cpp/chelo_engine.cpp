#include "chelo_engine.hpp"
namespace chelo {
extern "C" u64 chelo_host_now_ms();
static const i32 val[7]={0,100,320,330,500,900,20000};
static const char pchars[]=" PNBRQKpnbrqk";
static bool inside(i32 s){return s>=0&&s<64;}
static i32 fileOf(i32 s){return s&7;} static i32 rankOf(i32 s){return s>>3;}
static i32 sideOf(i32 p){return p>=7?1:0;} static i32 typeOf(i32 p){return p>6?p-6:p;}
static i32 absI(i32 x){return x<0?-x:x;} static i32 clampI(i32 x,i32 a,i32 b){return x<a?a:x>b?b:x;}
static u64 zobPiece[12][64],zobCastle[16],zobEp[8],zobSide;
static u64 pawnAttackers[2][64],knightAttackers[64],kingAttackers[64];
static u64 sliderRays[64][8];
static bool zobReady=false;
static u64 splitmix64(u64& x){u64 z=(x+=0x9e3779b97f4a7c15ull);z=(z^(z>>30))*0xbf58476d1ce4e5b9ull;z=(z^(z>>27))*0x94d049bb133111ebull;return z^(z>>31);}
static void initZobrist(){
 if(zobReady)return;
 u64 seed=0x4348454c4f563135ull;
 for(i32 p=0;p<12;p++)for(i32 s=0;s<64;s++)zobPiece[p][s]=splitmix64(seed);
 for(i32 i=0;i<16;i++)zobCastle[i]=splitmix64(seed);
 for(i32 i=0;i<8;i++)zobEp[i]=splitmix64(seed);
 zobSide=splitmix64(seed);
 static const i8 knr[8]={-2,-2,-1,-1,1,1,2,2},knf[8]={-1,1,-2,2,-2,2,-1,1};
 static const i8 drs[8]={-1,-1,-1,0,0,1,1,1},dfs[8]={-1,0,1,-1,1,-1,0,1};
 for(i32 sq=0;sq<64;sq++){
  i32 r=rankOf(sq),f=fileOf(sq);
  for(i32 side=0;side<2;side++){
   i32 sr=r+(side==0?1:-1);
   for(i32 df=-1;df<=1;df+=2){i32 sf=f+df;if(sr>=0&&sr<8&&sf>=0&&sf<8)pawnAttackers[side][sq]|=1ull<<(sr*8+sf);}
  }
  for(i32 k=0;k<8;k++){
   i32 rr=r+knr[k],ff=f+knf[k];
   if(rr>=0&&rr<8&&ff>=0&&ff<8)knightAttackers[sq]|=1ull<<(rr*8+ff);
  }
  for(i32 dr=-1;dr<=1;dr++)for(i32 df=-1;df<=1;df++)if(dr||df){i32 rr=r+dr,ff=f+df;if(rr>=0&&rr<8&&ff>=0&&ff<8)kingAttackers[sq]|=1ull<<(rr*8+ff);}
  for(i32 d=0;d<8;d++){
   i32 rr=r+drs[d],ff=f+dfs[d];
   while(rr>=0&&rr<8&&ff>=0&&ff<8){sliderRays[sq][d]|=1ull<<(rr*8+ff);rr+=drs[d];ff+=dfs[d];}
  }
 }
 zobReady=true;
}
static u64 rayAttacks(i32 sq,u64 occupied,i32 d){
 u64 ray=sliderRays[sq][d],blockers=ray&occupied;
 if(!blockers)return ray;
 i32 nearest=d<4?63-__builtin_clzll(blockers):__builtin_ctzll(blockers);
 return ray&~sliderRays[nearest][d];
}
static u64 bishopAttacks(i32 sq,u64 occupied){return rayAttacks(sq,occupied,0)|rayAttacks(sq,occupied,2)|rayAttacks(sq,occupied,5)|rayAttacks(sq,occupied,7);}
static u64 rookAttacks(i32 sq,u64 occupied){return rayAttacks(sq,occupied,1)|rayAttacks(sq,occupied,3)|rayAttacks(sq,occupied,4)|rayAttacks(sq,occupied,6);}

static bool eqMove(Move a,Move b){return a.from==b.from&&a.to==b.to&&a.promo==b.promo;}
Engine::Engine():age(1),nodes(0),qnodes(0),ttProbes(0),ttHits(0),ttCuts(0),betaCuts(0),firstMoveCuts(0),lmrReductions(0),lmrResearches(0),seeCalls(0),nodeLimit(0),stopMs(0),rootDepth(0),startTick(0),aborted(false),rootIterationBest{255,255,0,0},gameHistoryCount(0),accReady(false),modelReady(false),kpkReady(false){initZobrist();for(i32 i=0;i<1024;i++){repetitionKeys[i]=0;repetitionCounts[i]=0;repetitionUsed[i]=0;}for(i32 i=0;i<TT_SIZE;i++){tt[i].key=0;tt[i].depth=-1;}for(i32 i=0;i<2;i++){adapterRank[i]=i?2:1;adapterShift[i]=8;for(i32 j=0;j<64;j++){adapterAW[i][j]=0;adapterAB[i][j]=0;}for(i32 j=0;j<2;j++)adapterB[i][j]=0;}for(i32 p=0;p<MAX_PLY;p++){prevClass[p]=0;prevTo[p]=0;prev2Class[p]=0;prev2To[p]=0;pathHash[p]=0;pathValid[p]=0;killers[p][0]={255,255,0,0};killers[p][1]={255,255,0,0};}for(i32 p=0;p<16;p++)for(i32 q=0;q<64;q++)counterMove[p][q]={255,255,0,0};for(i32 side=0;side<2;side++)for(i32 f=0;f<64;f++)for(i32 t=0;t<64;t++)history[side][f][t]=0;for(i32 a=0;a<16;a++)for(i32 b=0;b<64;b++)for(i32 c=0;c<16;c++)for(i32 d=0;d<64;d++){contHistory[a][b][c][d]=0;contHistory2[a][b][c][d]=0;}setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");}
i32 Engine::poplsb(u64& b){i32 s=__builtin_ctzll(b);b&=b-1;return s;}
i32 Engine::pieceColor(i32 p){return p?sideOf(p):-1;} i32 Engine::pieceType(i32 p){return typeOf(p);}
void Engine::rebuild(){for(i32 i=0;i<12;i++)pos.bb[i]=0;pos.occ[0]=pos.occ[1]=pos.all=0;pos.kingSq[0]=pos.kingSq[1]=-1;for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(p){u64 b=bit(s);pos.bb[p-1]|=b;pos.occ[sideOf(p)]|=b;pos.all|=b;if(typeOf(p)==6)pos.kingSq[sideOf(p)]=(i8)s;}}}
void Engine::setSquare(i32 sq,i32 piece){i32 old=pos.board[sq];u64 b=bit(sq);if(old){pos.bb[old-1]&=~b;pos.occ[sideOf(old)]&=~b;pos.all&=~b;if(typeOf(old)==6)pos.kingSq[sideOf(old)]=-1;}pos.board[sq]=(u8)piece;if(piece){pos.bb[piece-1]|=b;pos.occ[sideOf(piece)]|=b;pos.all|=b;if(typeOf(piece)==6)pos.kingSq[sideOf(piece)]=(i8)sq;}}
bool Engine::setFen(const char* f){if(!f)return false;for(i32 i=0;i<64;i++)pos.board[i]=0; i32 s=0;while(*f&&*f!=' '&&s<64){char c=*f++;if(c=='/')continue;if(c>='1'&&c<='8'){s+=c-'0';continue;}i32 p=0;for(i32 j=1;j<=12;j++)if(pchars[j]==c)p=j;if(!p||s>=64)return false;pos.board[s++]=(u8)p;}if(s!=64||*f!=' ')return false;f++;pos.side=*f=='b'?1:0;while(*f&&*f!=' ')f++;if(*f)f++;pos.rights=0;if(*f=='-')f++;else{while(*f&&*f!=' '){if(*f=='K')pos.rights|=1;if(*f=='Q')pos.rights|=2;if(*f=='k')pos.rights|=4;if(*f=='q')pos.rights|=8;f++;}}while(*f==' ')f++;pos.ep=-1;if(*f=='-')f++;else if(*f){i32 file=f[0]-'a',rank=f[1]-'1';if(file>=0&&file<8&&rank>=0&&rank<8)pos.ep=(i8)((7-rank)*8+file);while(*f&&*f!=' ')f++;}while(*f==' ')f++;pos.half=0;while(*f>='0'&&*f<='9'){pos.half=(u16)(pos.half*10+*f-'0');f++;}while(*f==' ')f++;pos.full=1;if(*f){pos.full=0;while(*f>='0'&&*f<='9'){pos.full=(u16)(pos.full*10+*f-'0');f++;}if(!pos.full)pos.full=1;}rebuild();pos.hash=computeHash();accReady=false;gameHistoryCount=1;gameHistory[0]=pos.hash;rebuildRepetitionTable();return true;}
bool Engine::attackedReference(i32 sq,i32 by)const{if(!inside(sq))return false;i32 r=rankOf(sq),f=fileOf(sq);i32 pr=by?r-1:r+1;for(i32 df=-1;df<=1;df+=2){i32 ff=f+df;if(pr>=0&&pr<8&&ff>=0&&ff<8){i32 p=pos.board[pr*8+ff];if(p==(by?7:1))return true;}}static const i8 knr[8]={-2,-2,-1,-1,1,1,2,2},knf[8]={-1,1,-2,2,-2,2,-1,1};for(i32 k=0;k<8;k++){i32 rr=r+knr[k],ff=f+knf[k];if(rr>=0&&rr<8&&ff>=0&&ff<8&&pos.board[rr*8+ff]==(by?8:2))return true;}for(i32 dr=-1;dr<=1;dr++)for(i32 df=-1;df<=1;df++){if(!dr&&!df)continue;i32 rr=r+dr,ff=f+df;if(rr>=0&&rr<8&&ff>=0&&ff<8&&pos.board[rr*8+ff]==(by?12:6))return true;}for(i32 k=0;k<8;k++){i32 dr=(k<4)?(k==0?-1:k==1?-1:k==2?1:1):(k==4?-1:k==5?1:k==6?0:0);i32 df=(k<4)?(k==0?-1:k==1?1:k==2?-1:1):(k==4?0:k==5?0:k==6?-1:1);i32 rr=r+dr,ff=f+df;while(rr>=0&&rr<8&&ff>=0&&ff<8){i32 p=pos.board[rr*8+ff];if(p){if(sideOf(p)==by){i32 t=typeOf(p);if((k<4&&(t==3||t==5))||(k>=4&&(t==4||t==5)))return true;}break;}rr+=dr;ff+=df;}}return false;}
bool Engine::attacked(i32 sq,i32 by)const{
 if(!inside(sq))return false;
 const u64 pawns=pos.bb[by*6],knights=pos.bb[by*6+1],bishops=pos.bb[by*6+2];
 const u64 rooks=pos.bb[by*6+3],queens=pos.bb[by*6+4],kings=pos.bb[by*6+5];
 if(pawns&pawnAttackers[by][sq])return true;
 if(knights&knightAttackers[sq])return true;
 if(kings&kingAttackers[sq])return true;
 if((bishops|queens)&bishopAttacks(sq,pos.all))return true;
 if((rooks|queens)&rookAttacks(sq,pos.all))return true;
 return false;
}
bool Engine::inCheck(i32 side)const{i32 s=pos.kingSq[side];return s<0||attacked(s,side^1);}
bool Engine::make(Move m,Undo& u,i32 ply,bool updateHash,bool updateAcc){if(m.from>=64||m.to>=64)return false;i32 p=pos.board[m.from];if(!p)return false;u.captured=pos.board[m.to];u.rights=pos.rights;u.moved=(u8)p;u.ep=pos.ep;u.half=pos.half;u.full=pos.full;u.hash=pos.hash;const i32 oldEpFile=updateHash?effectiveEpFile():-1;const i32 captureSq=(m.flags&1)?m.to+(pos.side?-8:8):m.to;if(m.flags&1)u.captured=pos.board[captureSq];const i32 placed=m.promo?(pos.side?m.promo+6:m.promo):p;u64 nextHash=pos.hash;if(updateHash){nextHash^=zobCastle[pos.rights];if(oldEpFile>=0)nextHash^=zobEp[oldEpFile];nextHash^=zobPiece[p-1][m.from];if(u.captured)nextHash^=zobPiece[u.captured-1][captureSq];nextHash^=zobPiece[placed-1][m.to];if(m.flags&2){i32 rf=m.to==62?63:m.to==58?56:m.to==6?7:0,rt=m.to==62?61:m.to==58?59:m.to==6?5:3,rp=pos.side?10:4;nextHash^=zobPiece[rp-1][rf];nextHash^=zobPiece[rp-1][rt];}}
 setSquare(m.from,0);if(m.flags&1)setSquare(captureSq,0);setSquare(m.to,placed);
 if(m.flags&2){if(m.to==62){setSquare(63,0);setSquare(61,4);}else if(m.to==58){setSquare(56,0);setSquare(59,4);}else if(m.to==6){setSquare(7,0);setSquare(5,10);}else if(m.to==2){setSquare(0,0);setSquare(3,10);}}
 if(typeOf(p)==6){if(pos.side==0)pos.rights&=~3;else pos.rights&=~12;}if(m.from==56||m.to==56)pos.rights&=~2;if(m.from==63||m.to==63)pos.rights&=~1;if(m.from==0||m.to==0)pos.rights&=~8;if(m.from==7||m.to==7)pos.rights&=~4;pos.ep=-1;if(m.flags&4)pos.ep=(i8)((m.from+m.to)/2);if(typeOf(p)==1||u.captured)pos.half=0;else if(pos.half<65535)pos.half++;if(pos.side)pos.full++;pos.side^=1;if(updateHash){nextHash^=zobCastle[pos.rights];i32 newEpFile=effectiveEpFile();if(newEpFile>=0)nextHash^=zobEp[newEpFile];nextHash^=zobSide;pos.hash=nextHash;}if(inCheck(pos.side^1)){unmake(m,u);return false;}if(updateAcc&&ply>=0&&accReady)updateAccumulator(ply,m,u);return true;}
void Engine::unmake(Move m,const Undo& u){pos.side^=1;pos.rights=u.rights;pos.ep=u.ep;pos.half=u.half;pos.full=u.full;i32 p=pos.board[m.to];setSquare(m.to,0);setSquare(m.from,m.promo?(pos.side?7:1):p);if(m.flags&1){i32 cap=m.to+(pos.side?-8:8);setSquare(cap,u.captured);}else if(u.captured)setSquare(m.to,u.captured);if(m.flags&2){if(m.to==62){setSquare(61,0);setSquare(63,4);}else if(m.to==58){setSquare(59,0);setSquare(56,4);}else if(m.to==6){setSquare(5,0);setSquare(7,10);}else if(m.to==2){setSquare(3,0);setSquare(0,10);}}pos.hash=u.hash;}
i32 Engine::generate(Move* out,bool caps){
 i32 n=0,side=pos.side;
 const u64 own=pos.occ[side],enemy=pos.occ[side^1];
 const u64 enemyKing=pos.bb[(side^1)*6+5];
 // Pawns are handled explicitly so promotions, en-passant and double pushes
 // retain their exact move flags. The non-pawn generator below is bitboard based.
 u64 pawns=pos.bb[side*6];
 while(pawns){
  i32 from=poplsb(pawns),r=rankOf(from),f=fileOf(from),step=side?1:-1,rr=r+step;
  if(rr<0||rr>7)continue;
  i32 forward=rr*8+f;
  if(!pos.board[forward]){
   if(rr==0||rr==7){
    out[n++]={(u8)from,(u8)forward,5,0};out[n++]={(u8)from,(u8)forward,4,0};
    out[n++]={(u8)from,(u8)forward,3,0};out[n++]={(u8)from,(u8)forward,2,0};
   }else if(!caps){
    out[n++]={(u8)from,(u8)forward,0,0};
    if((side==0&&r==6)||(side==1&&r==1)){
     i32 two=(r+2*step)*8+f;if(!pos.board[two])out[n++]={(u8)from,(u8)two,0,4};
    }
   }
  }
  for(i32 df=-1;df<=1;df+=2){
   i32 ff=f+df;if(ff<0||ff>7)continue;
   i32 to=rr*8+ff;
   if(((enemy&~enemyKing)&bit(to))||to==pos.ep){
    u8 flags=to==pos.ep?1:0;
    if(rr==0||rr==7){
     out[n++]={(u8)from,(u8)to,5,flags};out[n++]={(u8)from,(u8)to,4,flags};
     out[n++]={(u8)from,(u8)to,3,flags};out[n++]={(u8)from,(u8)to,2,flags};
    }else out[n++]={(u8)from,(u8)to,0,flags};
   }
  }
 }
 // Leaper and slider targets are generated as masks, then emitted least-significant
 // bit first. Own blockers and enemy kings are removed before move creation.
 for(i32 type=2;type<=6;type++){
  u64 pieces=pos.bb[side*6+(type-1)];
  while(pieces){
   i32 from=poplsb(pieces);u64 targets=0;
   if(type==2)targets=knightAttackers[from];
   else if(type==3)targets=bishopAttacks(from,pos.all);
   else if(type==4)targets=rookAttacks(from,pos.all);
   else if(type==5)targets=bishopAttacks(from,pos.all)|rookAttacks(from,pos.all);
   else targets=kingAttackers[from];
   targets&=~own;targets&=~enemyKing;
   if(caps)targets&=enemy;
   while(targets){i32 to=poplsb(targets);out[n++]={(u8)from,(u8)to,0,0};}
   if(type==6&&!caps){
    if(side==0&&from==60&&!inCheck(0)){
     if((pos.rights&1)&&!pos.board[61]&&!pos.board[62]&&!attacked(61,1)&&!attacked(62,1))out[n++]={60,62,0,2};
     if((pos.rights&2)&&!pos.board[59]&&!pos.board[58]&&!pos.board[57]&&!attacked(59,1)&&!attacked(58,1))out[n++]={60,58,0,2};
    }else if(side==1&&from==4&&!inCheck(1)){
     if((pos.rights&4)&&!pos.board[5]&&!pos.board[6]&&!attacked(5,0)&&!attacked(6,0))out[n++]={4,6,0,2};
     if((pos.rights&8)&&!pos.board[3]&&!pos.board[2]&&!pos.board[1]&&!attacked(3,0)&&!attacked(2,0))out[n++]={4,2,0,2};
    }
   }
  }
 }
 return n;
}
i32 Engine::legal(Move* out,bool caps){Move tmp[MAX_MOVES];i32 n=generate(tmp,caps),k=0;for(i32 i=0;i<n;i++){Undo u;if(make(tmp[i],u)){unmake(tmp[i],u);out[k++]=tmp[i];}}return k;}
u64 Engine::perftRec(i32 d){if(d==0)return 1;Move ms[MAX_MOVES];i32 n=legal(ms,false);u64 total=0;for(i32 i=0;i<n;i++){Undo u;if(make(ms[i],u)){total+=perftRec(d-1);unmake(ms[i],u);}}return total;}u64 Engine::perft(i32 d){return perftRec(d);}
i32 Engine::rootMoveCount(){Move m[MAX_MOVES];return legal(m,false);}
u64 Engine::rootPerft(i32 index,i32 d,char out[6]){Move m[MAX_MOVES];i32 n=legal(m,false);if(index<0||index>=n)return 0;moveToUci(m[index],out);Undo u;if(!make(m[index],u))return 0;u64 x=perftRec(d-1);unmake(m[index],u);return x;}
static u32 rd32(const u8*p){return (u32)p[0]|((u32)p[1]<<8)|((u32)p[2]<<16)|((u32)p[3]<<24);}static u16 rd16(const u8*p){return (u16)(p[0]|((u16)p[1]<<8));}
bool Engine::loadKpk(const u8*d,u32 n){if(!d||n!=24576)return false;for(u32 i=0;i<n;i++)kpk[i]=d[i];kpkReady=true;return true;}
bool Engine::loadModel(const u8*d,u32 n){if(!d||n!=394776||d[0]!='C'||d[1]!='3'||d[2]!='6'||d[3]!='N'||rd16(d+4)!=1||rd16(d+6)!=768||rd16(d+8)!=256||rd16(d+10)!=1||!rd32(d+12)||rd32(d+16)!=0)return false;for(u32 i=0;i<n;i++)model[i]=d[i];modelReady=true;accReady=false;return true;}
bool Engine::setAdapter(u32 which,const u8*d,u32 n){if(which>1)return false;i32 rank=which?2:1;if(!d||n!=4+513u*(u32)rank||d[0]!=rank||d[1]>14)return false;adapterRank[which]=(u8)rank;adapterShift[which]=d[1];i32 at=4;for(i32 i=0;i<256*rank;i++)adapterAW[which][i]=(i8)d[at++];for(i32 i=0;i<256*rank;i++)adapterAB[which][i]=(i8)d[at++];for(i32 i=0;i<rank;i++)adapterB[which][i]=(i8)d[at++];accReady=false;return true;}
i32 Engine::evaluate(){rebuildAccumulator(0);return evalRaw(0);}
void Engine::rebuildAccumulator(i32 frame){if(frame<0||frame>MAX_PLY||!modelReady)return;for(i32 h=0;h<256;h++){i32 dw=0,db=0;for(i32 a=0;a<2;a++){i32 rank=adapterRank[a],x=0,y=0;for(i32 k=0;k<rank;k++){x+=(i32)adapterAW[a][h*rank+k]*(i32)adapterB[a][k];y+=(i32)adapterAB[a][h*rank+k]*(i32)adapterB[a][k];}dw+=x>>adapterShift[a];db+=y>>adapterShift[a];}accW[frame][h]=(i16)clampI((i32)(i16)rd16(model+20+196608*2+h*2)+dw,-32768,32767);accB[frame][h]=(i16)clampI((i32)(i16)rd16(model+20+196608*2+512+h*2)+db,-32768,32767);}
 const u8* wW=model+20,*wB=wW+196608;for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(!p)continue;i32 type=typeOf(p),c=sideOf(p),codeW=c==0?type:type+6,codeB=c==1?type:type+6;const u8* rowW=wW+((s*12+codeW-1)*256),*rowB=wB+(((s^56)*12+codeB-1)*256);for(i32 h=0;h<256;h++){accW[frame][h]=(i16)clampI((i32)accW[frame][h]+(i8)rowW[h],-32768,32767);accB[frame][h]=(i16)clampI((i32)accB[frame][h]+(i8)rowB[h],-32768,32767);}}
 if(frame==0)accReady=true;}
void Engine::updateAccumulator(i32 ply,Move m,const Undo& u){i32 dst=ply+1;if(dst>MAX_PLY)return;for(i32 h=0;h<256;h++){accW[dst][h]=accW[ply][h];accB[dst][h]=accB[ply][h];}
 i32 changed[5],before[5],count=0;changed[count]=m.from;before[count++]=u.moved;changed[count]=m.to;before[count++]=(m.flags&1)?0:u.captured;if(m.flags&1){changed[count]=m.to+(pos.side?8:-8);before[count++]=u.captured;}if(m.flags&2){if(m.to==62){changed[count]=63;before[count++]=4;changed[count]=61;before[count++]=0;}else if(m.to==58){changed[count]=56;before[count++]=4;changed[count]=59;before[count++]=0;}else if(m.to==6){changed[count]=7;before[count++]=10;changed[count]=5;before[count++]=0;}else if(m.to==2){changed[count]=0;before[count++]=10;changed[count]=3;before[count++]=0;}}
 const u8* wW=model+20,*wB=wW+196608;for(i32 j=0;j<count;j++){i32 sq=changed[j],oldPiece=before[j],newPiece=pos.board[sq],oldType=oldPiece?typeOf(oldPiece):0,oldColor=oldPiece?sideOf(oldPiece):-1,newType=newPiece?typeOf(newPiece):0,newColor=newPiece?sideOf(newPiece):-1;u8 beforeW=(u8)(oldPiece?(oldColor==0?oldType:oldType+6):0),afterW=(u8)(newPiece?(newColor==0?newType:newType+6):0),beforeB=(u8)(oldPiece?(oldColor==1?oldType:oldType+6):0),afterB=(u8)(newPiece?(newColor==1?newType:newType+6):0);if(beforeW!=afterW){const u8* oldRow=beforeW?wW+((sq*12+beforeW-1)*256):nullptr;const u8* newRow=afterW?wW+((sq*12+afterW-1)*256):nullptr;for(i32 h=0;h<256;h++){i32 v=accW[dst][h];if(oldRow)v-=(i8)oldRow[h];if(newRow)v+=(i8)newRow[h];accW[dst][h]=(i16)clampI(v,-32768,32767);}}i32 relB=sq^56;if(beforeB!=afterB){const u8* oldRow=beforeB?wB+((relB*12+beforeB-1)*256):nullptr;const u8* newRow=afterB?wB+((relB*12+afterB-1)*256):nullptr;for(i32 h=0;h<256;h++){i32 v=accB[dst][h];if(oldRow)v-=(i8)oldRow[h];if(newRow)v+=(i8)newRow[h];accB[dst][h]=(i16)clampI(v,-32768,32767);}}}}

i32 Engine::nnueEval(i32 ply){if(!modelReady)return 0;if(!accReady)rebuildAccumulator(0);if(ply<0)ply=0;if(ply>MAX_PLY)ply=MAX_PLY;const u8* outW=model+20+196608*2+512*2; i64 sum=(i32)rd32(outW+512);const i8* ow=(const i8*)outW;i16* stm=pos.side?accB[ply]:accW[ply];i16* nstm=pos.side?accW[ply]:accB[ply];for(i32 h=0;h<256;h++){i32 x=clampI(stm[h],0,255);sum+=(i64)x*x*ow[h];}for(i32 h=0;h<256;h++){i32 x=clampI(nstm[h],0,255);sum+=(i64)x*x*ow[256+h];}i32 divisor=(i32)rd32(model+12);i64 num=(i64)sum*1000;i64 q=num/divisor,rem=num%divisor;if(rem<0)rem=-rem;if(num>=0){if(rem*2>=divisor)q++;}else{if(rem*2>divisor)q--;}return (i32)q;}
i32 Engine::nnueEvalRecompute()const{if(!modelReady)return 0;const u8* wW=model+20,*wB=wW+196608,*bW=wB+196608,*bB=bW+512,*outW=bB+512;i32 aw[256],ab[256];for(i32 h=0;h<256;h++){i32 dw=0,db=0;for(i32 a=0;a<2;a++){i32 rank=adapterRank[a],x=0,y=0;for(i32 k=0;k<rank;k++){x+=(i32)adapterAW[a][h*rank+k]*(i32)adapterB[a][k];y+=(i32)adapterAB[a][h*rank+k]*(i32)adapterB[a][k];}dw+=x>>adapterShift[a];db+=y>>adapterShift[a];}aw[h]=clampI((i32)(i16)rd16(bW+h*2)+dw,-32768,32767);ab[h]=clampI((i32)(i16)rd16(bB+h*2)+db,-32768,32767);}for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(!p)continue;i32 type=typeOf(p),c=sideOf(p),cw=c==0?type:type+6,cb=c==1?type:type+6;const u8* rowW=wW+((s*12+cw-1)*256),*rowB=wB+(((s^56)*12+cb-1)*256);for(i32 h=0;h<256;h++){aw[h]=clampI(aw[h]+(i8)rowW[h],-32768,32767);ab[h]=clampI(ab[h]+(i8)rowB[h],-32768,32767);}}i64 sum=(i32)rd32(outW+512);const i8* ow=(const i8*)outW;i32* stm=pos.side?ab:aw; i32* nstm=pos.side?aw:ab;for(i32 h=0;h<256;h++){i32 x=clampI(stm[h],0,255);sum+=(i64)x*x*ow[h];}for(i32 h=0;h<256;h++){i32 x=clampI(nstm[h],0,255);sum+=(i64)x*x*ow[256+h];}i32 divisor=(i32)rd32(model+12);i64 num=(i64)sum*1000;i64 q=num/divisor,rem=num%divisor;if(rem<0)rem=-rem;if(num>=0){if(rem*2>=divisor)q++;}else{if(rem*2>divisor)q--;}return (i32)q;}
i32 Engine::kpkProbe()const{if(!kpkReady||pos.half>=50||pos.rights)return 2147483647; i32 pawn=-1,pawnSide=-1,nonKing=0,wk=-1,bk=-1;for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(!p)continue;i32 t=typeOf(p),c=sideOf(p);if(t==6){if(c==0)wk=s;else bk=s;}else{nonKing++;if(t==1){pawn=s;pawnSide=c;}}}if(nonKing!=1||pawn<0||wk<0||bk<0)return 2147483647;i32 p=((7-rankOf(pawn))<<3)|fileOf(pawn),w=((7-rankOf(wk))<<3)|fileOf(wk),b=((7-rankOf(bk))<<3)|fileOf(bk),stm=pos.side==pawnSide?0:1;if(pawnSide==1){p=63-p;w=63-w;b=63-b;}if((p&7)>3){p^=7;w^=7;b^=7;}i32 rank=p>>3,file=p&7;if(rank<1||rank>6||file>3||w==b||w==p||b==p)return 2147483647;i32 index=(stm*24+(rank-1)*4+file)*4096+w*64+b;bool won=((kpk[index>>3]>>(index&7))&1)!=0;return won?(pawnSide==pos.side?1200:-1200):0;}
i32 Engine::bareKing()const{if(pos.half>=90)return 0;i32 count[2][7]={};i32 bishopMask[2]={};for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(!p)continue;i32 t=typeOf(p),c=sideOf(p);if(t==6)continue;count[c][t]++;if(t==3)bishopMask[c]|=1<<((rankOf(s)+fileOf(s))&1);}i32 a0=0,a1=0;for(i32 t=1;t<=5;t++){a0+=count[0][t];a1+=count[1][t];}if((a0==0)==(a1==0))return 0;i32 attacker=a0?0:1,p=count[attacker][1],n=count[attacker][2],b=count[attacker][3],r=count[attacker][4],q=count[attacker][5];if(!p&&!n&&b==2&&!r&&!q&&bishopMask[attacker]!=3)return 2147483646;bool win=q>0||r>0||(b>0&&n>0);return win?(attacker==pos.side?1600:-1600):0;}
i32 Engine::mopUp()const{i32 ownK=-1,enemyK=-1,own=0,enemy=0;for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(!p)continue;i32 t=typeOf(p),v=t==5?900:t==4?500:t==3?330:t==2?320:t==1?100:0;if(t==6){if(sideOf(p)==pos.side)ownK=s;else enemyK=s;}else if(sideOf(p)==pos.side)own+=v;else enemy+=v;}if(ownK<0||enemyK<0||own<=enemy+250)return 0;i32 f=fileOf(enemyK),r=rankOf(enemyK),edge=f,v=7-f;if(v<edge)edge=v;v=r;if(v<edge)edge=v;v=7-r;if(v<edge)edge=v;i32 dx=absI(fileOf(ownK)-f),dy=absI(rankOf(ownK)-r),inward=12-dx-dy;if(inward<0)inward=0;return (7-edge)*7+inward*2;}
i32 Engine::evalRaw(i32 ply){i32 k=kpkProbe();if(k!=2147483647)return k;i32 b=bareKing();if(b==2147483646)return 0;if(b)return b+mopUp();return nnueEval(ply)+mopUp();}
i32 Engine::effectiveEpFile()const{if(pos.ep<0||pos.ep>=64||pos.board[pos.ep])return -1;const i32 side=pos.side,enemy=side^1,ep=pos.ep,victim=ep+(side==0?8:-8);if(!inside(victim)||pos.board[victim]!=(enemy?7:1))return -1;u64 candidates=pos.bb[side*6]&pawnAttackers[side][ep];while(candidates){i32 from=poplsb(candidates);Position tmp=pos;u64 fromBit=bit(from),victimBit=bit(victim),epBit=bit(ep);tmp.board[from]=0;tmp.bb[side*6]&=~fromBit;tmp.occ[side]&=~fromBit;tmp.all&=~fromBit;tmp.board[victim]=0;tmp.bb[enemy*6]&=~victimBit;tmp.occ[enemy]&=~victimBit;tmp.all&=~victimBit;tmp.board[ep]=(u8)(side?7:1);tmp.bb[side*6]|=epBit;tmp.occ[side]|=epBit;tmp.all|=epBit;const i32 king=tmp.kingSq[side];const u64 pawns=tmp.bb[enemy*6],knights=tmp.bb[enemy*6+1],bishops=tmp.bb[enemy*6+2],rooks=tmp.bb[enemy*6+3],queens=tmp.bb[enemy*6+4],kings=tmp.bb[enemy*6+5];const bool attackedKing=king<0||(pawns&pawnAttackers[enemy][king])||(knights&knightAttackers[king])||(kings&kingAttackers[king])||((bishops|queens)&bishopAttacks(king,tmp.all))||((rooks|queens)&rookAttacks(king,tmp.all));if(!attackedKing)return fileOf(ep);}return -1;}
bool Engine::insufficientMaterial()const{if((pos.bb[0]|pos.bb[6]|pos.bb[3]|pos.bb[9]|pos.bb[4]|pos.bb[10])!=0)return false;const u64 knights=pos.bb[1]|pos.bb[7],bishops=pos.bb[2]|pos.bb[8],minors=knights|bishops;if(__builtin_popcountll(minors)<=1)return true;if(knights)return false;const u64 darkSquares=0xaa55aa55aa55aa55ull;return !(bishops&darkSquares)||!(bishops&~darkSquares);}
i32 Engine::historyKeyCount(u64 key)const{u32 at=(u32)((key^(key>>32)^(key>>17))&1023u);for(i32 n=0;n<1024;n++,at=(at+1)&1023u){if(!repetitionUsed[at])return 0;if(repetitionKeys[at]==key)return repetitionCounts[at];}return 0;}
void Engine::addHistoryKey(u64 key){u32 at=(u32)((key^(key>>32)^(key>>17))&1023u);for(i32 n=0;n<1024;n++,at=(at+1)&1023u){if(!repetitionUsed[at]){repetitionUsed[at]=1;repetitionKeys[at]=key;repetitionCounts[at]=1;return;}if(repetitionKeys[at]==key){if(repetitionCounts[at]<65535)repetitionCounts[at]++;return;}}}
void Engine::rebuildRepetitionTable(){for(i32 i=0;i<1024;i++){repetitionUsed[i]=0;repetitionCounts[i]=0;}for(i32 i=0;i<gameHistoryCount;i++)addHistoryKey(gameHistory[i]);}
i32 Engine::repetitionMatches(i32 ply)const{i32 matches=historyKeyCount(pos.hash);if(gameHistoryCount&&gameHistory[gameHistoryCount-1]==pos.hash&&matches>0)matches--;if(ply>0)for(i32 back=2;back<=ply;back+=2)if(pathValid[ply-back]&&pathHash[ply-back]==pos.hash)matches++;return matches;}
u64 Engine::computeHash()const{u64 h=zobCastle[pos.rights];if(pos.side)h^=zobSide;i32 epFile=effectiveEpFile();if(epFile>=0)h^=zobEp[epFile];for(i32 s=0;s<64;s++){i32 p=pos.board[s];if(p)h^=zobPiece[p-1][s];}return h;}
u64 Engine::hash()const{return pos.hash;}u64 Engine::currentHash()const{return pos.hash;}bool Engine::verifyHash()const{return pos.hash==computeHash();}i32 Engine::staticExchange(const char* text){Move m;if(!parseUciMove(text,m))return -32000;seeCalls++;return see(m);}
i32 Engine::scoreToTT(i32 score,i32 ply){if(score>MATE_THRESHOLD)return score+ply;if(score< -MATE_THRESHOLD)return score-ply;return score;}
i32 Engine::scoreFromTT(i32 score,i32 ply){if(score>MATE_THRESHOLD)return score-ply;if(score< -MATE_THRESHOLD)return score+ply;return score;}
static bool pieceAttacks(const u8* board,i32 from,i32 to,i32 piece){i32 fr=rankOf(from),ff=fileOf(from),tr=rankOf(to),tf=fileOf(to),dr=tr-fr,df=tf-ff,t=typeOf(piece),c=sideOf(piece),adr=absI(dr),adf=absI(df);if(t==1)return dr==(c==0?-1:1)&&adf==1;if(t==2)return (adr==2&&adf==1)||(adr==1&&adf==2);if(t==6)return adr<=1&&adf<=1&&(adr||adf);if(t==3&&adr!=adf)return false;if(t==4&&dr!=0&&df!=0)return false;if(t==5&&dr!=0&&df!=0&&adr!=adf)return false;if(t<3||t>5)return false; i32 sr=dr==0?0:(dr>0?1:-1),sf=df==0?0:(df>0?1:-1),r=fr+sr,f=ff+sf;while(r!=tr||f!=tf){if(board[r*8+f])return false;r+=sr;f+=sf;}return true;}
i32 Engine::seeReference(Move m)const{
 if(m.from>=64||m.to>=64)return 0;u8 b[64];for(i32 i=0;i<64;i++)b[i]=pos.board[i];i32 moving=b[m.from];if(!moving)return 0;
 i32 capSq=(m.flags&1)?m.to+(pos.side?-8:8):m.to; i32 captured=b[capSq];if(!captured&&!m.promo)return 0;
 i32 placed=m.promo?(pos.side?m.promo+6:m.promo):moving,gain[32],depth=0;
 gain[0]=(captured?val[typeOf(captured)]:0)+(m.promo?val[m.promo]-val[1]:0);b[m.from]=0;b[capSq]=0;b[m.to]=(u8)placed;i32 occupant=placed,side=pos.side^1;
 while(depth<29){i32 bestSq=-1,bestPiece=0,bestValue=2147483647;for(i32 sq=0;sq<64;sq++){i32 p=b[sq];if(!p||sideOf(p)!=side)continue;i32 v=val[typeOf(p)];if(v>=bestValue)continue;if(pieceAttacks(b,sq,m.to,p)){bestValue=v;bestSq=sq;bestPiece=p;}}
  if(bestSq<0)break;depth++;i32 promotion=typeOf(bestPiece)==1&&((side==0&&rankOf(m.to)==0)||(side==1&&rankOf(m.to)==7));gain[depth]=val[typeOf(occupant)]-gain[depth-1]+(promotion?val[5]-val[1]:0);b[bestSq]=0;if(promotion)bestPiece=side?11:5;b[m.to]=(u8)bestPiece;occupant=bestPiece;side^=1;}
 while(depth>0){gain[depth-1]=-(((-gain[depth-1])>gain[depth])?(-gain[depth-1]):gain[depth]);depth--;}return gain[0];}
i32 Engine::see(Move m)const{
 if(m.from>=64||m.to>=64)return 0;i32 moving=pos.board[m.from];if(!moving)return 0;
 i32 capSq=(m.flags&1)?m.to+(pos.side?-8:8):m.to,captured=pos.board[capSq];if(!captured&&!m.promo)return 0;
 u64 pieces[12];for(i32 i=0;i<12;i++)pieces[i]=pos.bb[i];u64 occupied=pos.all;
 i32 placed=m.promo?(pos.side?m.promo+6:m.promo):moving,occupant=placed,side=pos.side^1;
 pieces[moving-1]&=~(1ull<<m.from);occupied&=~(1ull<<m.from);
 if(captured){pieces[captured-1]&=~(1ull<<capSq);occupied&=~(1ull<<capSq);}
 pieces[placed-1]|=1ull<<m.to;occupied|=1ull<<m.to;
 i32 gain[32],depth=0;gain[0]=(captured?val[typeOf(captured)]:0)+(m.promo?val[m.promo]-val[1]:0);
 static const i8 drs[8]={-1,-1,-1,0,0,1,1,1},dfs[8]={-1,0,1,-1,1,-1,0,1};
 while(depth<29){i32 bestSq=64,bestType=0,bestValue=2147483647;u64 candidates=pieces[side*6] & pawnAttackers[side][m.to];if(candidates){i32 sq=__builtin_ctzll(candidates);bestSq=sq;bestType=1;bestValue=val[1];}
  candidates=pieces[side*6+1] & knightAttackers[m.to];if(candidates){i32 sq=__builtin_ctzll(candidates),v=val[2];if(v<bestValue||(v==bestValue&&sq<bestSq)){bestSq=sq;bestType=2;bestValue=v;}}
  candidates=pieces[side*6+2];u64 bishops=0;for(i32 d=0;d<8;d++)if(d==0||d==2||d==5||d==7){i32 r=rankOf(m.to)+drs[d],f=fileOf(m.to)+dfs[d];while(r>=0&&r<8&&f>=0&&f<8){i32 sq=r*8+f;u64 bit=1ull<<sq;if(occupied&bit){if((pieces[side*6+2]|pieces[side*6+4])&bit)bishops|=bit;break;}r+=drs[d];f+=dfs[d];}}
  candidates=bishops;if(candidates){i32 sq=__builtin_ctzll(candidates),type=(pieces[side*6+2]&(1ull<<sq))?3:5,v=val[type];if(v<bestValue||(v==bestValue&&sq<bestSq)){bestSq=sq;bestType=type;bestValue=v;}}
  u64 rooks=0;for(i32 d=0;d<8;d++)if(d==1||d==3||d==4||d==6){i32 r=rankOf(m.to)+drs[d],f=fileOf(m.to)+dfs[d];while(r>=0&&r<8&&f>=0&&f<8){i32 sq=r*8+f;u64 bit=1ull<<sq;if(occupied&bit){if((pieces[side*6+3]|pieces[side*6+4])&bit)rooks|=bit;break;}r+=drs[d];f+=dfs[d];}}
  candidates=rooks;if(candidates){i32 sq=__builtin_ctzll(candidates),type=(pieces[side*6+3]&(1ull<<sq))?4:5,v=val[type];if(v<bestValue||(v==bestValue&&sq<bestSq)){bestSq=sq;bestType=type;bestValue=v;}}
  candidates=pieces[side*6+5] & kingAttackers[m.to];if(candidates){i32 sq=__builtin_ctzll(candidates);if(val[6]<bestValue||(val[6]==bestValue&&sq<bestSq)){bestSq=sq;bestType=6;bestValue=val[6];}}
  if(bestSq>=64)break;depth++;bool promotion=bestType==1&&((side==0&&rankOf(m.to)==0)||(side==1&&rankOf(m.to)==7));gain[depth]=val[typeOf(occupant)]-gain[depth-1]+(promotion?val[5]-val[1]:0);
  pieces[occupant-1]&=~(1ull<<m.to);pieces[side*6+bestType-1]&=~(1ull<<bestSq);occupied&=~(1ull<<bestSq);
  i32 newPiece=promotion?(side?11:5):(side*6+bestType);pieces[newPiece-1]|=1ull<<m.to;occupant=newPiece;side^=1;
 }
 while(depth>0){gain[depth-1]=-(((-gain[depth-1])>gain[depth])?(-gain[depth-1]):gain[depth]);depth--;}
 return gain[0];}
i32 Engine::moveScore(Move m,Move tm,i32 ply){if(eqMove(tm,m)&&tm.from<64)return 20000000;i32 p=pos.board[m.from],cap=pos.board[m.to];if(!cap&&(m.flags&1))cap=pos.side?1:7;if(cap){seeCalls++;return 1000000+val[typeOf(cap)]*16-val[typeOf(p)]+see(m);}if(m.promo)return 900000+val[m.promo];if(eqMove(m,killers[ply][0]))return 800000;if(eqMove(m,killers[ply][1]))return 790000;i32 pc=p,prev=prevClass[ply],pt=prevTo[ply],sc=history[pos.side][m.from][m.to];if(prev>0){if(eqMove(counterMove[prev][pt],m))sc+=7000;sc+=contHistory[prev][pt][pc][m.to];}i32 prev2=prev2Class[ply],pt2=prev2To[ply];if(prev2>0)sc+=contHistory2[prev2][pt2][pc][m.to];return sc;}
void Engine::order(Move*m,i32 n,Move tm,i32 ply){i32 scores[MAX_MOVES];for(i32 i=0;i<n;i++)scores[i]=moveScore(m[i],tm,ply);for(i32 i=1;i<n;i++){Move x=m[i];i32 sc=scores[i],j=i-1;while(j>=0&&scores[j]<sc){m[j+1]=m[j];scores[j+1]=scores[j];j--;}m[j+1]=x;scores[j+1]=sc;}}
void Engine::updateHistory(Move m,i32 ply,i32 d,Move*tried,i32 count){i32 bonus=clampI(d*d*24,1,2048),side=pos.side,prev=prevClass[ply],pt=prevTo[ply],pc=pos.board[m.from];for(i32 i=0;i<count;i++){Move q=tried[i];i32 qp=pos.board[q.from];if(qp&&typeOf(qp)!=1&&!pos.board[q.to]){i32 h=history[side][q.from][q.to];h=clampI(h-bonus-h*bonus/16384,-16000,16000);history[side][q.from][q.to]=(i16)h;if(prev>0){i32 ch=contHistory[prev][pt][qp][q.to];ch=clampI(ch-bonus/2-ch*(bonus/2)/16384,-12000,12000);contHistory[prev][pt][qp][q.to]=(i16)ch;}}}i32 h=history[side][m.from][m.to];h=clampI(h+bonus-h*bonus/16384,-16000,16000);history[side][m.from][m.to]=(i16)h;if(prev>0){counterMove[prev][pt]=m;i32 ch=contHistory[prev][pt][pc][m.to];ch=clampI(ch+bonus/2-ch*(bonus/2)/16384,-12000,12000);contHistory[prev][pt][pc][m.to]=(i16)ch;}i32 prev2=prev2Class[ply],pt2=prev2To[ply];if(prev2>0){i32 ch2=contHistory2[prev2][pt2][pc][m.to];ch2=clampI(ch2+bonus/3-ch2*(bonus/3)/16384,-12000,12000);contHistory2[prev2][pt2][pc][m.to]=(i16)ch2;}killers[ply][1]=killers[ply][0];killers[ply][0]=m;}
void Engine::resetSearchHeuristics(){for(i32 p=0;p<MAX_PLY;p++){killers[p][0]={255,255,0,0};killers[p][1]={255,255,0,0};prevClass[p]=prevTo[p]=prev2Class[p]=prev2To[p]=0;pathHash[p]=0;pathValid[p]=0;}for(i32 p=0;p<16;p++)for(i32 q=0;q<64;q++)counterMove[p][q]={255,255,0,0};for(i32 side=0;side<2;side++)for(i32 f=0;f<64;f++)for(i32 t=0;t<64;t++)history[side][f][t]=0;for(i32 a=0;a<16;a++)for(i32 b=0;b<64;b++)for(i32 c=0;c<16;c++)for(i32 d=0;d<64;d++){contHistory[a][b][c][d]=0;contHistory2[a][b][c][d]=0;}}
i32 Engine::qsearch(i32 alpha,i32 beta,i32 ply,i32 qd,bool allowRepetition){qnodes++;if(pos.half>=100||insufficientMaterial())return 0;if(allowRepetition&&repetitionMatches(ply)>=2)return 0;u64 key=hash();pathHash[ply]=key;pathValid[ply]=allowRepetition?1:0;if(nodeLimit&&(nodes+qnodes)>=nodeLimit){aborted=true;return evalRaw(ply);}if(stopMs&&(((nodes+qnodes)&255)==0)&&chelo_host_now_ms()-startTick>=stopMs){aborted=true;return evalRaw(ply);}bool check=inCheck(pos.side);Move ms[MAX_MOVES];i32 n=legal(ms,!check);if(!check&&n==0){Move all[MAX_MOVES];if(legal(all,false)==0)return 0;}if(check&&n==0)return -MATE_SCORE+ply;i32 stand=evalRaw(ply);if(!check){if(stand>=beta)return beta;if(stand>alpha)alpha=stand;if(qd<=0)return alpha;/* A queen-sized swing plus margin bounds ordinary capture sequences. Promotions are searched explicitly. */if(stand+val[5]+250<alpha)return alpha;}else if(qd<=-6)return stand;if(ply>=MAX_PLY-2)return check?-MATE_SCORE+ply:alpha;order(ms,n,Move{255,255,0,0},ply);for(i32 i=0;i<n;i++){Move m=ms[i];bool losingCapture=false;if(!check&&!m.promo){i32 captured=pos.board[m.to];if(!captured&&(m.flags&1))captured=pos.side?1:7;if(captured){seeCalls++;losingCapture=see(m)<0;}}Undo u;if(!make(m,u,ply,true,true))continue;/* Never prune a losing-looking capture when it gives check: checks can force mate or win material. */if(losingCapture&&!inCheck(pos.side)){unmake(m,u);continue;}i32 score=-qsearch(-beta,-alpha,ply+1,qd-1,allowRepetition);unmake(m,u);if(aborted)return alpha;if(score>=beta){betaCuts++;return beta;}if(score>alpha)alpha=score;}return alpha;}
i32 Engine::searchNode(i32 d,i32 alpha,i32 beta,i32 ply,bool allowNull,bool allowRepetition){if(ply>=MAX_PLY-2)return evalRaw(ply);if(pos.half>=100||insufficientMaterial())return 0;nodes++;if(nodeLimit&&(nodes+qnodes)>=nodeLimit){aborted=true;return evalRaw(ply);}if(stopMs&&(((nodes+qnodes)&255)==0)&&chelo_host_now_ms()-startTick>=stopMs){aborted=true;return evalRaw(ply);}i32 repMatches=allowRepetition?repetitionMatches(ply):0;if(repMatches>=2)return 0;if(d<=0)return qsearch(alpha,beta,ply,5,allowRepetition);bool pathSensitive=!allowRepetition||pos.half>=90||repMatches>0;bool check=inCheck(pos.side);i32 originalAlpha=alpha;u64 key=hash();pathHash[ply]=key;pathValid[ply]=allowRepetition?1:0;i32 bucket=(i32)(key&(TT_BUCKETS-1))*TT_WAYS,slot=-1;Move ttMove{255,255,0,0};ttProbes++;for(i32 w=0;w<TT_WAYS;w++){TTEntry&x=tt[bucket+w];if(x.depth>=0&&x.key==key){slot=bucket+w;ttMove=x.move;ttHits++;if(!pathSensitive&&x.half==pos.half&&x.depth>=d){i32 sc=scoreFromTT(x.score,ply);if(x.flag==0){if(ply==0)rootIterationBest=ttMove;ttCuts++;return sc;}if(x.flag==1&&sc<=alpha){if(ply==0)rootIterationBest=ttMove;ttCuts++;return sc;}if(x.flag==2&&sc>=beta){if(ply==0)rootIterationBest=ttMove;ttCuts++;return sc;}}break;}}
 i32 staticEval=check?0:evalRaw(ply),staticMargin=0;if(!check&&d<=3){staticMargin=90+d*95;if(staticEval-staticMargin>=beta)return staticEval-staticMargin;}if(!check&&d>=3&&allowNull&&beta-alpha==1&&beta<MATE_SCORE&&pos.half<90){const u64 nonPawnMaterial=pos.bb[pos.side*6+1]|pos.bb[pos.side*6+2]|pos.bb[pos.side*6+3]|pos.bb[pos.side*6+4];if(nonPawnMaterial){i8 savedEp=pos.ep;u16 savedHalf=pos.half;u64 savedHash=pos.hash;i32 epFile=effectiveEpFile();if(epFile>=0)pos.hash^=zobEp[epFile];pos.ep=-1;if(pos.half<65535)pos.half++;pos.side^=1;pos.hash^=zobSide;for(i32 h=0;h<256;h++){accW[ply+1][h]=accW[ply][h];accB[ply+1][h]=accB[ply][h];}i32 reduction=d>=6?3:2;i32 sc=-searchNode(d-1-reduction,-beta,-beta+1,ply+1,false,false);pos.side^=1;pos.ep=savedEp;pos.half=savedHalf;pos.hash=savedHash;if(aborted)return staticEval;if(sc>=beta){if(d>=6){i32 verify=searchNode(d-1-reduction,beta-1,beta,ply,false,true);if(verify<beta)return verify;}else return beta;}}}
 Move ms[MAX_MOVES];i32 n=legal(ms,false);if(!n)return check?-MATE_SCORE+ply:0;order(ms,n,ttMove,ply);i32 best=-32000,legalN=0,quietN=0;Move tried[MAX_MOVES],bestMove{255,255,0,0};for(i32 i=0;i<n;i++){Move m=ms[i];i32 moving=pos.board[m.from],captured=pos.board[m.to];bool quiet=!captured&&!m.promo&&!(m.flags&1);if(d<=3&&!check&&legalN>0&&quiet&&staticEval+staticMargin<=alpha)continue;Undo u;if(!make(m,u,ply,true,true))continue;legalN++;i32 child=d-1;i32 score;prev2Class[ply+1]=prevClass[ply];prev2To[ply+1]=prevTo[ply];prevClass[ply+1]=moving;prevTo[ply+1]=m.to;if(legalN==1)score=-searchNode(child,-beta,-alpha,ply+1,true,allowRepetition);else{i32 reduction=0;if(d>=3&&legalN>=4&&quiet&&!check)reduction=(d>=6&&legalN>=9)?2:1;if(reduction)lmrReductions++;score=-searchNode(child-reduction,-alpha-1,-alpha,ply+1,true,allowRepetition);if(!aborted&&score>alpha&&reduction){lmrResearches++;score=-searchNode(child,-alpha-1,-alpha,ply+1,true,allowRepetition);}if(!aborted&&score>alpha&&score<beta)score=-searchNode(child,-beta,-alpha,ply+1,true,allowRepetition);}unmake(m,u);if(aborted)return best==-32000?staticEval:best;if(quiet)tried[quietN++]=m;if(score>best){best=score;bestMove=m;}if(score>alpha)alpha=score;if(alpha>=beta){betaCuts++;if(legalN==1)firstMoveCuts++;if(quiet)updateHistory(m,ply,d,tried,quietN);break;}}
 if(legalN==0&&check)return -MATE_SCORE+ply;if(best==-32000)best=staticEval;if(ply==0&&bestMove.from<64)rootIterationBest=bestMove;if(!pathSensitive){if(slot<0){i32 replace=bucket;for(i32 w=0;w<TT_WAYS;w++){i32 at=bucket+w;TTEntry&x=tt[at];if(x.depth<0){replace=at;break;}u8 ageDistance=(u8)(age-x.age),oldDistance=(u8)(age-tt[replace].age);if(ageDistance>oldDistance||(ageDistance==oldDistance&&x.depth<tt[replace].depth))replace=at;}slot=replace;}TTEntry&e=tt[slot];e.key=key;e.move=bestMove;e.score=(i16)scoreToTT(best,ply);e.depth=(i8)(d>127?127:d);e.half=(i16)pos.half;e.flag=best<=originalAlpha?1:best>=beta?2:0;e.age=age;}return best;}
SearchResult Engine::search(i32 depth,u32 ms,u64 fixedNodes,u32 softMs){nodes=qnodes=ttProbes=ttHits=ttCuts=betaCuts=firstMoveCuts=lmrReductions=lmrResearches=seeCalls=0;nodeLimit=fixedNodes;rootDepth=depth;stopMs=ms;aborted=false;rootIterationBest={255,255,0,0};age++;startTick=chelo_host_now_ms();rebuildAccumulator(0);Move rootMoves[MAX_MOVES];i32 rootN=legal(rootMoves,false);Move best=rootN?rootMoves[0]:Move{255,255,0,0};if(!rootN)return {best,inCheck(pos.side)?-MATE_SCORE:0,0,0,0,0,0,0,0,0,0,0,0};if(pos.half>=100||insufficientMaterial()||repetitionMatches(0)>=2)return {best,0,0,0,0,0,0,0,0,0,0,0,0};/* Cheap root mate preflight avoids spending an entire fixed-node budget iterating a position where mate is already available. */for(i32 i=0;i<rootN;i++){if(nodeLimit&&(nodes+qnodes)>=nodeLimit)break;nodes++;Undo u;if(!make(rootMoves[i],u,-1,true,false))continue;bool givesCheck=inCheck(pos.side);bool mate=false;if(givesCheck){Move replies[MAX_MOVES];mate=legal(replies,false)==0;}unmake(rootMoves[i],u);if(mate){best=rootMoves[i];return {best,MATE_SCORE-1,1,nodes,qnodes,ttProbes,ttHits,ttCuts,betaCuts,firstMoveCuts,lmrReductions,lmrResearches,seeCalls};}}i32 bestScore=0,done=0,window=48;for(i32 d=1;d<=depth;d++){i32 alpha=d==1?-32000:bestScore-window,beta=d==1?32000:bestScore+window,sc=0;for(;;){sc=searchNode(d,alpha,beta,0,true,true);if(aborted)break;if(sc<=alpha){window*=2;alpha=clampI(sc-window,-32000,32000);continue;}if(sc>=beta){window*=2;beta=clampI(sc+window,-32000,32000);continue;}break;}if(aborted)break;bestScore=sc;done=d;if(rootIterationBest.from<64)best=rootIterationBest;else{u64 k=hash();i32 bucket=(i32)(k&(TT_BUCKETS-1))*TT_WAYS;for(i32 w=0;w<TT_WAYS;w++)if(tt[bucket+w].depth>=0&&tt[bucket+w].key==k&&tt[bucket+w].half==pos.half){best=tt[bucket+w].move;break;}}window=48;if(softMs&&chelo_host_now_ms()-startTick>=softMs)break;}return {best,bestScore,done,nodes,qnodes,ttProbes,ttHits,ttCuts,betaCuts,firstMoveCuts,lmrReductions,lmrResearches,seeCalls};}
void Engine::clearHash(){for(i32 i=0;i<TT_SIZE;i++)tt[i].depth=-1;age=1;}void Engine::newGame(){clearHash();resetSearchHeuristics();gameHistoryCount=0;rebuildRepetitionTable();}
bool Engine::verifyIncremental(i32 plies){if(!modelReady||plies<0||plies>MAX_PLY-2)return false;rebuildAccumulator(0);Undo undos[MAX_PLY];Move madeMoves[MAX_PLY];u32 rng=0x9e3779b9u;i32 made=0;for(i32 i=0;i<plies;i++){Move moves[MAX_MOVES];i32 n=legal(moves,false);if(n<=0)break;rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;Move m=moves[rng%(u32)n];if(!make(m,undos[made],made,true,true))continue;madeMoves[made]=m; i32 incremental=nnueEval(made+1),recomputed=nnueEvalRecompute();if(incremental!=recomputed||!verifyHash()){for(i32 j=made;j>=0;j--)unmake(madeMoves[j],undos[j]);accReady=false;return false;}made++;}for(i32 j=made-1;j>=0;j--)unmake(madeMoves[j],undos[j]);return verifyHash();}
bool Engine::verifyAttackParity(i32 plies){if(plies<0||plies>512)return false;Position saved=pos;u16 savedCount=gameHistoryCount;u64 savedHistory[512];for(i32 i=0;i<512;i++)savedHistory[i]=gameHistory[i];bool ok=setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");u32 rng=0xa341316cu;for(i32 ply=0;ok&&ply<plies;ply++){for(i32 side=0;side<2&&ok;side++)for(i32 sq=0;sq<64;sq++)if(attacked(sq,side)!=attackedReference(sq,side)){ok=false;break;}if(!ok)break;Move moves[MAX_MOVES];i32 n=legal(moves,false);if(n<=0)break;rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;Undo u;if(!make(moves[rng%(u32)n],u,-1,true,false))break;}pos=saved;gameHistoryCount=savedCount;for(i32 i=0;i<512;i++)gameHistory[i]=savedHistory[i];rebuildRepetitionTable();accReady=false;if(modelReady)rebuildAccumulator(0);return ok;}
bool Engine::verifySeeParity(i32 plies){if(plies<0||plies>512)return false;Position saved=pos;u16 savedCount=gameHistoryCount;u64 savedHistory[512];for(i32 i=0;i<512;i++)savedHistory[i]=gameHistory[i];bool ok=setFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");u32 rng=0x6d2b79f5u;i32 captures=0;for(i32 ply=0;ok&&ply<plies;ply++){Move moves[MAX_MOVES];i32 n=legal(moves,false);if(n<=0)break;for(i32 i=0;i<n;i++){Move m=moves[i];if(pos.board[m.to]||((m.flags&1)!=0)||m.promo){if(see(m)!=seeReference(m)){ok=false;break;}captures++;}}if(!ok)break;rng^=rng<<13;rng^=rng>>17;rng^=rng<<5;Undo u;if(!make(moves[rng%(u32)n],u,-1,true,false))break;}pos=saved;gameHistoryCount=savedCount;for(i32 i=0;i<512;i++)gameHistory[i]=savedHistory[i];rebuildRepetitionTable();accReady=false;if(modelReady)rebuildAccumulator(0);return ok&&captures>0;}
i32 Engine::verifySpecialTransition(i32 which){if(!modelReady||which<0||which>2)return 1;Position saved=pos;u16 savedCount=gameHistoryCount;u64 savedHistory[512];for(i32 i=0;i<512;i++)savedHistory[i]=gameHistory[i];static const char* fens[3]={"r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1","4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1","4k3/P7/8/8/8/8/8/4K3 w - - 0 1"};static const char* moves[3]={"e1g1","e5d6","a7a8q"};i32 result=1;if(!setFen(fens[which]))result=2;if(result==1){rebuildAccumulator(0);Move m;if(!parseUciMove(moves[which],m))result=3;else{Undo u;if(!make(m,u,0,true,true))result=4;else{if(nnueEval(1)!=nnueEvalRecompute())result=5;else if(!verifyHash())result=6;unmake(m,u);if(result==1&&nnueEval(0)!=nnueEvalRecompute())result=7;else if(result==1&&!verifyHash())result=8;}}}pos=saved;gameHistoryCount=savedCount;for(i32 i=0;i<512;i++)gameHistory[i]=savedHistory[i];rebuildRepetitionTable();accReady=false;rebuildAccumulator(0);return result;}
bool Engine::verifySpecialTransitions(){for(i32 i=0;i<3;i++)if(verifySpecialTransition(i)!=1)return false;return true;}
bool Engine::same(Move a,Move b)const{return eqMove(a,b);}bool Engine::parseUciMove(const char*t,Move&out){if(!t||t[0]<'a'||t[0]>'h'||t[1]<'1'||t[1]>'8'||t[2]<'a'||t[2]>'h'||t[3]<'1'||t[3]>'8')return false;i32 from=(7-(t[1]-'1'))*8+(t[0]-'a'),to=(7-(t[3]-'1'))*8+(t[2]-'a');i32 promo=0;if(t[4]){char c=t[4];promo=c=='n'?2:c=='b'?3:c=='r'?4:c=='q'?5:0;}Move ms[MAX_MOVES];i32 n=legal(ms,false);for(i32 i=0;i<n;i++)if(ms[i].from==from&&ms[i].to==to&&ms[i].promo==promo){out=ms[i];return true;}return false;}
bool Engine::playUciMove(const char*t){Move m;if(!parseUciMove(t,m))return false;Undo u;if(!make(m,u,-1,true,false))return false;if(gameHistoryCount<512){gameHistory[gameHistoryCount++]=pos.hash;addHistoryKey(pos.hash);}else{for(i32 i=1;i<512;i++)gameHistory[i-1]=gameHistory[i];gameHistory[511]=pos.hash;rebuildRepetitionTable();}accReady=false;return true;}
void Engine::moveToUci(Move m,char out[6]){if(m.from>=64||m.to>=64){out[0]='0';out[1]='0';out[2]='0';out[3]='0';out[4]=0;return;}out[0]=(char)('a'+fileOf(m.from));out[1]=(char)('8'-rankOf(m.from));out[2]=(char)('a'+fileOf(m.to));out[3]=(char)('8'-rankOf(m.to));i32 n=4;if(m.promo){out[n++]=m.promo==2?'n':m.promo==3?'b':m.promo==4?'r':'q';}out[n]=0;}
}
