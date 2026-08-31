import type { WebGLRenderer } from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { RUNTIME_ASSETS } from '../../../runtimeAssets.ts'

const loaderByRenderer = new WeakMap<WebGLRenderer, KTX2Loader>()

function ktx2LoaderFor(renderer: WebGLRenderer): KTX2Loader {
  const existing = loaderByRenderer.get(renderer)
  if (existing) return existing

  const loader = new KTX2Loader()
    .setTranscoderPath(RUNTIME_ASSETS.basisTranscoderPath)
    .setWorkerLimit(2)
    .detectSupport(renderer)
  loaderByRenderer.set(renderer, loader)
  return loader
}

/** Configure Drei's GLTFLoader for same-origin or release-origin KTX2 textures. */
export function configureReplayAssetLoader(
  renderer: WebGLRenderer,
): (loader: unknown) => void {
  const ktx2Loader = ktx2LoaderFor(renderer)
  return (loader) => {
    ;(
      loader as {
        setKTX2Loader(value: KTX2Loader): unknown
      }
    ).setKTX2Loader(ktx2Loader)
  }
}
