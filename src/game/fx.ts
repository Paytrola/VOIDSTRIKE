import * as THREE from 'three'
import { InstancedBatch } from '../engine/pool'
import { glowTexture, ringTexture } from './textures'

/**
 * Particle effects in rig-local space, all instanced (4 draw calls total):
 * sparks (velocity-stretched additive shards), flares (camera-facing glows), debris (lit tumbling
 * chunks) and rings (expanding shockwaves). Particles drift backwards with the rail speed so
 * explosions stream past the camera, which sells forward motion.
 */
type P = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  max: number
  size: number
  color: THREE.Color
  drag: number
  spin: THREE.Vector3
  rot: THREE.Euler
  grow: number
}

class Layer {
  readonly items: P[] = []
  private readonly free: P[] = []
  constructor(readonly capacity: number) {}
  spawn(): P | undefined {
    if (this.items.length >= this.capacity) {
      // Recycle the oldest particle rather than dropping new, more important ones.
      const old = this.items.shift()!
      this.items.push(old)
      return old
    }
    const p = this.free.pop() ?? { pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, color: new THREE.Color(), drag: 0, spin: new THREE.Vector3(), rot: new THREE.Euler(), grow: 0 }
    this.items.push(p)
    return p
  }
  update(dt: number, drift: number): void {
    let w = 0
    for (let i = 0; i < this.items.length; i += 1) {
      const p = this.items[i]
      p.life -= dt
      if (p.life <= 0) {
        this.free.push(p)
        continue
      }
      const d = Math.exp(-p.drag * dt)
      p.vel.multiplyScalar(d)
      p.pos.addScaledVector(p.vel, dt)
      p.pos.z += drift * dt
      p.rot.x += p.spin.x * dt
      p.rot.y += p.spin.y * dt
      p.rot.z += p.spin.z * dt
      this.items[w++] = p
    }
    this.items.length = w
  }
  clear(): void {
    for (const p of this.items) this.free.push(p)
    this.items.length = 0
  }
}

export class Fx {
  readonly group = new THREE.Group()
  private readonly sparks: Layer
  private readonly flares: Layer
  private readonly debris: Layer
  private readonly rings: Layer
  private readonly sparkBatch: InstancedBatch
  private readonly flareBatch: InstancedBatch
  private readonly debrisBatch: InstancedBatch
  private readonly ringBatch: InstancedBatch
  private readonly v = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private readonly up = new THREE.Vector3(0, 0, 1)
  /** Rig-space camera orientation, for billboards. */
  readonly camQuat = new THREE.Quaternion()
  /** Particle budget scale (quality tier). */
  density = 1

  constructor(detail: number) {
    this.density = detail
    const additive = (map?: THREE.Texture) => new THREE.MeshBasicMaterial({ ...(map ? { map } : {}), color: '#ffffff', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false })
    this.sparks = new Layer(Math.round(1400 * detail))
    this.flares = new Layer(Math.round(420 * detail))
    this.debris = new Layer(Math.round(260 * detail))
    this.rings = new Layer(40)
    this.sparkBatch = new InstancedBatch(new THREE.BoxGeometry(1, 1, 1), additive(), this.sparks.capacity, { colors: true })
    this.flareBatch = new InstancedBatch(new THREE.PlaneGeometry(1, 1), additive(glowTexture()), this.flares.capacity, { colors: true })
    this.ringBatch = new InstancedBatch(new THREE.PlaneGeometry(1, 1), additive(ringTexture()), this.rings.capacity, { colors: true })
    const debrisMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.3, emissive: '#3a1204' })
    this.debrisBatch = new InstancedBatch(new THREE.TetrahedronGeometry(1, 0), debrisMat, this.debris.capacity, { colors: true })
    this.sparkBatch.mesh.renderOrder = 5
    this.flareBatch.mesh.renderOrder = 6
    this.ringBatch.mesh.renderOrder = 6
    this.group.add(this.debrisBatch.mesh, this.sparkBatch.mesh, this.flareBatch.mesh, this.ringBatch.mesh)
  }

  clear(): void {
    this.sparks.clear()
    this.flares.clear()
    this.debris.clear()
    this.rings.clear()
  }

  spark(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, life = 0.4, size = 0.12, drag = 3): void {
    const p = this.sparks.spawn()
    if (!p) return
    p.pos.copy(pos)
    p.vel.copy(vel)
    p.life = p.max = life * (0.7 + Math.random() * 0.6)
    p.size = size
    p.color.set(color)
    p.drag = drag
  }

  flare(pos: THREE.Vector3, size: number, color: THREE.ColorRepresentation, life = 0.25, grow = 0, vel?: THREE.Vector3): void {
    const p = this.flares.spawn()
    if (!p) return
    p.pos.copy(pos)
    p.vel.copy(vel ?? this.v.set(0, 0, 0))
    p.life = p.max = life
    p.size = size
    p.grow = grow
    p.color.set(color)
    p.drag = 2
    p.rot.set(0, 0, Math.random() * Math.PI)
  }

  ring(pos: THREE.Vector3, size: number, color: THREE.ColorRepresentation, life = 0.45, facing = true): void {
    const p = this.rings.spawn()
    if (!p) return
    p.pos.copy(pos)
    p.vel.set(0, 0, 0)
    p.life = p.max = life
    p.size = size
    p.color.set(color)
    p.drag = 0
    p.grow = facing ? 1 : 0
  }

  chunk(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life = 1.4): void {
    const p = this.debris.spawn()
    if (!p) return
    p.pos.copy(pos)
    p.vel.copy(vel)
    p.life = p.max = life * (0.7 + Math.random() * 0.6)
    p.size = size * (0.6 + Math.random() * 0.8)
    p.color.set(color)
    p.drag = 0.6
    p.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12)
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
  }

  /** Small hit spark burst along a surface normal-ish direction. */
  hit(pos: THREE.Vector3, color: THREE.ColorRepresentation, dir?: THREE.Vector3, count = 6): void {
    const n = Math.max(2, Math.round(count * this.density))
    for (let i = 0; i < n; i += 1) {
      this.v.randomDirection().multiplyScalar(8 + Math.random() * 14)
      if (dir) this.v.addScaledVector(dir, 10)
      this.spark(pos, this.v, color, 0.22, 0.09, 5)
    }
    this.flare(pos, 1.6, color, 0.09)
  }

  /** Metallic ping on armour: white sparks, no damage. */
  ping(pos: THREE.Vector3): void {
    for (let i = 0; i < 3; i += 1) this.spark(pos, this.v.randomDirection().multiplyScalar(14).setZ(Math.abs(this.v.z) * 1.2 + 4), '#d9e4ff', 0.16, 0.07, 6)
    this.flare(pos, 0.9, '#9fb4ff', 0.06)
  }

  /** Full explosion. `size` ≈ enemy radius. */
  explode(pos: THREE.Vector3, size: number, primary: THREE.ColorRepresentation, secondary: THREE.ColorRepresentation, debrisColor: THREE.ColorRepresentation = '#3b3656'): void {
    const k = this.density
    this.flare(pos, size * 5.5, '#ffffff', 0.12, 2)
    this.flare(pos, size * 7, primary, 0.35, 1.5)
    this.flare(pos, size * 4, secondary, 0.6, 1)
    this.ring(pos, size * 6, primary, 0.4)
    const sparks = Math.round((14 + size * 16) * k)
    for (let i = 0; i < sparks; i += 1) {
      this.v.randomDirection().multiplyScalar((10 + Math.random() * 26) * (0.6 + size * 0.35))
      this.spark(pos, this.v, i % 3 === 0 ? secondary : primary, 0.55 + size * 0.1, 0.12 + size * 0.03, 2.2)
    }
    const chunks = Math.round((4 + size * 4) * k)
    for (let i = 0; i < chunks; i += 1) {
      this.v.randomDirection().multiplyScalar(4 + Math.random() * 10 * (0.5 + size * 0.3))
      this.chunk(pos, this.v, debrisColor, 0.18 + size * 0.14)
    }
    const embers = Math.round((3 + size * 3) * k)
    for (let i = 0; i < embers; i += 1) {
      this.v.randomDirection().multiplyScalar(2 + Math.random() * 5)
      this.flare(this.s.copy(pos).addScaledVector(this.v, 0.25), size * (1.5 + Math.random() * 1.5), secondary, 0.5 + Math.random() * 0.4, 0.6, this.v)
    }
  }

  muzzle(pos: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.flare(pos, 0.7, color, 0.05)
  }

  update(dt: number, railSpeed: number): void {
    const drift = railSpeed * 0.55
    this.sparks.update(dt, drift)
    this.flares.update(dt, drift * 0.6)
    this.debris.update(dt, drift)
    this.rings.update(dt, drift * 0.5)
  }

  render(): void {
    this.sparkBatch.begin()
    for (const p of this.sparks.items) {
      const t = p.life / p.max
      const speed = p.vel.length()
      const len = Math.max(p.size * 2, speed * 0.035)
      if (speed > 1e-3) this.q.setFromUnitVectors(this.up, this.v.copy(p.vel).divideScalar(speed))
      else this.q.identity()
      this.s.set(p.size * t, p.size * t, len)
      this.c.copy(p.color).multiplyScalar(1.5 * t + 0.2)
      this.sparkBatch.push(p.pos, this.q, this.s, this.c)
    }
    this.sparkBatch.end()
    this.flareBatch.begin()
    for (const p of this.flares.items) {
      const t = p.life / p.max
      const size = p.size * (1 + (1 - t) * p.grow)
      this.c.copy(p.color).multiplyScalar(t * t * 1.6)
      this.q.copy(this.camQuat)
      this.flareBatch.push(p.pos, this.q, size, this.c)
    }
    this.flareBatch.end()
    this.ringBatch.begin()
    for (const p of this.rings.items) {
      const t = p.life / p.max
      const size = p.size * (0.2 + (1 - t) * 1.2)
      this.c.copy(p.color).multiplyScalar(t * 1.4)
      this.ringBatch.push(p.pos, this.camQuat, size, this.c)
    }
    this.ringBatch.end()
    this.debrisBatch.begin()
    for (const p of this.debris.items) {
      const t = Math.min(1, (p.life / p.max) * 3)
      this.debrisBatch.push(p.pos, p.rot, p.size * t, p.color)
    }
    this.debrisBatch.end()
  }
}
