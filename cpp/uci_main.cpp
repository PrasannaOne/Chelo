#include "chelo_engine.hpp"
#include <iostream>
#include <fstream>
#include <cstring>
#include <cstdlib>
#include <string>
#include <sstream>
#include <vector>
#include <chrono>
#include <algorithm>
#include <cstdint>

extern "C" u64 chelo_host_now_ms(){
 return (u64)std::chrono::duration_cast<std::chrono::milliseconds>(
   std::chrono::steady_clock::now().time_since_epoch()).count();
}

using namespace chelo;
static Engine engine;
static constexpr const char* START_FEN="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
static u32 moveOverheadMs=30;

static bool loadFile(const char* path,u8* out,u32 expected){
 std::ifstream f(path,std::ios::binary);if(!f)return false;
 f.read((char*)out,expected);return (u32)f.gcount()==expected;
}
static u64 number(const std::string& s,u64 fallback=0){
 if(s.empty())return fallback;char* end=nullptr;
 unsigned long long v=std::strtoull(s.c_str(),&end,10);
 return end&&*end==0?(u64)v:fallback;
}
static std::vector<std::string> split(const std::string& line){
 std::istringstream in(line);std::vector<std::string> out;std::string token;
 while(in>>token)out.push_back(token);return out;
}
static bool setPosition(const std::vector<std::string>& t){
 if(t.size()<2)return false;size_t at=1;bool ok=false;
 if(t[at]=="startpos"){ok=engine.setFen(START_FEN);at++;}
 else if(t[at]=="fen"){
  at++;if(at+6>t.size())return false;
  std::string fen;for(int i=0;i<6;i++){if(i)fen+=' ';fen+=t[at++];}
  ok=engine.setFen(fen.c_str());
 }else return false;
 if(!ok)return false;
 if(at<t.size()&&t[at]=="moves"){
  at++;for(;at<t.size();at++)if(!engine.playUciMove(t[at].c_str()))return false;
 }
 return true;
}
static void doGo(const std::vector<std::string>& t){
 u64 wtime=0,btime=0,winc=0,binc=0,nodes=0,movetime=0,movestogo=0,depth=48;
 bool hasW=false,hasB=false,hasMoveTime=false,hasDepth=false,hasNodes=false;
 for(size_t i=1;i<t.size();i++){
  const std::string& k=t[i];if(i+1>=t.size())continue;u64 v=number(t[i+1]);
  if(k=="wtime"){wtime=v;hasW=true;i++;}
  else if(k=="btime"){btime=v;hasB=true;i++;}
  else if(k=="winc"){winc=v;i++;}
  else if(k=="binc"){binc=v;i++;}
  else if(k=="movetime"){movetime=v;hasMoveTime=true;i++;}
  else if(k=="movestogo"){movestogo=v;i++;}
  else if(k=="nodes"){nodes=v;hasNodes=true;i++;}
  else if(k=="depth"){depth=v;hasDepth=true;i++;}
 }
 if(depth<1)depth=1;if(depth>80)depth=80;
 u32 softMs=0,hardMs=0;
 if(hasMoveTime){
  u64 usable=movetime>moveOverheadMs?movetime-moveOverheadMs:movetime;
  if(usable<1)usable=1;
  hardMs=(u32)std::min<u64>(usable,0xffffffffu);
  softMs=(u32)std::max<u64>(1,usable*78/100);
 }else if(hasW||hasB){
  const bool white=engine.sideToMove()==0;
  u64 remain=white?(hasW?wtime:0):(hasB?btime:0);
  u64 inc=white?winc:binc;
  u64 usable=remain>moveOverheadMs?remain-moveOverheadMs:1;
  u64 moves=movestogo?std::min<u64>(movestogo,80):30;
  u64 base=remain/(moves+1)+(inc*3)/4;
  if(base<8)base=8;
  u64 soft=std::max<u64>(5,base*70/100);
  u64 hard=std::max<u64>(soft,base*180/100);
  softMs=(u32)std::min(soft,usable);
  hardMs=(u32)std::min(hard,usable);
  if(!hardMs)hardMs=1;if(!softMs)softMs=1;
 }
 if(!hasDepth&&!hasNodes&&!hardMs)depth=40;
 auto started=std::chrono::steady_clock::now();
 SearchResult r=engine.search((i32)depth,hardMs,hasNodes?nodes:0,softMs);
 auto elapsed=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-started).count();
 u64 total=r.nodes+r.qnodes;u64 nps=elapsed>0?total*1000/(u64)elapsed:total*1000;
 std::cout<<"info depth "<<r.depth<<" nodes "<<r.nodes<<" qnodes "<<r.qnodes<<" score cp "<<r.score<<" time "<<elapsed<<" nps "<<nps<<"\n";
 std::cout<<"info string totalNodes "<<total<<" ttHits "<<r.ttHits<<" ttCuts "<<r.ttCuts
          <<" betaCuts "<<r.betaCuts<<" lmr "<<r.lmrReductions<<" lmrResearch "<<r.lmrResearches<<" seeCalls "<<r.seeCalls<<"\n";
 char move[6];Engine::moveToUci(r.best,move);std::cout<<"bestmove "<<move<<"\n"<<std::flush;
}

int main(int argc,char**argv){
 u8 model[49368],kpk[24576];const char* modelPath="models/dual-nnue-v37.bin";
 if(argc>1&&std::strcmp(argv[1],"--verify")!=0)modelPath=argv[1];
 const bool modelLoaded=loadFile(modelPath,model,49368)&&engine.loadModel(model,49368);
 if(loadFile("models/kpk-wdl.bin",kpk,24576))engine.loadKpk(kpk,24576);
 if(argc>1&&std::strcmp(argv[1],"--verify")==0){
  bool a=engine.setFen(START_FEN);u64 p1=engine.perft(4);
  engine.setFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");u64 p2=engine.perft(3);
  bool attack=engine.verifyAttackParity(256),see=engine.verifySeeParity(192),special=engine.verifySpecialTransitions();
  bool acc=modelLoaded&&engine.verifyIncremental(64),hash=engine.verifyHash();
  std::cout<<"startpos_perft4="<<p1<<"\nkiwipete_perft3="<<p2
           <<"\nattack_parity="<<(attack?"PASS":"FAIL")<<"\nsee_parity="<<(see?"PASS":"FAIL")
           <<"\nspecial_transitions="<<(special?"PASS":"FAIL")<<"\nincremental_nnue="<<(acc?"PASS":"FAIL")
           <<"\nzobrist_roundtrip="<<(hash?"PASS":"FAIL")<<"\n";
  bool ok=a&&p1==197281&&p2==97862&&attack&&see&&special&&acc&&hash;
  std::cout<<(ok?"CHELO_ENGINE_VERIFY_OK":"CHELO_ENGINE_VERIFY_FAILED")<<"\n";return ok?0:2;
 }
 if(!modelLoaded)std::cerr<<"info string warning: V37 model not loaded; NNUE evaluation disabled\n";
 std::string line;
 while(std::getline(std::cin,line)){
  auto t=split(line);if(t.empty())continue;
  if(t[0]=="uci"){
   std::cout<<"id name Chelo V15 CPP M8\nid author Chelo Project\n"
            <<"option name Move Overhead type spin default 30 min 0 max 1000\n"
            <<"option name Bond_LoRA type string default\n"
            <<"option name Arena_LoRA type string default\n"
            <<"option name Clear Hash type button\nuciok\n";
  }else if(t[0]=="isready")std::cout<<"readyok\n";
  else if(t[0]=="ucinewgame")engine.newGame();
  else if(t[0]=="setoption"){
   size_t n=line.find("name "),v=line.find(" value ");
   if(n!=std::string::npos){std::string name=line.substr(n+5,(v==std::string::npos?line.size():v)-(n+5));
    if(name=="Clear Hash")engine.clearHash();
    else if(name=="Move Overhead"&&v!=std::string::npos){u64 x=number(line.substr(v+7),30);moveOverheadMs=(u32)std::min<u64>(x,1000);}
    else if((name=="Bond_LoRA"||name=="Arena_LoRA")&&v!=std::string::npos){
     const bool arena=name=="Arena_LoRA";u8 adapter[134];const u32 bytes=arena?134:69;
     const std::string file=line.substr(v+7);
     if(loadFile(file.c_str(),adapter,bytes))std::cout<<"info string adapter "<<(engine.setAdapter(arena?1:0,adapter,bytes)?"loaded":"rejected")<<"\n";
     else std::cout<<"info string adapter file unavailable\n";
    }
   }
  }else if(t[0]=="position"){
   if(!setPosition(t))std::cout<<"info string invalid position command\n";
  }else if(t[0]=="go")doGo(t);
  else if(t[0]=="perft"&&t.size()>1){int d=(int)number(t[1]);if(d<0||d>8)std::cout<<"info string perft depth must be 0..8\n";else std::cout<<"nodes "<<engine.perft(d)<<"\n";}
  else if(t[0]=="divide"&&t.size()>1){int d=(int)number(t[1]);if(d<1||d>7){std::cout<<"info string divide depth must be 1..7\n";continue;}i32 n=engine.rootMoveCount();u64 total=0;for(i32 i=0;i<n;i++){char mv[6];u64 count=engine.rootPerft(i,d,mv);std::cout<<mv<<": "<<count<<"\n";total+=count;}std::cout<<"nodes "<<total<<"\n";}
  else if(t[0]=="eval")std::cout<<"info string eval cp "<<engine.evaluate()<<"\n";
  else if(t[0]=="verifyincremental"){int n=t.size()>1?(int)number(t[1],64):64;std::cout<<"info string incremental "<<(engine.verifyIncremental(n)?"PASS":"FAIL")<<"\n";}
  else if(t[0]=="see"&&t.size()>1)std::cout<<"info string see "<<t[1]<<" "<<engine.staticExchange(t[1].c_str())<<"\n";
  else if(t[0]=="hashcheck")std::cout<<"info string zobrist "<<(engine.verifyHash()?"PASS":"FAIL")<<"\n";
  else if(t[0]=="hash")std::cout<<"info string hash "<<(unsigned long long)engine.currentHash()<<"\n";
  else if(t[0]=="drawcheck")std::cout<<"info string insufficient_material "<<(engine.drawByInsufficientMaterial()?1:0)<<"\n";
  else if(t[0]=="verifyattack"){int n=t.size()>1?(int)number(t[1],128):128;std::cout<<"info string attack parity "<<(engine.verifyAttackParity(n)?"PASS":"FAIL")<<"\n";}
  else if(t[0]=="verifysee"){int n=t.size()>1?(int)number(t[1],128):128;std::cout<<"info string see parity "<<(engine.verifySeeParity(n)?"PASS":"FAIL")<<"\n";}
  else if(t[0]=="verifyspecial")std::cout<<"info string special transitions "<<(engine.verifySpecialTransitions()?"PASS":"FAIL")<<"\n";
  else if(t[0]=="quit")break;
  std::cout<<std::flush;
 }
 return 0;
}
