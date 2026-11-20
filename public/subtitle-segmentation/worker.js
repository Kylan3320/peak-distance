// This worker and its model run only in an extension-owned document.
importScripts('sherpa-onnx-wasm-web.js');
var module = {};
importScripts('sherpa-onnx-punctuation.js');

// Several hundred unpunctuated words in one call make this model insert
// periods even between a subject and its verb. Give each emitted span context
// on both sides; a window boundary by itself never supplies punctuation.
function predictWithContext(predictor, source) {
  const span = 32;
  const context = 24;
  if (source.length <= span + 2 * context) return predictor.addPunct(source.join(' '));
  const output = [];
  const bare = word => word.toLowerCase().replace(/[.,!?;:]+$/u, '');
  for (let from = 0; from < source.length; from += span) {
    const to = Math.min(from + span, source.length);
    const left = Math.max(0, from - context);
    const right = Math.min(source.length, to + context);
    const prediction = predictor.addPunct(source.slice(left, right).join(' ')).trim().split(/\s+/u);
    if (prediction.length !== right - left ||
        !prediction.every((word, i) => bare(word) === bare(source[left + i]))) return '';
    output.push(...prediction.slice(from - left, to - left));
  }
  return output.join(' ');
}

// Long streams can suppress a sentence boundary which the same model hears
// with local text context. Revisit only exceptionally long predictions, using
// the already loaded model. A window edge is never promoted to a boundary.
function punctuate(predictor, text) {
  const source = text.trim().split(/\s+/u);
  const prediction = predictWithContext(predictor, source);
  const words = prediction.trim().split(/\s+/u);
  if (source.length !== words.length) return prediction;
  const bare = word => word.toLowerCase().replace(/[.,!?;:]+$/u, '');
  let start = 0;
  for (let end = 1; end <= words.length; end++) {
    if (end < words.length && !/[.!?]$/u.test(words[end - 1])) continue;
    if (end - start > 42 && end - start < source.length) {
      const local = predictWithContext(predictor, source.slice(start, end)).trim().split(/\s+/u);
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
