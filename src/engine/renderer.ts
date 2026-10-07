import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import type { Quality } from './save'

type Preset = {
  pixelRatio: number
  shadows: boolean
  shadowMap: number
  bloom: boolean
  /** Bloom render-target scale relative to the canvas. */
  bloomScale: number
  post: boolean
  antialias: boolean
  /** Hint for gameplay systems (particle budgets, star counts). */
  detail: number
}

export const QUALITY_PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, bloom: false, bloomScale: 0.5, post: false, antialias: false, detail: 0.5 },
  medium: { pixelRatio: 1.25, shadows: false, shadowMap: 1024, bloom: true, bloomScale: 0.5, post: true, antialias: false, detail: 0.8 },
  high: { pixelRatio: 2, shadows: false, shadowMap: 2048, bloom: true, bloomScale: 1, post: true, antialias: true, detail: 1 },
}

/** Pick a starting quality from device hints; the player can override it in Settings. */
export function suggestQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  if (coarse) return 'medium'
  if (cores <= 4) return 'medium'
  return 'high'
}

/** Screen-space finishing pass: chromatic aberration, radial speed blur and vignette. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0 },
    uZoom: { value: 0 },
    uVignette: { value: 0.35 },
    uTint: { value: new THREE.Color(0, 0, 0) },
    uTintAmount: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberration, uZoom, uVignette, uTintAmount, uTime;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec3 col;
      if (uZoom > 0.001) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 6; i++) {
          float k = float(i) / 5.0;
          float w = 1.0 - k * 0.7;
          acc += texture2D(tDiffuse, 0.5 + c * (1.0 - uZoom * k * r * 0.9)).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      if (uAberration > 0.0005) {
        vec2 off = c * uAberration * (0.4 + r);
        col.r = mix(col.r, texture2D(tDiffuse, vUv + off).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - off).b, 0.85);
      }
      float v = smoothstep(0.85, 0.25, r * (1.0 + uVignette * 0.6));
      col *= mix(1.0 - uVignette, 1.0, v);
      col = mix(col, uTint, uTintAmount * smoothstep(0.2, 0.75, r));
      gl_FragColor = vec4(col, 1.0);
    }`,
}

/**
 * Owns the WebGL renderer, the post-processing chain and resize handling.
 * Scenes call `render(scene, camera)`; they never touch the composer directly. Gameplay may set
 * the `post` values (aberration pulses, speed blur, edge tint) every frame; they are ignored on
 * tiers without post-processing.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  readonly post = { aberration: 0, zoom: 0, vignette: 0.35, tint: new THREE.Color(0, 0, 0), tintAmount: 0 }
  bloomStrength = 0.9
  private composer?: EffectComposer
  private bloom?: UnrealBloomPass
  private finish?: ShaderPass
  private preset: Preset
  private scene?: THREE.Scene
  private camera?: THREE.PerspectiveCamera

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.preset = QUALITY_PRESETS[quality]
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: this.preset.antialias, powerPreference: 'high-performance' })
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.toneMapping = THREE.ACESFilmicToneMapping
    this.gl.toneMappingExposure = 1.05
    this.applyQuality(quality)
    window.addEventListener('resize', () => this.resize())
  }

  get shadowMapSize(): number {
    return this.preset.shadowMap
  }

  /** 0.5..1 detail hint for particle and background budgets. */
  get detail(): number {
    return this.preset.detail
  }

  applyQuality(quality: Quality): void {
    this.preset = QUALITY_PRESETS[quality]
    this.gl.shadowMap.enabled = this.preset.shadows
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio))
    this.bloom?.dispose()
    this.composer?.dispose()
    this.composer = undefined
    this.bloom = undefined
    this.finish = undefined
    this.resize()
  }

  private ensureComposer(scene: THREE.Scene, camera: THREE.PerspectiveCamera): EffectComposer | undefined {
    if (!this.preset.bloom && !this.preset.post) return undefined
    if (this.composer && this.scene === scene && this.camera === camera) return this.composer
    this.composer?.dispose()
    this.scene = scene
    this.camera = camera
    const size = this.gl.getSize(new THREE.Vector2())
    this.composer = new EffectComposer(this.gl)
    this.composer.addPass(new RenderPass(scene, camera))
    if (this.preset.bloom) {
      const bs = size.clone().multiplyScalar(this.preset.bloomScale)
      this.bloom = new UnrealBloomPass(bs, this.bloomStrength, 0.5, 0.86)
      this.composer.addPass(this.bloom)
    }
    this.composer.addPass(new OutputPass())
    if (this.preset.post) {
      this.finish = new ShaderPass(FinishShader)
      this.composer.addPass(this.finish)
    }
    this.composer.setSize(size.x, size.y)
    return this.composer
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.gl.setSize(w, h, false)
    this.composer?.setSize(w, h)
    if (this.camera) {
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (Math.abs(camera.aspect - w / h) > 1e-3) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const composer = this.ensureComposer(scene, camera)
    if (this.bloom) this.bloom.strength = this.bloomStrength
    if (this.finish) {
      const u = this.finish.uniforms
      u.uAberration.value = this.post.aberration
      u.uZoom.value = this.post.zoom
      u.uVignette.value = this.post.vignette
      ;(u.uTint.value as THREE.Color).copy(this.post.tint)
      u.uTintAmount.value = this.post.tintAmount
    }
    if (composer) composer.render()
    else this.gl.render(scene, camera)
  }
}
