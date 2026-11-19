/* Keep chess search off the interface thread on phones and slower devices. */
importScripts('./chess.js', './brain.js');

self.addEventListener('message', event => {
  const { id, fen, brainData, timeMs, nodeLimit } = event.data || {};
  try {
    const chess = new self.ChessCore(fen);
    const brain = new self.ChesslingBrain('chessling_worker', {
      data: brainData,
      persist: false
    });
    const result = brain.chooseMove(chess, { timeMs, nodeLimit });
    self.postMessage({ id, ok:true, ...result });
  } catch (error) {
    self.postMessage({ id, ok:false, error:error?.message || 'Chessling could not finish its search.' });
  }
});
