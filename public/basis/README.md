# Basis Universal transcoder

`basis_transcoder.js` and `basis_transcoder.wasm` are copied from the installed
Three.js package (`three/examples/jsm/libs/basis/`). They allow `KTX2Loader` to
transcode the runtime GLBs' UASTC textures into the GPU-native format supported
by the current browser.

The transcoder comes from the [Basis Universal](https://github.com/BinomialLLC/basis_universal)
project and is licensed under the [Apache License 2.0](LICENSE). Three.js is
MIT licensed; keep these vendored files in sync with its installed version when
upgrading the renderer.
