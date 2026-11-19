// This worker and its model run only in an extension-owned document.
importScripts('sherpa-onnx-wasm-web.js');
var module = {};
importScripts('sherpa-onnx-punctuation.js');

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
      const results = passages.map(text => predictor.addPunct(text));
      self.postMessage({ results });
    } finally {
      predictor.free();
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
