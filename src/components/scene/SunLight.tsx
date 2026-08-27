import {
  forwardRef,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import * as THREE from 'three'
import {
  SHADOW_BIAS,
  SHADOW_EXTENT,
  SHADOW_MAP_SIZE,
  SHADOW_NORMAL_BIAS,
  SUN_COLOR,
  SUN_DIRECTION,
  SUN_DISTANCE,
  SUN_INTENSITY,
} from './sceneConfig'

/** Directional light rig whose group follows the car each render frame. */
export const SunLight = forwardRef<THREE.Group>(function SunLight(_, ref) {
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const position = useMemo(
    () =>
      new THREE.Vector3(...SUN_DIRECTION)
        .normalize()
        .multiplyScalar(SUN_DISTANCE),
    [],
  )

  useLayoutEffect(() => {
    const light = lightRef.current
    if (!light) return
    light.target = target

    const camera = light.shadow.camera
    camera.left = -SHADOW_EXTENT
    camera.right = SHADOW_EXTENT
    camera.top = SHADOW_EXTENT
    camera.bottom = -SHADOW_EXTENT
    camera.near = SUN_DISTANCE - SHADOW_EXTENT * 2
    camera.far = SUN_DISTANCE + SHADOW_EXTENT * 2
    camera.updateProjectionMatrix()
    light.shadow.needsUpdate = true
  }, [target])

  return (
    <group ref={ref}>
      <primitive object={target} />
      <directionalLight
        ref={lightRef}
        castShadow
        position={position}
        color={SUN_COLOR}
        intensity={SUN_INTENSITY}
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
      />
    </group>
  )
})
