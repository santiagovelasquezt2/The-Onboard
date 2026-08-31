import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import * as THREE from 'three'
import styles from './WebGLFallback.module.css'

type RendererOptions = Omit<THREE.WebGLRendererParameters, 'canvas'>

type ReliableCanvasProps = Omit<CanvasProps, 'fallback' | 'gl'> & {
  fallback: ReactNode
  onUnavailable?: (error: Error) => void
  rendererOptions?: RendererOptions
}

function webGLError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('The browser could not create a WebGL context.')
}

/**
 * Adds a DOM fallback around React Three Fiber's native canvas fallback.
 * The custom renderer seam also catches context-construction failures, which
 * otherwise reject from Canvas's async configure step without useful UI.
 */
export function ReliableCanvas({
  fallback,
  onUnavailable,
  rendererOptions,
  className,
  style,
  ...canvasProps
}: ReliableCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const failureRef = useRef<Error | null>(null)
  const [failure, setFailure] = useState<Error | null>(null)
  const reportUnavailable = useCallback(
    (cause: unknown) => {
      if (failureRef.current) return
      const error = webGLError(cause)
      failureRef.current = error
      console.error('[webgl] renderer unavailable', error)
      setFailure(error)
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
        // Canvas awaits renderer factories. Keep this configure attempt inert
        // while React swaps the failed canvas for the static DOM fallback.
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

  if (failure) {
    const fallbackClassName = [styles.fallbackHost, className]
      .filter(Boolean)
      .join(' ')
    return (
      <div className={fallbackClassName} style={style}>
        {fallback}
      </div>
    )
  }

  return (
    <Canvas
      {...canvasProps}
      ref={canvasRef}
      className={className}
      style={style}
      gl={createRenderer}
      fallback="Animated 3D scene for TheOnboard."
    />
  )
}

type WebGLFallbackProps = {
  surface: 'hero' | 'replay'
}

export function WebGLFallback({ surface }: WebGLFallbackProps) {
  const titleId = useId()
  const replaySurface = surface === 'replay'

  return (
    <section
      className={styles.fallback}
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
    >
      <div className={styles.card}>
        <p className={styles.eyebrow}>WebGL unavailable</p>
        <h2 className={styles.title} id={titleId}>
          {replaySurface
            ? '3D replay unavailable'
            : '3D landing preview unavailable'}
        </h2>
        <p className={styles.message}>
          {replaySurface
            ? 'The onboard video and telemetry can still be used. Enable hardware acceleration or use a WebGL-compatible browser to restore the track view.'
            : 'This browser could not start the 3D preview. You can continue directly to the replay.'}
        </p>
        <nav className={styles.actions} aria-label="WebGL fallback navigation">
          <a
            className={styles.primaryAction}
            href={replaySurface ? '/' : '/replay'}
          >
            {replaySurface ? 'Home' : 'Open replay'}
          </a>
        </nav>
      </div>
    </section>
  )
}
