import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sky as ThreeSky } from 'three/examples/jsm/objects/Sky.js'
import type * as THREE from 'three'
import {
  SKY_CLOUD_COVERAGE,
  SKY_CLOUD_DENSITY,
  SKY_CLOUD_ELEVATION,
  SKY_CLOUD_SCALE,
  SKY_CLOUD_SPEED,
  SKY_DISTANCE,
  SKY_MIE_COEFFICIENT,
  SKY_MIE_DIRECTIONAL_G,
  SKY_RAYLEIGH,
  SKY_TURBIDITY,
  SUN_DIRECTION,
} from './sceneConfig'

type SkyUniforms = {
  turbidity: THREE.IUniform<number>
  rayleigh: THREE.IUniform<number>
  mieCoefficient: THREE.IUniform<number>
  mieDirectionalG: THREE.IUniform<number>
  sunPosition: THREE.IUniform<THREE.Vector3>
  cloudScale: THREE.IUniform<number>
  cloudSpeed: THREE.IUniform<number>
  cloudCoverage: THREE.IUniform<number>
  cloudDensity: THREE.IUniform<number>
  cloudElevation: THREE.IUniform<number>
  time: THREE.IUniform<number>
}

/**
 * Shape Three's cloud field into broken, sunlit cumulus instead of a uniform
 * grey noise wash. This stays texture-free and cuts the stock shader from ten
 * full noise octaves per pixel to four octaves plus three detail samples.
 */
function replaceShaderSection(
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  if (start < 0 || end < 0) return source
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`
}

function tuneCloudShader(fragmentShader: string): string {
  let tunedShader = fragmentShader
    .replace(
      'for ( int i = 0; i < 5; i ++ )',
      'for ( int i = 0; i < 4; i ++ )',
    )
    .replace(
      `vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );`,
      `vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

            // Keep the physical sun/haze, but anchor daylight to an unmistakable
            // blue gradient before clouds are composited over it.
            float skyHeight = pow(
                smoothstep( -0.02, 0.82, direction.y ),
                0.62
            );
            vec3 clearHorizon = vec3( 0.18, 0.48, 0.95 );
            vec3 clearZenith = vec3( 0.035, 0.16, 0.78 );
            vec3 clearSky = mix( clearHorizon, clearZenith, skyHeight );
            float sunHaze = pow(
                max( dot( direction, vSunDirection ), 0.0 ),
                10.0
            );
            clearSky = mix(
                clearSky,
                vec3( 1.05, 0.78, 0.52 ),
                sunHaze * 0.1
            );
            texColor = mix( texColor, clearSky, 0.84 );`,
    )
    .replace(
      `float cloudMask = smoothstep( 1.0 - cloudCoverage, 1.0 - cloudCoverage + 0.3, cloudNoise );`,
      `float cloudMask = smoothstep( 1.0 - cloudCoverage, 1.0 - cloudCoverage + 0.09, cloudNoise );`,
    )

  tunedShader = replaceShaderSection(
    tunedShader,
    '// Project to cloud plane',
    '// Multi-octave noise for fluffy clouds',
    `// A bounded dome projection keeps cumulus puffy at T-cam horizon angles.
                float elevation = mix( 0.48, 0.24, cloudElevation );
                vec2 cloudUV = direction.xz / ( direction.y + elevation );
                cloudUV *= cloudScale;
                cloudUV += time * cloudSpeed;`,
  )

  tunedShader = replaceShaderSection(
    tunedShader,
    '// Multi-octave noise for fluffy clouds',
    '// Apply coverage threshold',
    `// Domain-warped low-frequency billows with one fine detail sample.
                vec2 cloudDomain = cloudUV * 4200.0 + vec2( 2.7, -1.9 );
                vec2 cloudWarp = vec2(
                    noise( cloudDomain * 0.34 + 11.3 ),
                    noise( cloudDomain * 0.34 - 7.1 )
                ) - 0.5;
                float cloudBase = fbm( cloudDomain + cloudWarp * 1.35 );
                float cloudDetail = noise( cloudDomain * 3.2 + 3.7 );
                float cloudNoise = cloudBase * 0.70 + cloudDetail * 0.30;`,
  )

  tunedShader = replaceShaderSection(
    tunedShader,
    '// Base cloud color affected by atmosphere',
    '// Blend clouds with sky',
    `// Cool, dense bases and warm sunlit edges give the layer depth.
                float cloudInterior = smoothstep( 0.05, 0.72, cloudMask );
                float edgeLight = 1.0 - cloudInterior;
                float structureLight = noise( cloudDomain * 1.45 + vSunDirection.xz * 2.0 );
                vec3 cloudShadow = vec3( 0.30, 0.40, 0.54 );
                vec3 cloudLight = vec3( 1.30, 1.22, 1.08 );
                float lightMix = clamp(
                    0.14 + sunInfluence * 0.20 + daylight * 0.08
                    + edgeLight * 0.36 + structureLight * 0.26,
                    0.0,
                    1.0
                );
                vec3 cloudColor = mix( cloudShadow, cloudLight, lightMix );`,
  )

  return tunedShader
}

/** Camera-centred daylight sky for the full 7 km Montreal model. */
export function Atmosphere() {
  const sky = useMemo(() => {
    const nextSky = new ThreeSky()
    nextSky.scale.setScalar(SKY_DISTANCE)
    nextSky.frustumCulled = false
    nextSky.renderOrder = -1000

    const material = nextSky.material
    const uniforms = material.uniforms as unknown as SkyUniforms
    uniforms.turbidity.value = SKY_TURBIDITY
    uniforms.rayleigh.value = SKY_RAYLEIGH
    uniforms.mieCoefficient.value = SKY_MIE_COEFFICIENT
    uniforms.mieDirectionalG.value = SKY_MIE_DIRECTIONAL_G
    uniforms.sunPosition.value.set(...SUN_DIRECTION)
    uniforms.cloudScale.value = SKY_CLOUD_SCALE
    uniforms.cloudSpeed.value = SKY_CLOUD_SPEED
    uniforms.cloudCoverage.value = SKY_CLOUD_COVERAGE
    uniforms.cloudDensity.value = SKY_CLOUD_DENSITY
    uniforms.cloudElevation.value = SKY_CLOUD_ELEVATION
    material.fragmentShader = tuneCloudShader(material.fragmentShader)
    material.needsUpdate = true

    return nextSky
  }, [])

  useFrame(({ camera, clock }) => {
    sky.position.copy(camera.position)
    const uniforms = sky.material.uniforms as unknown as SkyUniforms
    // Three.js uniforms are intentionally mutable render-loop state.
    // oxlint-disable-next-line react/immutability
    uniforms.time.value = clock.elapsedTime
  })

  return <primitive object={sky} />
}
