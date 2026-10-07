import * as THREE from 'three'
import type { RAPIER } from '../engine/physics'
import { InstancedBatch } from '../engine/pool'
import { GROUP_TARGET, type Arena } from './arena'
import { CONFIG } from './config'
import { buildCell, buildChisel, buildLantern, buildMine, buildMite, buildOreChunk, buildRock, type ModelParts } from './models'
import { POWERUP_COLORS, powerupForDrop, type PowerupKind } from './powerups'

export type EnemyKind = 'mite' | 'chisel' | 'lantern' | 'rock' | 'bigrock' | 'mine' | 'chunk' | 'cell'
export type Motion = 'swoop' | 'hold' | 'drift' | 'thrown'
export type FirePattern = 'none' | 'aimed' | 'burst' | 'fan3' | 'fan5' | 'ring' | 'spiral'
type V3 = [number, number, number]

export type SpawnSpec = {
  kind: EnemyKind
  motion?: Motion
  /** Start, control/anchor and end points in rig space. */
  p0: V3
  p1?: V3
  p2?: V3
  /** Swoop duration or enter/exit duration for hold. */
  duration?: number
  /** Hold time at the anchor. */
  hold?: number
  fire?: FirePattern
  /** Seconds before the first shot. */
  fireDelay?: number
  /** Bullet speed multiplier. */
  heat?: number
  vel?: V3
  scale?: number
  drop?: boolean
  pickupType?: PowerupKind
}

type Stats = { hp: number; radius: number; score: number; primary: string; secondary: string; debris: string; boom: number }
const STATS: Record<EnemyKind, Stats> = {
  mite: { hp: 2, radius: 1.0, score: CONFIG.score.mite, primary: '#ff3d8e', secondary: '#ffb347', debris: '#3b3656', boom: 0.9 },
  chisel: { hp: 9, radius: 1.5, score: CONFIG.score.chisel, primary: '#ff8a2a', secondary: '#ffe08a', debris: '#e8b23a', boom: 1.4 },
  lantern: { hp: 34, radius: 2.4, score: CONFIG.score.lantern, primary: '#ff6a2a', secondary: '#ff3d8e', debris: '#e8b23a', boom: 2.3 },
  rock: { hp: 3, radius: 1.35, score: CONFIG.score.rockSmall, primary: '#d9a27a', secondary: '#8f7a88', debris: '#6d5a6e', boom: 0.9 },
  bigrock: { hp: 14, radius: 3.3, score: CONFIG.score.rockLarge, primary: '#e0b08a', secondary: '#8f7a88', debris: '#6d5a6e', boom: 2.2 },
  mine: { hp: 2, radius: 1.1, score: CONFIG.score.mine, primary: '#ff3344', secondary: '#ffd35c', debris: '#2c2f45', boom: 1.3 },
  chunk: { hp: 5, radius: 1.7, score: CONFIG.score.chunk, primary: '#ff8a2a', secondary: '#ffd35c', debris: '#5a4250', boom: 1.4 },
  cell: { hp: 1, radius: 0.9, score: 0, primary: '#9dff5c', secondary: '#ffffff', debris: '#ffffff', boom: 0.5 },
}

export type Enemy = {
  id: number
  kind: EnemyKind
  active: boolean
  hp: number
  maxHp: number
  radius: number
  scale: number
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  quat: THREE.Quaternion
  spin: THREE.Quaternion
  age: number
  motion: Motion
  p0: THREE.Vector3
  p1: THREE.Vector3
  p2: THREE.Vector3
  duration: number
  hold: number
  fire: FirePattern
  fireTimer: number
  fireCount: number
  heat: number
  flash: number
  drop: boolean
  pickupType: PowerupKind
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
}

export type EnemyEvents = {
  killed(e: Enemy): void
  collected(e: Enemy): void
}

const PHASE_IN = 1.3
const PHASE_OUT = 1.4
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number) => t * t

/** Pooled enemies with kinematic Rapier colliders (shot queries) and one instanced batch per model. */
export class Enemies {
  readonly group = new THREE.Group()
  readonly list: Enemy[] = []
  private readonly free: Enemy[] = []
  private readonly byCollider = new Map<number, Enemy>()
  private readonly batches: Record<EnemyKind, { body: InstancedBatch; glow: InstancedBatch }>
  private nextId = 1
  private pickupDropIndex = 0
  private readonly v = new THREE.Vector3()
  private readonly w = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly fwd = new THREE.Vector3(0, 0, -1)
  private readonly s = new THREE.Vector3()
  private readonly rollQ = new THREE.Quaternion()

  constructor(private readonly arena: Arena, private readonly events: EnemyEvents) {
    const bodyMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.35 })
    const glowMat = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    const make = (parts: ModelParts, cap: number, colors = false) => {
      const body = new InstancedBatch(parts.body, bodyMat(), cap, { flash: true, colors })
      const glow = new InstancedBatch(parts.glow, glowMat(), cap, { colors })
      this.group.add(body.mesh, glow.mesh)
      return { body, glow }
    }
    const rock = { body: buildRock(7, 1), glow: new THREE.BufferGeometry() }
    rock.glow.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    rock.glow.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
    this.batches = {
      mite: make(buildMite(), 90),
      chisel: make(buildChisel(), 30),
      lantern: make(buildLantern(), 10),
      rock: make(rock, 60),
      bigrock: make({ body: buildRock(3, 1, '#7a6358'), glow: rock.glow.clone() }, 24),
      mine: make(buildMine(), 30),
      chunk: make(buildOreChunk(), 24),
      cell: make(buildCell(), 12, true),
    }
  }

  get hostileCount(): number {
    let n = 0
    for (const e of this.list) if (e.kind === 'mite' || e.kind === 'chisel' || e.kind === 'lantern') n += 1
    return n
  }

  count(kind?: EnemyKind): number {
    return kind ? this.list.filter(e => e.kind === kind).length : this.list.length
  }

  byColliderHandle(handle: number): Enemy | undefined {
    return this.byCollider.get(handle)
  }

  spawn(spec: SpawnSpec): Enemy {
    const e = this.free.pop() ?? this.create()
    const st = STATS[spec.kind]
    e.id = this.nextId++
    e.kind = spec.kind
    e.active = true
    e.scale = spec.scale ?? 1
    e.hp = e.maxHp = Math.round(st.hp * (spec.kind === 'bigrock' ? e.scale : 1))
    e.radius = st.radius * e.scale
    e.motion = spec.motion ?? (spec.kind === 'rock' || spec.kind === 'bigrock' || spec.kind === 'mine' || spec.kind === 'cell' ? 'drift' : 'swoop')
    e.p0.set(...spec.p0)
    e.p1.set(...(spec.p1 ?? spec.p0))
    e.p2.set(...(spec.p2 ?? spec.p1 ?? spec.p0))
    e.pos.copy(e.p0)
    e.prev.copy(e.p0)
    e.vel.set(...(spec.vel ?? [0, 0, 0]))
    e.duration = spec.duration ?? 4
    e.hold = spec.hold ?? 4
    e.fire = spec.fire ?? 'none'
    e.fireTimer = spec.fireDelay ?? 0.8 + Math.random() * 0.8
    e.fireCount = 0
    e.heat = spec.heat ?? 1
    e.flash = 0
    e.age = 0
    e.drop = spec.drop ?? false
    e.pickupType = spec.pickupType ?? 'health'
    e.quat.random()
    e.spin.setFromAxisAngle(this.v.randomDirection(), (spec.kind === 'rock' || spec.kind === 'bigrock' ? 0.6 + Math.random() * 1.4 : spec.kind === 'chunk' ? 4 : 1.2) / 60)
    const hasCollider = spec.kind !== 'cell'
    e.collider.setEnabled(hasCollider)
    if (hasCollider) {
      e.collider.setRadius(e.radius)
      e.body.setTranslation({ x: e.pos.x, y: e.pos.y, z: e.pos.z }, true)
      e.body.setNextKinematicTranslation({ x: e.pos.x, y: e.pos.y, z: e.pos.z })
    }
    this.list.push(e)
    return e
  }

  private create(): Enemy {
    const body = this.arena.physics.addKinematicBody({ x: 0, y: -999, z: 0 })
    const collider = this.arena.physics.attachBall(body, 1, undefined, GROUP_TARGET)
    const e: Enemy = {
      id: 0, kind: 'mite', active: false, hp: 1, maxHp: 1, radius: 1, scale: 1,
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spin: new THREE.Quaternion(),
      age: 0, motion: 'swoop', p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), duration: 4, hold: 4,
      fire: 'none', fireTimer: 1, fireCount: 0, heat: 1, flash: 0, drop: false, pickupType: 'health', body, collider,
    }
    this.byCollider.set(collider.handle, e)
    return e
  }

  private release(e: Enemy): void {
    e.active = false
    e.collider.setEnabled(false)
    e.body.setNextKinematicTranslation({ x: 0, y: -999, z: 0 })
    this.free.push(e)
  }

  clear(): void {
    for (const e of this.list) this.release(e)
    this.list.length = 0
    this.pickupDropIndex = 0
  }

  /** Apply damage from a shot or blast. Returns true when it destroyed the target. */
  damage(e: Enemy, amount: number, at: THREE.Vector3): boolean {
    if (!e.active || e.kind === 'cell') return false
    e.hp -= amount
    e.flash = 1
    const st = STATS[e.kind]
    if (e.hp > 0) {
      this.arena.fx.hit(at, st.secondary, undefined, e.kind === 'rock' || e.kind === 'bigrock' ? 4 : 6)
      this.arena.audio.play(e.kind === 'rock' || e.kind === 'bigrock' ? 'hitRock' : 'hit')
      return false
    }
    this.destroy(e)
    return true
  }

  private destroy(e: Enemy): void {
    const st = STATS[e.kind]
    const a = this.arena
    a.fx.explode(e.pos, st.boom * (e.kind === 'bigrock' ? e.scale * 0.8 : 1), st.primary, st.secondary, st.debris)
    const big = e.kind === 'lantern' || e.kind === 'bigrock'
    a.audio.play(big ? 'explodeBig' : e.kind === 'rock' ? 'rockBreak' : 'explode', Math.random() * 3)
    if (e.kind === 'lantern') {
      a.impact.hitStop(0.07)
      a.impact.shake(0.35)
      a.impact.pulse(0.5)
    } else if (e.kind === 'chisel') {
      a.impact.hitStop(0.035)
      a.impact.shake(0.14)
    } else if (e.kind === 'mite' || e.kind === 'mine') {
      a.impact.hitStop(0.018)
      a.impact.shake(0.06)
    } else a.impact.shake(big ? 0.2 : 0.05)
    if (e.kind === 'mine') {
      // Mines burst into a small ring when shot, rewarding a timely kill but keeping pressure.
      a.bullets.ring(e.pos, a.player, 16, 8, 6, Math.random() * 6, { color: 'red', radius: 0.36 })
    }
    if (e.kind === 'bigrock') {
      for (let i = 0; i < 3; i += 1) {
        this.v.randomDirection().multiplyScalar(e.radius * 0.5)
        this.spawn({ kind: 'rock', p0: [e.pos.x + this.v.x, e.pos.y + this.v.y, e.pos.z + this.v.z], vel: [this.v.x * 3, this.v.y * 3, e.vel.z * 0.8 + 6], scale: 0.7 })
      }
    }
    if (e.drop) this.spawn({ kind: 'cell', pickupType: powerupForDrop(this.pickupDropIndex++), p0: [e.pos.x, e.pos.y, e.pos.z], vel: [0, 0, 12] })
    this.events.killed(e)
    e.hp = 0
    e.active = false
    e.collider.setEnabled(false)
  }

  /** Blast every hostile within `radius` (boss death, bombs). */
  blast(center: THREE.Vector3, radius: number): void {
    for (const e of this.list) if (e.active && e.kind !== 'cell' && e.pos.distanceTo(center) < radius) this.destroy(e)
  }

  update(dt: number): void {
    const a = this.arena
    const player = a.player
    for (const e of this.list) {
      if (!e.active) continue
      e.prev.copy(e.pos)
      e.age += dt
      e.flash = Math.max(0, e.flash - dt * 8)
      let done = false
      switch (e.motion) {
        case 'swoop': {
          const t = e.age / e.duration
          if (t >= 1) done = true
          const u = Math.min(1, t)
          const k0 = (1 - u) * (1 - u)
          const k1 = 2 * (1 - u) * u
          const k2 = u * u
          e.pos.set(e.p0.x * k0 + e.p1.x * k1 + e.p2.x * k2, e.p0.y * k0 + e.p1.y * k1 + e.p2.y * k2, e.p0.z * k0 + e.p1.z * k1 + e.p2.z * k2)
          break
        }
        case 'hold': {
          const t = e.age
          if (t < PHASE_IN) e.pos.lerpVectors(e.p0, e.p1, easeOut(t / PHASE_IN))
          else if (t < PHASE_IN + e.hold) {
            const h = t - PHASE_IN
            e.pos.copy(e.p1)
            e.pos.x += Math.sin(h * 0.9 + e.id) * 1.6
            e.pos.y += Math.sin(h * 1.3 + e.id * 2) * 0.8
          } else {
            const o = (t - PHASE_IN - e.hold) / PHASE_OUT
            if (o >= 1) done = true
            this.v.copy(e.p1)
            this.v.x += Math.sin(e.hold * 0.9 + e.id) * 1.6
            this.v.y += Math.sin(e.hold * 1.3 + e.id * 2) * 0.8
            e.pos.lerpVectors(this.v, e.p2, easeIn(Math.min(1, o)))
          }
          break
        }
        case 'drift': {
          if (e.kind === 'cell') {
            // Repair cells drift in and get pulled towards the ship.
            this.v.subVectors(player, e.pos)
            const d = this.v.length()
            if (d < 11) e.vel.addScaledVector(this.v.normalize(), 70 * dt)
            e.vel.multiplyScalar(Math.exp(-1.5 * dt))
            if (d < 1.8 && a.playerAlive) {
              this.events.collected(e)
              done = true
            }
          }
          e.pos.addScaledVector(e.vel, dt)
          if (e.pos.z > 16) done = true
          break
        }
        case 'thrown': {
          // Ore chunks: mild homing on x/y until they pass the ship.
          if (e.pos.z < player.z - 8) {
            const k = 1.6 * dt
            e.vel.x += (player.x - e.pos.x) * k
            e.vel.y += (player.y - e.pos.y) * k
          }
          e.pos.addScaledVector(e.vel, dt)
          if (e.pos.z > 16) done = true
          break
        }
      }
      // Orientation: combat drones face the ship and bank with lateral motion.
      if (e.kind === 'mite' || e.kind === 'chisel' || e.kind === 'lantern') {
        this.v.subVectors(player, e.pos)
        this.v.z = Math.abs(this.v.z) + 20
        this.v.normalize()
        this.q.setFromUnitVectors(this.fwd, this.v)
        const lateral = (e.pos.x - e.prev.x) / Math.max(dt, 1e-4)
        this.w.set(0, 0, 1)
        const roll = e.kind === 'mite' ? e.age * 2.5 : e.kind === 'lantern' ? e.age * 0.8 : THREE.MathUtils.clamp(-lateral * 0.05, -0.7, 0.7)
        e.quat.copy(this.q).multiply(this.rollQ.setFromAxisAngle(this.w, roll))
      } else e.quat.multiply(e.spin)
      if (!done) this.fireLogic(e, dt)
      if (!done && e.kind !== 'cell' && a.playerAlive) {
        const hitR = e.radius * 0.8 + CONFIG.ship.hitRadius
        if (e.pos.distanceToSquared(player) < hitR * hitR) {
          const dmg = e.kind === 'mine' ? CONFIG.damage.mine : e.kind === 'rock' || e.kind === 'bigrock' ? CONFIG.damage.rock : e.kind === 'chunk' ? CONFIG.damage.heavy : CONFIG.damage.ram
          if (a.hurtPlayer(dmg, e.pos, 'ram')) {
            if (e.kind !== 'lantern' && e.kind !== 'bigrock') {
              this.destroy(e)
              continue
            }
          }
        }
      }
      if (done) e.active = false
      else e.body.setNextKinematicTranslation({ x: e.pos.x, y: e.pos.y, z: e.pos.z })
    }
    let w = 0
    for (let i = 0; i < this.list.length; i += 1) {
      const e = this.list[i]
      if (e.active) this.list[w++] = e
      else this.release(e)
    }
    this.list.length = w
  }

  private fireLogic(e: Enemy, dt: number): void {
    if (e.fire === 'none' || !this.arena.playerAlive) return
    // Only fire from a readable distance and while in front of the ship.
    if (e.pos.z > -16 || e.pos.z < -120) return
    if (e.motion === 'hold' && (e.age < PHASE_IN * 0.7 || e.age > PHASE_IN + e.hold)) return
    e.fireTimer -= dt
    if (e.fireTimer > 0) return
    const b = this.arena.bullets
    const p = this.arena.player
    const h = e.heat
    const muzzle = this.v.copy(e.pos)
    muzzle.z += e.radius * 0.6
    switch (e.fire) {
      case 'aimed':
        b.shoot(muzzle, this.w.subVectors(p, muzzle), 30 * h, { color: 'magenta', needle: true, radius: 0.38 })
        e.fireTimer = 1.9 + Math.random() * 0.6
        break
      case 'burst':
        b.shoot(muzzle, this.w.subVectors(p, muzzle), 34 * h, { color: 'orange', needle: true, radius: 0.36 })
        e.fireCount += 1
        e.fireTimer = e.fireCount % 3 === 0 ? 1.9 : 0.14
        break
      case 'fan3':
        b.fan(muzzle, p, 26 * h, 3, 0.34, { color: 'orange' })
        e.fireTimer = 1.7
        break
      case 'fan5':
        b.fan(muzzle, p, 24 * h, 5, 0.62, { color: 'magenta' }, e.fireCount % 2 ? 0.6 : 0)
        e.fireCount += 1
        e.fireTimer = 1.6
        break
      case 'ring':
        b.ring(muzzle, p, 19 * h, 14, 5.5, e.fireCount * 0.3, { color: 'violet', radius: 0.46 })
        e.fireCount += 1
        e.fireTimer = 2.1
        break
      case 'spiral': {
        const phase = e.fireCount * 0.42
        b.ring(muzzle, p, 17 * h, 3, 7, phase, { color: e.fireCount % 12 < 6 ? 'orange' : 'magenta', radius: 0.44 })
        e.fireCount += 1
        e.fireTimer = e.fireCount % 24 === 0 ? 1.4 : 0.11
        break
      }
    }
    this.arena.audio.play('enemyShot')
  }

  render(alpha: number, time: number): void {
    for (const k of Object.keys(this.batches) as EnemyKind[]) {
      this.batches[k].body.begin()
      this.batches[k].glow.begin()
    }
    for (const e of this.list) {
      if (!e.active) continue
      const b = this.batches[e.kind]
      this.v.lerpVectors(e.prev, e.pos, alpha)
      const pop = Math.min(1, e.age * 4)
      const sc = e.scale * (e.kind === 'rock' || e.kind === 'bigrock' ? STATS[e.kind].radius * 0.95 : 1) * (0.4 + 0.6 * pop)
      this.s.setScalar(sc)
      const blink = e.kind === 'mine' ? (Math.sin(time * 10 + e.id) > 0.3 ? 0.5 : 0) : e.kind === 'cell' ? 0.25 + Math.sin(time * 8) * 0.2 : 0
      const pickupColor = e.kind === 'cell' ? POWERUP_COLORS[e.pickupType] : undefined
      b.body.push(this.v, e.quat, this.s, pickupColor, Math.max(e.flash, blink))
      b.glow.push(this.v, e.quat, this.s, pickupColor)
    }
    for (const k of Object.keys(this.batches) as EnemyKind[]) {
      this.batches[k].body.end()
      this.batches[k].glow.end()
    }
  }
}

export { STATS as ENEMY_STATS }
