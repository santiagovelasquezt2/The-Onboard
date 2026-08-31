import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import * as THREE from 'three'

type RendererOptions = Omit<THREE.WebGLRendererParameters, 'canvas'>

type ReliableCanvasProps = Omit<CanvasProps, 'fallback' | 'gl'> & {
  onUnavailable?: (error: Error) => void
  rendererOptions?: RendererOptions
}

function webGLError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('The browser could not create a WebGL context.')
}

/** Keeps WebGL failures inside the canvas slot without replacing the app UI. */
export function ReliableCanvas({
  onUnavailable,
  rendererOptions,
  className,
  style,
  ...canvasProps
}: ReliableCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const failureRef = useRef<Error | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const reportUnavailable = useCallback(
    (cause: unknown) => {
      if (failureRef.current) return
      const error = webGLError(cause)
      failureRef.current = error
      console.error('[webgl] renderer unavailable', error)
      setUnavailable(true)
      onUnavailable?.(error)
    },
    [onUnavailable],
  )
  const createRenderer = useCallback(
    (defaults: THREE.WebGLRendererParameters) => {
      try {
        return Promise.resolve(
          new THREE.WebGLRenderer({
            ...defaults,
            ...rendererOptions,
          }),
        )
      } catch (error: unknown) {
        reportUnavailable(error)
        return new Promise<THREE.WebGLRenderer>(() => undefined)
      }
    },
    [rendererOptions, reportUnavailable],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleContextLost = () => {
      reportUnavailable(new Error('The browser lost its WebGL context.'))
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost)
    }
  }, [reportUnavailable])

  if (unavailable) {
    return <div aria-hidden="true" className={className} style={style} />
  }

  return (
    <Canvas
      {...canvasProps}
      ref={canvasRef}
      className={className}
      style={style}
      gl={createRenderer}
      fallback={null}
    />
  )
}
