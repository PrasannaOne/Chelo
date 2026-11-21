#include "chelo_engine.hpp"
using namespace chelo;
extern "C" u64 chelo_host_now_ms();
static Engine engine;
static u8 modelBuffer[394776];
static u8 kpkBuffer[24576];
static char fenBuffer[128];
static u8 bondBuffer[517],arenaBuffer[1030];
static SearchResult result;
static char moveText[6];
extern "C" {
__attribute__((visibility("default"))) u32 chelo_abi_version(){return 1;}
__attribute__((visibility("default"))) u8* chelo_model_buffer(){return modelBuffer;}
__attribute__((visibility("default"))) u8* chelo_kpk_buffer(){return kpkBuffer;}
__attribute__((visibility("default"))) char* chelo_fen_buffer(){return fenBuffer;}
__attribute__((visibility("default"))) u32 chelo_model_buffer_size(){return 394776;}
__attribute__((visibility("default"))) u8* chelo_adapter_buffer(u32 which){return which?arenaBuffer:bondBuffer;}
__attribute__((visibility("default"))) u32 chelo_adapter_buffer_size(u32 which){return which?1030:517;}
__attribute__((visibility("default"))) i32 chelo_load_model(){return engine.loadModel(modelBuffer,394776)?1:0;}
__attribute__((visibility("default"))) i32 chelo_load_kpk(){return engine.loadKpk(kpkBuffer,24576)?1:0;}
__attribute__((visibility("default"))) i32 chelo_load_adapter(u32 which,u32 bytes){return engine.setAdapter(which,which?arenaBuffer:bondBuffer,bytes)?1:0;}
__attribute__((visibility("default"))) i32 chelo_set_fen(const char* fen){return engine.setFen(fen)?1:0;}
__attribute__((visibility("default"))) u64 chelo_perft(i32 depth){return engine.perft(depth);}
__attribute__((visibility("default"))) i32 chelo_evaluate(){return engine.evaluate();}
__attribute__((visibility("default"))) SearchResult* chelo_search(i32 depth,u32 timeMs){result=engine.search(depth,timeMs);Engine::moveToUci(result.best,moveText);return &result;}
__attribute__((visibility("default"))) SearchResult* chelo_search_nodes(i32 depth,u64 nodeLimit){result=engine.search(depth,0,nodeLimit);Engine::moveToUci(result.best,moveText);return &result;}
__attribute__((visibility("default"))) SearchResult* chelo_search_limited(i32 depth,u32 timeMs,u64 nodeLimit){result=engine.search(depth,timeMs,nodeLimit);Engine::moveToUci(result.best,moveText);return &result;}
__attribute__((visibility("default"))) SearchResult* chelo_search_managed(i32 depth,u32 softMs,u32 hardMs,u64 nodeLimit){result=engine.search(depth,hardMs,nodeLimit,softMs);Engine::moveToUci(result.best,moveText);return &result;}
__attribute__((visibility("default"))) const char* chelo_bestmove_text(){return moveText;}
__attribute__((visibility("default"))) void chelo_clear_hash(){engine.clearHash();}
__attribute__((visibility("default"))) void chelo_new_game(){engine.newGame();}
__attribute__((visibility("default"))) i32 chelo_verify_incremental(i32 plies){return engine.verifyIncremental(plies)?1:0;}
__attribute__((visibility("default"))) i32 chelo_verify_hash(){return engine.verifyHash()?1:0;}
__attribute__((visibility("default"))) i32 chelo_verify_see(i32 plies){return engine.verifySeeParity(plies)?1:0;}
__attribute__((visibility("default"))) i32 chelo_verify_attack(i32 plies){return engine.verifyAttackParity(plies)?1:0;}
__attribute__((visibility("default"))) i32 chelo_verify_special_transitions(){return engine.verifySpecialTransitions()?1:0;}
}
#if defined(__wasm32__)
extern "C" void* memset(void* dst,int value,__SIZE_TYPE__ count){u8* p=(u8*)dst;for(__SIZE_TYPE__ i=0;i<count;i++)p[i]=(u8)value;return dst;}
extern "C" void* memcpy(void* dst,const void* src,__SIZE_TYPE__ count){u8* d=(u8*)dst;const u8* s=(const u8*)src;for(__SIZE_TYPE__ i=0;i<count;i++)d[i]=s[i];return dst;}
extern "C" void* memmove(void* dst,const void* src,__SIZE_TYPE__ count){u8* d=(u8*)dst;const u8* s=(const u8*)src;if(d<s){for(__SIZE_TYPE__ i=0;i<count;i++)d[i]=s[i];}else if(d>s){for(__SIZE_TYPE__ i=count;i>0;i--)d[i-1]=s[i-1];}return dst;}
#endif
