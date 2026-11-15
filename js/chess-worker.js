// ♟️ Rechnet Engine-Züge im Hintergrund (Web Worker), damit das Brett nicht ruckelt. Engine: ./chess-engine.js
import { search } from "./chess-engine.js";
self.onmessage = (e) => {
  const { id, fen, opts } = e.data || {};
  try { self.postMessage({ id, ...search(fen, opts || {}) }); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
