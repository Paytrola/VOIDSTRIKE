import * as THREE from 'three'
import { InstancedBatch, ObjectPool } from '../engine/pool'
import { glowTexture } from './textures'
import { CONFIG } from './config'

export const BULLET_COLORS = {
  magenta: '#ff3d8e',
  orange: '#ff8a2a',
  violet: '#b46bff',
  red: '#ff3344',
  hot: '#ffd9a0',
  cyan: '#4fe3ff',
} as const
export type BulletColor = keyof typeof BULLET_COLORS

export type BulletOpts = {
  color?: BulletColor
  radius?: number
  /** Stretched along velocity. */
  needle?: boolean
  damage?: number
  /** Speed multiplier per second (1 = constant). */
  accel?: number
  /** Rotates velocity around the rail axis (radians per second) for curving streams. */
  curve?: number
  delay?: number
}

export type EnemyBullet = {
  pos: THREE.Vector3
  vel: THREE.Vector3
  radius: number
  color: THREE.Color
  needle: boolean
  damage: number
  accel: number
  curve: number
  life: number
  grazed: boolean
  delay: number
}

const tmpD = new THREE.Vector3()
const tmpU = new THREE.Vector3()
const tmpV = new THREE.Vector3()
const tmpW = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/** Orthonormal basis around direction d (u right, v up). */
function basis(d: THREE.Vector3): void {
  tmpU.crossVectors(d, WORLD_UP)
  if (tmpU.lengthSq() < 1e-6) tmpU.set(1, 0, 0)
  tmpU.normalize()
  tmpV.crossVectors(tmpU, d).normalize()
}

/**
 * Enemy bullets in rig-local space. Pattern emitters (`fan`, `ring`) build classic bullet-hell
 * shapes in 3D: bullets travel towards the player's plane while spreading outward. Two
 * instanced draw calls (hot cores + coloured halos) regardless of count.
 */
export class EnemyBullets {
  readonly group = new THREE.Group()
  readonly pool: ObjectPool<EnemyBullet>
  private readonly core: InstancedBatch
  private readonly halo: InstancedBatch
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private readonly z = new THREE.Vector3(0, 0, 1)
  readonly camQuat = new THREE.Quaternion()
  /** Global speed multiplier (difficulty / desperation). */
  speedScale = 1

  constructor(capacity = 1600) {
    this.pool = new ObjectPool<EnemyBullet>(
      () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), radius: 0.4, color: new THREE.Color(), needle: false, damage: 8, accel: 1, curve: 0, life: 0, grazed: false, delay: 0 }),
      capacity,
      capacity,
    )
    const coreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false })
    this.core = new InstancedBatch(new THREE.IcosahedronGeometry(1, 1), coreMat, capacity, { colors: true })
    const haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false })
    this.halo = new InstancedBatch(new THREE.PlaneGeometry(1, 1), haloMat, capacity, { colors: true })
    this.core.mesh.renderOrder = 7
    this.halo.mesh.renderOrder = 8
    this.group.add(this.core.mesh, this.halo.mesh)
  }

  get count(): number {
    return this.pool.size
  }

  clear(): void {
    this.pool.releaseAll()
  }

  shoot(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, o: BulletOpts = {}): EnemyBullet | undefined {
    const b = this.pool.acquire()
    if (!b) return undefined
    b.pos.copy(origin)
    b.vel.copy(dir).normalize().multiplyScalar(speed * this.speedScale)
    b.radius = o.radius ?? 0.42
    b.color.set(BULLET_COLORS[o.color ?? 'magenta'])
    b.needle = o.needle ?? false
    b.damage = o.damage ?? CONFIG.damage.bullet
    b.accel = o.accel ?? 1
    b.curve = o.curve ?? 0
    b.life = 9
    b.grazed = false
    b.delay = o.delay ?? 0
    return b
  }

  /** `count` bullets spread across `spread` radians (horizontal fan) aimed at `target`. */
  fan(origin: THREE.Vector3, target: THREE.Vector3, speed: number, count: number, spread: number, o: BulletOpts = {}, tilt = 0): void {
    tmpD.subVectors(target, origin).normalize()
    basis(tmpD)
    for (let i = 0; i < count; i += 1) {
      const a = count === 1 ? 0 : -spread / 2 + (spread * i) / (count - 1)
      const cx = Math.cos(tilt)
      const sx = Math.sin(tilt)
      tmpW.copy(tmpD).multiplyScalar(Math.cos(a)).addScaledVector(tmpU, Math.sin(a) * cx).addScaledVector(tmpV, Math.sin(a) * sx)
      this.shoot(origin, tmpW, speed, o)
    }
  }

  /**
   * Ring: bullets head towards `target` at `speed` while expanding outwards at `radial` units/s.
   * `phase` rotates the ring (spirals are rings with a changing phase).
   */
  ring(origin: THREE.Vector3, target: THREE.Vector3, speed: number, count: number, radial: number, phase = 0, o: BulletOpts = {}, gap = -1): void {
    tmpD.subVectors(target, origin).normalize()
    basis(tmpD)
    for (let i = 0; i < count; i += 1) {
      if (gap >= 0 && Math.abs(i - gap) <= 1) continue
      const a = phase + (i / count) * Math.PI * 2
      tmpW.copy(tmpD).multiplyScalar(speed).addScaledVector(tmpU, Math.cos(a) * radial).addScaledVector(tmpV, Math.sin(a) * radial)
      const speedTotal = tmpW.length()
      this.shoot(origin, tmpW, speedTotal, o)
    }
  }

  /**
   * Advance bullets and test them against the player sphere. `onHit` fires once per bullet that
   * touches the hull; `onGraze` once per bullet that passes within the graze radius.
   */
  update(dt: number, player: THREE.Vector3, hitRadius: number, grazeRadius: number, onHit: (b: EnemyBullet) => boolean, onGraze: (b: EnemyBullet) => void): void {
    this.pool.update(b => {
      if (b.delay > 0) {
        b.delay -= dt
        return true
      }
      b.life -= dt
      if (b.accel !== 1) b.vel.multiplyScalar(Math.pow(b.accel, dt))
      if (b.curve !== 0) {
        const a = b.curve * dt
        const x = b.vel.x
        b.vel.x = x * Math.cos(a) - b.vel.y * Math.sin(a)
        b.vel.y = x * Math.sin(a) + b.vel.y * Math.cos(a)
      }
      const pz = b.pos.z
      b.pos.addScaledVector(b.vel, dt)
      // Continuous test near the player plane so fast bullets cannot tunnel.
      if ((pz <= player.z + 1.5 && b.pos.z >= player.z - 1.5) || Math.abs(b.pos.z - player.z) < 2.5) {
        const dx = b.pos.x - player.x
        const dy = b.pos.y - player.y
        const dz = Math.max(0, Math.abs(b.pos.z - player.z) - Math.abs(b.vel.z) * dt * 0.5)
        const d2 = dx * dx + dy * dy + dz * dz
        const hr = hitRadius + b.radius * 0.8
        if (d2 < hr * hr) {
          if (onHit(b)) return false
        } else if (!b.grazed && d2 < (grazeRadius + b.radius) * (grazeRadius + b.radius)) {
          b.grazed = true
          onGraze(b)
        }
      }
      return b.life > 0 && b.pos.z < 14 && b.pos.z > -400 && Math.abs(b.pos.x) < 80 && Math.abs(b.pos.y) < 60
    })
  }

  /** Convert every bullet into a callback (score sparkle) and clear them: phase-change cancel. */
  cancelAll(each: (pos: THREE.Vector3, color: THREE.Color) => void): void {
    for (const b of this.pool.active) each(b.pos, b.color)
    this.pool.releaseAll()
  }

  render(time: number): void {
    this.core.begin()
    this.halo.begin()
    for (const b of this.pool.active) {
      if (b.delay > 0) continue
      const pulse = 1 + Math.sin(time * 18 + b.pos.x) * 0.08
      if (b.needle) {
        this.q.setFromUnitVectors(this.z, tmpD.copy(b.vel).normalize())
        this.s.set(b.radius * 0.45, b.radius * 0.45, b.radius * 2.4)
      } else {
        this.q.identity()
        this.s.setScalar(b.radius * 0.62)
      }
      this.c.copy(b.color).lerp(WHITE, 0.72)
      this.core.push(b.pos, this.q, this.s, this.c)
      this.c.copy(b.color).multiplyScalar(1.4)
      this.halo.push(b.pos, this.camQuat, b.radius * 4.2 * pulse, this.c)
    }
    this.core.end()
    this.halo.end()
  }
}

const WHITE = new THREE.Color('#ffffff')

export type Shot = { pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; life: number; damage: number }

/** Player bolts: stretched gold tracers with glow heads; hits are resolved by the scene. */
export class PlayerShots {
  readonly group = new THREE.Group()
  readonly pool = new ObjectPool<Shot>(() => ({ pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, damage: 1 }), 240, 240)
  private readonly bolt: InstancedBatch
  private readonly glow: InstancedBatch
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly z = new THREE.Vector3(0, 0, 1)
  private readonly d = new THREE.Vector3()
  readonly camQuat = new THREE.Quaternion()

  constructor() {
    const boltMat = new THREE.MeshBasicMaterial({ color: '#ffe3a0', toneMapped: false, fog: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
    this.bolt = new InstancedBatch(new THREE.BoxGeometry(1, 1, 1), boltMat, 240)
    const glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff9a3a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false })
    this.glow = new InstancedBatch(new THREE.PlaneGeometry(1, 1), glowMat, 240)
    this.bolt.mesh.renderOrder = 7
    this.glow.mesh.renderOrder = 8
    this.group.add(this.bolt.mesh, this.glow.mesh)
  }

  fire(from: THREE.Vector3, dir: THREE.Vector3, speed: number, life: number, damage: number): Shot | undefined {
    const s = this.pool.acquire()
    if (!s) return undefined
    s.pos.copy(from)
    s.prev.copy(from)
    s.vel.copy(dir).multiplyScalar(speed)
    s.life = life
    s.damage = damage
    return s
  }

  clear(): void {
    this.pool.releaseAll()
  }

  render(alpha: number): void {
    this.bolt.begin()
    this.glow.begin()
    for (const s of this.pool.active) {
      this.d.lerpVectors(s.prev, s.pos, alpha)
      this.q.setFromUnitVectors(this.z, this.s.copy(s.vel).normalize())
      this.s.set(0.16, 0.16, 4.2)
      this.bolt.push(this.d, this.q, this.s)
      this.glow.push(this.d, this.camQuat, 1.5)
    }
    this.bolt.end()
    this.glow.end()
  }
}
