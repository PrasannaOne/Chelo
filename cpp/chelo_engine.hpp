#pragma once
// Chelo V15 C++20 engine core. Fixed-size storage; no STL containers or runtime allocation in core.
#if defined(__wasm32__) || defined(__EMSCRIPTEN__)
using u8=__UINT8_TYPE__; using i8=__INT8_TYPE__; using u16=__UINT16_TYPE__; using i16=__INT16_TYPE__; using u32=__UINT32_TYPE__; using i32=__INT32_TYPE__; using u64=__UINT64_TYPE__; using i64=__INT64_TYPE__;
#else
#include <cstdint>
using u8=std::uint8_t; using i8=std::int8_t; using u16=std::uint16_t; using i16=std::int16_t; using u32=std::uint32_t; using i32=std::int32_t; using u64=std::uint64_t; using i64=std::int64_t;
#endif
namespace chelo {
struct Move { u8 from,to,promo,flags; };
struct SearchResult {
  Move best;
  i32 score;
  i32 depth;
  u64 nodes;
  u64 qnodes;
  u64 ttProbes,ttHits,ttCuts;
  u64 betaCuts,firstMoveCuts;
  u64 lmrReductions,lmrResearches,seeCalls;
};
class Engine {
public:
  Engine();
  bool setFen(const char* fen);
  bool loadModel(const u8* data,u32 bytes);
  bool loadKpk(const u8* data,u32 bytes);
  bool setAdapter(u32 which,const u8* data,u32 bytes); // 0 Bond rank-1, 1 Arena rank-2
  i32 evaluate();
  bool drawByInsufficientMaterial() const { return insufficientMaterial(); }
  u64 perft(i32 depth);
  i32 rootMoveCount();
  u64 rootPerft(i32 index,i32 depth,char out[6]);
  SearchResult search(i32 depth,u32 timeMs=0,u64 fixedNodes=0,u32 softTimeMs=0);
  void clearHash();
  void newGame();
  bool parseUciMove(const char* text,Move& out);
  bool playUciMove(const char* text);
  bool verifyIncremental(i32 plies);
  bool verifySpecialTransitions();
  i32 verifySpecialTransition(i32 index);
  bool verifyHash() const;
  i32 staticExchange(const char* uci);
  bool verifySeeParity(i32 plies);
  bool verifyAttackParity(i32 plies);
  u64 currentHash() const;
  const u8* debugBoard() const { return pos.board; }
  i32 sideToMove() const { return pos.side; }
  static void moveToUci(Move m,char out[6]);
  const char* fen() const { return fenBuffer; }
private:
  struct Position { u8 board[64]; u64 bb[12],occ[2],all,hash; i8 kingSq[2],side,ep; u8 rights; u16 half,full; };
  struct Undo { u8 captured,rights,moved; i8 ep; u16 half,full; u64 hash; };
  struct TTEntry { u64 key; Move move; i16 score,half; i8 depth; u8 flag,age; };
  static constexpr i32 MAX_PLY=128, MAX_MOVES=256, TT_BITS=16, TT_BUCKETS=1<<TT_BITS, TT_WAYS=4, TT_SIZE=TT_BUCKETS*TT_WAYS;
  static constexpr i32 MATE_SCORE=29000, MATE_THRESHOLD=28000;
  Position pos;
  TTEntry tt[TT_SIZE]; u8 age; u64 nodes,qnodes,ttProbes,ttHits,ttCuts,betaCuts,firstMoveCuts,lmrReductions,lmrResearches,seeCalls,nodeLimit; u32 stopMs; i32 rootDepth; u64 startTick; bool aborted; Move rootIterationBest;
  Move killers[MAX_PLY][2],counterMove[16][64]; i32 prevClass[MAX_PLY],prevTo[MAX_PLY],prev2Class[MAX_PLY],prev2To[MAX_PLY],evalStack[MAX_PLY]; u64 pathHash[MAX_PLY]; u8 pathValid[MAX_PLY];
  i16 history[2][64][64],contHistory[16][64][16][64],contHistory2[16][64][16][64];
  u64 gameHistory[512]; u16 gameHistoryCount;
  u64 repetitionKeys[1024]; u16 repetitionCounts[1024]; u8 repetitionUsed[1024];
  i16 accW[MAX_PLY+1][256],accB[MAX_PLY+1][256]; bool accReady;
  u8 model[394776]; bool modelReady; u8 kpk[24576]; bool kpkReady;
  i8 adapterAW[2][512],adapterAB[2][512],adapterB[2][2]; u8 adapterRank[2],adapterShift[2];
  char fenBuffer[128];
  static u64 bit(i32 s){return 1ull<<s;} static i32 poplsb(u64& b); static i32 pieceColor(i32 p); static i32 pieceType(i32 p);
  void rebuild(); void setSquare(i32 sq,i32 piece); bool attacked(i32 sq,i32 by) const; bool attackedReference(i32 sq,i32 by) const; bool inCheck(i32 side) const;
  bool make(Move m,Undo& u,i32 ply=-1,bool updateHash=false,bool updateAcc=false); void unmake(Move m,const Undo& u);
  i32 generate(Move* out,bool capturesOnly=false); i32 legal(Move* out,bool capturesOnly=false);
  u64 perftRec(i32 d); i32 searchNode(i32 d,i32 alpha,i32 beta,i32 ply,bool allowNull,bool allowRepetition); i32 qsearch(i32 alpha,i32 beta,i32 ply,i32 qd,bool allowRepetition);
  void resetSearchHeuristics(); i32 evalRaw(i32 ply=0); i32 nnueEval(i32 ply); i32 nnueEvalRecompute() const; void rebuildAccumulator(i32 frame); void updateAccumulator(i32 ply,Move m,const Undo& u);
  i32 mopUp() const; i32 bareKing() const; i32 kpkProbe() const; i32 moveScore(Move m,Move ttMove,i32 ply); void order(Move* m,i32 n,Move ttMove,i32 ply); void updateHistory(Move m,i32 ply,i32 depth,Move* tried,i32 triedN);
  u64 hash() const; u64 computeHash() const; i32 effectiveEpFile() const; bool insufficientMaterial() const; i32 repetitionMatches(i32 ply) const; i32 historyKeyCount(u64 key) const; void addHistoryKey(u64 key); void rebuildRepetitionTable(); i32 see(Move m) const; i32 seeReference(Move m) const; bool same(Move a,Move b) const;
  static i32 scoreToTT(i32 score,i32 ply); static i32 scoreFromTT(i32 score,i32 ply);
};
}
