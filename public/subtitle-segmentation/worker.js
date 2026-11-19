// This worker and its model run only in an extension-owned document.
importScripts('sherpa-onnx-wasm-web.js');
var module = {};
importScripts('sherpa-onnx-punctuation.js');

// Long streams can suppress a sentence boundary which the same model hears
// with local text context. Revisit only exceptionally long predictions, using
// the already loaded model. A window edge is never promoted to a boundary.
function punctuate(predictor, text) {
  const prediction = predictor.addPunct(text);
  const source = text.trim().split(/\s+/u);
  const words = prediction.trim().split(/\s+/u);
  if (source.length !== words.length) return prediction;
  const bare = word => word.toLowerCase().replace(/[.,!?;:]+$/u, '');
  let start = 0;
  for (let end = 1; end <= words.length; end++) {
    if (end < words.length && !/[.!?]$/u.test(words[end - 1])) continue;
    if (end - start > 42 && end - start < source.length) {
      const local = predictor.addPunct(source.slice(start, end).join(' ')).trim().split(/\s+/u);
      if (local.length === end - start && local.every((word, i) => bare(word) === bare(source[start + i]))) {
        for (let i = 3; i + 4 < local.length; i++) {
          if (!/[.!?]$/u.test(local[i - 1])) continue;
          const rest = local.slice(i).join(' ');
          // Require a fresh assertion, or a restarted conditional with its own
          // consequent. Preserve dependent objects, asides and negative scope.
          const assertion = /^(?:and|but|yet)\s+(?:i|we|you|he|she|they|it)\b/i.test(rest);
          const conditional = /^[A-Z]/.test(words[start+i]) &&
            /^(?:when|if)\b[^.!?]*,\s*(?:i|we|you|he|she|they|it)\b/i.test(rest);
          if (assertion || conditional) words[start+i-1] = local[i-1];
        }
      }
    }
    start = end;
  }
  return words.join(' ');
}

self.onmessage = async ({ data: passages }) => {
  try {
    const [wasmBinary, model, vocabulary] = await Promise.all(
      ['sherpa-onnx-wasm-web.wasm', 'model.int8.onnx', 'bpe.vocab'].map(async name => {
        const response = await fetch(name);
        if (!response.ok) throw Error('Missing subtitle model asset: ' + name);
        return new Uint8Array(await response.arrayBuffer());
      }),
    );
    const runtime = await SherpaOnnx({ wasmBinary });
    runtime.FS.writeFile('/model', model);
    runtime.FS.writeFile('/vocabulary', vocabulary);
    const predictor = new module.exports.OnlinePunctuation({
      model: { cnnBiLstm: '/model', bpeVocab: '/vocabulary', numThreads: 1 },
    }, runtime);
    if (!predictor.handle) throw Error('Subtitle model could not initialize');
    try {
      const results = passages.map(text => punctuate(predictor, text));
      self.postMessage({ results });
    } finally {
      predictor.free();
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
