/* Chelo Stage 3.7 dual-perspective NNUE binary parser. */
(() => {
  'use strict';
  const root = typeof self !== 'undefined' ? self : globalThis;
  const MAGIC = 'C36N', VERSION = 1, FEATURES = 768, HIDDEN = 32, HEADER_BYTES = 20;
  const WEIGHT_BYTES = FEATURES * HIDDEN;
  const EXPECTED_BYTES = HEADER_BYTES + WEIGHT_BYTES * 2 + HIDDEN * 2 * 2 + HIDDEN * 2 + 4;
  function parse(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== EXPECTED_BYTES) throw new Error(`Chelo Stage 3.7 NNUE binary size mismatch (${buffer?.byteLength || 0}).`);
    const view = new DataView(buffer);
    let magic = ''; for (let i = 0; i < 4; i++) magic += String.fromCharCode(view.getUint8(i));
    const version = view.getUint16(4, true), features = view.getUint16(6, true), hidden = view.getUint16(8, true), flags = view.getUint16(10, true), outputDivisor = view.getUint32(12, true), reserved = view.getUint32(16, true);
    if (magic !== MAGIC || version !== VERSION || features !== FEATURES || hidden !== HIDDEN || flags !== 1 || !outputDivisor || reserved !== 0) throw new Error('Chelo Stage 3.7 NNUE header/architecture mismatch.');
    let at = HEADER_BYTES;
    const whiteW = new Int8Array(buffer, at, WEIGHT_BYTES); at += WEIGHT_BYTES;
    const blackW = new Int8Array(buffer, at, WEIGHT_BYTES); at += WEIGHT_BYTES;
    const whiteB = new Int16Array(buffer, at, HIDDEN); at += HIDDEN * 2;
    const blackB = new Int16Array(buffer, at, HIDDEN); at += HIDDEN * 2;
    const outputW = new Int8Array(buffer, at, HIDDEN * 2); at += HIDDEN * 2;
    const outputB = view.getInt32(at, true);
    return { version, features, hidden, flags, outputDivisor, whiteW, blackW, whiteB, blackB, outputW, outputB, byteLength: buffer.byteLength };
  }
  root.CheloDualNNUE = { parse, model: null, constants: { MAGIC, VERSION, FEATURES, HIDDEN, HEADER_BYTES, EXPECTED_BYTES } };
  root.ChesslingDualNNUE = root.CheloDualNNUE; // Backward-compatible parser alias.
})();
