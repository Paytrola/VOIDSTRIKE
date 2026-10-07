import * as THREE from 'three'
import { buildRock } from './models'
import type { Rail } from './rail'
import { glowTexture } from './textures'

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize()
/** Gameplay key light: the sun's light bounced so faces toward the camera stay readable. */
const KEY_DIR = new THREE.Vector3(-0.5, 0.7, 0.5).normalize()

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`

const SKY_FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uAlarm;
  varying vec3 vDir;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir);
    float n = fbm(d * 2.6 + vec3(0.0, 0.0, uTime * 0.004));
    float n2 = fbm(d * 5.5 + 3.1);
    float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, 0.35))) * 2.4, 2.0));
    vec3 base = mix(vec3(0.012, 0.012, 0.045), vec3(0.03, 0.02, 0.08), d.y * 0.5 + 0.5);
    vec3 neb = mix(vec3(0.34, 0.06, 0.32), vec3(0.03, 0.26, 0.34), smoothstep(0.35, 0.7, n2));
    vec3 col = base + neb * smoothstep(0.42, 0.85, n) * (0.35 + band * 0.9);
    col += vec3(0.5, 0.18, 0.08) * pow(max(dot(d, uSun), 0.0), 6.0) * 0.55;
    col += vec3(1.0, 0.75, 0.5) * pow(max(dot(d, uSun), 0.0), 90.0) * 1.2;
    // Stars: sparse hashed cells.
    vec3 cell = floor(d * 220.0);
    float h = hash(cell);
    float star = step(0.9965, h) * smoothstep(0.5, 0.0, length(fract(d * 220.0) - 0.5));
    col += vec3(0.9, 0.95, 1.0) * star * (0.6 + 0.4 * sin(uTime * 3.0 + h * 50.0));
    col = mix(col, col * vec3(1.6, 0.45, 0.45) + vec3(0.06, 0.0, 0.0), uAlarm);
    gl_FragColor = vec4(col, 1.0);
  }`

const PLANET_FRAG = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vN;
  varying vec3 vP;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 n = normalize(vN);
    float lat = n.y;
    float bands = sin(lat * 22.0 + sin(lat * 7.0 + n.x * 3.0) * 1.3) * 0.5 + 0.5;
    vec3 a = vec3(0.55, 0.28, 0.22), b = vec3(0.86, 0.6, 0.4), c = vec3(0.32, 0.18, 0.36);
    vec3 col = mix(mix(c, a, bands), b, smoothstep(0.7, 1.0, bands) * 0.6);
    float l = max(dot(n, uSun), 0.0);
    float rim = pow(1.0 - max(dot(n, normalize(cameraPosition - vP)), 0.0), 3.0);
    vec3 lit = col * (0.05 + l * 1.1) + vec3(1.0, 0.45, 0.35) * rim * (0.2 + l) * 0.9;
    gl_FragColor = vec4(lit, 1.0);
  }`

const PLANET_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`

const RING_FRAG = /* glsl */ `
  varying vec2 vUv2;
  void main() {
    float r = vUv2.x;
    float bands = sin(r * 90.0) * 0.5 + 0.5;
    bands *= sin(r * 31.0 + 1.2) * 0.3 + 0.7;
    float edge = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.85, r);
    vec3 col = mix(vec3(0.55, 0.42, 0.5), vec3(0.95, 0.75, 0.6), bands);
    gl_FragColor = vec4(col * 0.8, edge * (0.25 + bands * 0.45));
  }`

const RING_VERT = /* glsl */ `
  attribute float aR;
  varying vec2 vUv2;
  void main() { vUv2 = vec2(aR, 0.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

type Rock = { variant: number; s: number; ox: number; oy: number; scale: number; pos: THREE.Vector3; q: THREE.Quaternion; spin: THREE.Quaternion }

/**
 * Background: nebula sky dome, a ringed gas giant, the sun, fog and a world-space asteroid belt
 * that recycles rocks ahead of the rail.
 */
export class Environment {
  readonly group = new THREE.Group()
  readonly sky: THREE.Mesh
  private readonly skyMat: THREE.ShaderMaterial
  private readonly planet: THREE.Group
  private readonly sun: THREE.Sprite
  private readonly rocks: Rock[] = []
  private readonly rockMeshes: THREE.InstancedMesh[] = []
  private readonly tmpQ = new THREE.Quaternion()
  private readonly tmpV = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly s3 = new THREE.Vector3()
  alarm = 0
  /** Radial clearance around the rail kept free of rocks (widened for the boss arena). */
  corridor = 0
  private corridorNow = 0

  constructor(scene: THREE.Scene, private readonly rail: Rail, detail: number) {
    scene.add(this.group)
    scene.fog = new THREE.FogExp2('#0d0a22', 0.0042)
    scene.background = new THREE.Color('#05040f')

    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uSun: { value: SUN_DIR }, uTime: { value: 0 }, uAlarm: { value: 0 } } })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), this.skyMat)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -10
    this.group.add(this.sky)

    this.planet = new THREE.Group()
    const planetMat = new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, uniforms: { uSun: { value: SUN_DIR } }, fog: false })
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(300, 4), planetMat)
    this.planet.add(sphere)
    const ringGeo = new THREE.RingGeometry(380, 620, 96, 1)
    const pos = ringGeo.getAttribute('position')
    const aR = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i += 1) aR[i] = (Math.hypot(pos.getX(i), pos.getY(i)) - 380) / 240
    ringGeo.setAttribute('aR', new THREE.BufferAttribute(aR, 1))
    const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }))
    ring.rotation.set(-1.25, 0.25, 0.1)
    this.planet.add(ring)
    this.planet.rotation.set(0.2, 0, 0.35)
    this.group.add(this.planet)

    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffc58a', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }))
    this.sun.scale.setScalar(360)
    this.group.add(this.sun)

    const hemi = new THREE.HemisphereLight('#9a8cff', '#3a1a3a', 1.35)
    const key = new THREE.DirectionalLight('#ffd2a6', 3.0)
    key.position.copy(SUN_DIR).multiplyScalar(100)
    const rim = new THREE.DirectionalLight('#ff9ad0', 1.6)
    rim.position.set(0.6, -0.3, 0.8).multiplyScalar(100)
    scene.add(hemi, key, rim, key.target, rim.target)
    // Lights are directional: keep them attached to the camera rig so shading is stable.
    this.keyLight = key
    this.rimLight = rim

    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0.05 })
    const perVariant = Math.round(95 * detail)
    for (let v = 0; v < 3; v += 1) {
      const mesh = new THREE.InstancedMesh(buildRock(v + 1, v === 2 ? 0 : 1, v === 1 ? '#9a7a64' : '#8a7288'), rockMat, perVariant)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      this.rockMeshes.push(mesh)
      this.group.add(mesh)
      for (let i = 0; i < perVariant; i += 1) {
        const rock: Rock = { variant: v, s: 0, ox: 0, oy: 0, scale: 1, pos: new THREE.Vector3(), q: new THREE.Quaternion().random(), spin: new THREE.Quaternion() }
        this.place(rock, rail.s - 40 + Math.random() * 760)
        this.rocks.push(rock)
      }
    }
  }

  readonly keyLight: THREE.DirectionalLight
  readonly rimLight: THREE.DirectionalLight

  /** Re-seed rocks around the current rail position (restart). */
  reset(): void {
    for (const r of this.rocks) this.place(r, this.rail.s - 40 + Math.random() * 760)
  }

  private place(r: Rock, s: number): void {
    r.s = s
    const a = Math.random() * Math.PI * 2
    const near = Math.random() < 0.55
    const dist = near ? 15 + Math.random() * 30 : 45 + Math.random() * 90
    r.ox = Math.cos(a) * dist * 1.25
    r.oy = Math.sin(a) * dist * 0.8
    r.scale = near ? 0.9 + Math.random() * 2.6 : 3 + Math.random() * 11
    this.rail.frame(s, r.pos, this.tmpQ)
    r.pos.add(this.tmpV.set(r.ox, r.oy, 0).applyQuaternion(this.tmpQ))
    r.spin.setFromAxisAngle(this.tmpV.randomDirection(), (Math.random() - 0.5) * 0.02)
  }

  update(cameraWorld: THREE.Vector3, frameSeconds: number, time: number): void {
    this.sky.position.copy(cameraWorld)
    this.skyMat.uniforms.uTime.value = time
    this.skyMat.uniforms.uAlarm.value = this.alarm
    this.planet.position.copy(cameraWorld).addScaledVector(this.tmpV.set(0.62, -0.18, -0.76).normalize(), 1150)
    this.sun.position.copy(cameraWorld).addScaledVector(SUN_DIR, 1300)
    this.keyLight.position.copy(cameraWorld).addScaledVector(KEY_DIR, 100)
    this.keyLight.target.position.copy(cameraWorld)
    this.rimLight.position.copy(cameraWorld).addScaledVector(SUN_DIR, 100)
    this.rimLight.target.position.copy(cameraWorld)
    this.corridorNow += (this.corridor - this.corridorNow) * (1 - Math.exp(-frameSeconds * 1.5))
    const counts = [0, 0, 0]
    const spinSteps = Math.min(4, frameSeconds * 60)
    for (const r of this.rocks) {
      if (r.s < this.rail.s - 45) this.place(r, this.rail.s + 620 + Math.random() * 140)
      for (let i = 0; i < spinSteps; i += 1) r.q.multiply(r.spin)
      const radial = Math.hypot(r.ox / 1.25, r.oy / 0.8)
      const keep = THREE.MathUtils.clamp((radial - this.corridorNow) / 10, 0, 1)
      if (keep <= 0.01) continue
      this.m.compose(r.pos, r.q, this.s3.setScalar(r.scale * keep))
      this.rockMeshes[r.variant].setMatrixAt(counts[r.variant]++, this.m)
    }
    for (let v = 0; v < 3; v += 1) {
      this.rockMeshes[v].count = counts[v]
      this.rockMeshes[v].instanceMatrix.needsUpdate = true
    }
  }
}

/**
 * Speed feel in rig space: star streaks whose tails stretch with speed, plus bright speed lines
 * near the screen edges while boosting. One LineSegments draw call each.
 */
export class SpeedField {
  readonly group = new THREE.Group()
  private readonly stars: THREE.LineSegments
  private readonly lines: THREE.LineSegments
  private readonly starData: Float32Array
  private readonly lineData: Float32Array
  private readonly starCount: number
  private readonly lineCount: number
  /** 0..1 extra stretch and speed-line intensity. */
  boost = 0

  constructor(detail: number) {
    this.starCount = Math.round(900 * detail)
    this.lineCount = 64
    this.starData = new Float32Array(this.starCount * 3)
    this.lineData = new Float32Array(this.lineCount * 4)
    this.stars = this.makeLines(this.starCount, '#dfe8ff')
    this.lines = this.makeLines(this.lineCount, '#bff4ff')
    for (let i = 0; i < this.starCount; i += 1) this.seedStar(i, -500 + Math.random() * 530)
    for (let i = 0; i < this.lineCount; i += 1) this.seedLine(i, -160 + Math.random() * 170)
    this.group.add(this.stars, this.lines)
  }

  private makeLines(count: number, color: string): THREE.LineSegments {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3).setUsage(THREE.DynamicDrawUsage))
    const col = new Float32Array(count * 6)
    const c = new THREE.Color(color)
    for (let i = 0; i < count; i += 1) {
      col.set([c.r, c.g, c.b, 0, 0, 0], i * 6)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    const l = new THREE.LineSegments(g, m)
    l.frustumCulled = false
    return l
  }

  private seedStar(i: number, z: number): void {
    const a = Math.random() * Math.PI * 2
    const r = 4 + Math.pow(Math.random(), 0.7) * 80
    this.starData.set([Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.85, z], i * 3)
  }

  private seedLine(i: number, z: number): void {
    const a = Math.random() * Math.PI * 2
    const r = 7 + Math.random() * 9
    this.lineData.set([Math.cos(a) * r * 1.5, Math.sin(a) * r * 0.9, z, 0.5 + Math.random() * 0.5], i * 4)
  }

  update(dt: number, speed: number): void {
    const move = speed * 1.15 * dt
    const tail = 0.3 + speed * (0.028 + this.boost * 0.07)
    const sp = this.stars.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = sp.array as Float32Array
    for (let i = 0; i < this.starCount; i += 1) {
      let z = this.starData[i * 3 + 2] + move
      if (z > 30) {
        this.seedStar(i, -500 + Math.random() * 40)
        z = this.starData[i * 3 + 2]
      }
      this.starData[i * 3 + 2] = z
      const x = this.starData[i * 3]
      const y = this.starData[i * 3 + 1]
      arr[i * 6] = x
      arr[i * 6 + 1] = y
      arr[i * 6 + 2] = z
      arr[i * 6 + 3] = x
      arr[i * 6 + 4] = y
      arr[i * 6 + 5] = z - tail
    }
    sp.needsUpdate = true
    const lp = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute
    const la = lp.array as Float32Array
    const lineMove = speed * 2.4 * dt
    const lineTail = 6 + speed * 0.25
    for (let i = 0; i < this.lineCount; i += 1) {
      let z = this.lineData[i * 4 + 2] + lineMove
      if (z > 12) {
        this.seedLine(i, -170 + Math.random() * 20)
        z = this.lineData[i * 4 + 2]
      }
      this.lineData[i * 4 + 2] = z
      const x = this.lineData[i * 4]
      const y = this.lineData[i * 4 + 1]
      la.set([x, y, z, x, y, z - lineTail * this.lineData[i * 4 + 3]], i * 6)
    }
    lp.needsUpdate = true
    ;(this.lines.material as THREE.LineBasicMaterial).opacity = 0.05 + this.boost * 0.85
    ;(this.stars.material as THREE.LineBasicMaterial).opacity = 0.75 + this.boost * 0.25
  }
}
