import * as THREE from 'three'
import type { RAPIER } from '../engine/physics'
import { Eases, type Timeline, TimelineBuilder } from '../engine/timeline'
import { GROUP_TARGET, type Arena } from './arena'
import { CONFIG } from './config'
import type { Enemies } from './enemies'
import { HALF, Kit, PALETTE, box, cyl, ico, tet } from './models'
import { hazardTexture } from './textures'

export type BossState = 'hidden' | 'intro' | 'p1' | 'trans12' | 'p2' | 'trans23' | 'p3' | 'dying' | 'dead'
type PartName = 'hull' | 'drill' | 'grinderL' | 'grinderR' | 'core'
type Part = { name: PartName; collider: RAPIER.Collider; offset: THREE.Vector3; hp: number; maxHp: number; target: boolean; flash: number }

export type BossHooks = {
  banner(key: string, sub: string, style: 'phase' | 'warning' | 'clear'): void
  phaseChanged(state: BossState): void
  defeated(): void
  roll(): void
}

const HP = { grinder: 105, core: 230, heart: 300 }
const BASE = new THREE.Vector3(0, 1.5, -68)

type Beam = {
  mesh: THREE.Group
  core: THREE.Mesh
  outer: THREE.Mesh
  tele: THREE.Mesh
  state: 'off' | 'tele' | 'fire'
  t: number
  tele_t: number
  fire_t: number
  mode: 'h' | 'v' | 'spin'
  a0: number
  a1: number
  level: number
  index: number
  target: THREE.Vector3
}

/**
 * BOREWARDEN — an autonomous deep-core mining platform. Three phases:
 *   I  GRIND     two grinder arms are the weak points (sweeping spark streams, drill spirals, ore lobs)
 *   II EXCAVATE  the drill opens to expose the auger core (laser sweeps, ore showers, gapped rings)
 *   III MELTDOWN the overheated heart (nova spirals, drill lunge with a shock ring, laser pinwheel)
 * Attack loops and cutscenes are engine Timelines; the boss only provides the verbs.
 */
export class Boss {
  readonly root = new THREE.Group()
  state: BossState = 'hidden'
  private stateTime = 0
  private readonly parts: Part[] = []
  private body!: RAPIER.RigidBody
  private readonly bodyMat: THREE.MeshStandardMaterial
  private readonly glowMat: THREE.MeshBasicMaterial
  private readonly discMat: THREE.MeshStandardMaterial
  private readonly drillSpin = new THREE.Group()
  private readonly petals: THREE.Group[] = []
  private readonly discs: THREE.Group[] = []
  private readonly arms: THREE.Mesh[] = []
  private readonly plates: THREE.Mesh[] = []
  private readonly coreMesh: THREE.Mesh
  private readonly coreMat: THREE.MeshBasicMaterial
  private readonly visor: THREE.Mesh
  private readonly cones: THREE.Mesh[] = []
  private readonly light: THREE.PointLight
  private readonly beams: Beam[] = []
  private attack?: Timeline<Boss>
  private scene?: Timeline<Boss>
  private open = 0
  private drillRate = 1
  private heat = 0
  private lungeZ = 0
  private readonly v = new THREE.Vector3()
  private readonly w = new THREE.Vector3()
  private readonly u = new THREE.Vector3()
  private readonly prevPos = new THREE.Vector3()
  private readonly curPos = new THREE.Vector3()
  alarm = 0
  /** Frame flash on any hit. */
  private hitFlash = 0

  constructor(private readonly arena: Arena, private readonly enemies: Enemies, private readonly hooks: BossHooks) {
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.45 })
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
    this.discMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.7 })
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#ff7a2f', toneMapped: false })
    const P = PALETTE

    // Chassis: octagonal hull with ribs, collar and engines.
    const hull = new Kit()
    hull.add(cyl(9.5, 11.5, 20, 8), P.hull, { p: [0, 0, -2], r: [HALF, 0, Math.PI / 8] })
    hull.add(cyl(7.8, 9.5, 3, 8), P.steel, { p: [0, 0, 9.5], r: [HALF, 0, Math.PI / 8] })
    for (let i = 0; i < 4; i += 1) hull.add(cyl(11.8, 11.8, 0.9, 8), P.graphite, { p: [0, 0, -9 + i * 4.2], r: [HALF, 0, Math.PI / 8] })
    hull.add(box(6, 4, 10), P.steel, { p: [0, 10.5, -4] })
    hull.add(box(9, 2.5, 6), P.rust, { p: [0, 12.6, -5] })
    hull.pair(() => cyl(1.1, 1.5, 7, 6), P.graphite, { p: [4.2, 12, -9] })
    hull.pair(() => cyl(1.5, 1.5, 0.6, 6), P.rust, { p: [4.2, 15.6, -9] })
    hull.add(box(14, 3, 16), P.graphite, { p: [0, -10.5, -3] })
    hull.pair(() => box(2.5, 5, 14), P.steel, { p: [8, -9, -3] })
    hull.pair(() => box(3, 3, 3), P.steel, { p: [9, 0, 2] })
    for (let i = 0; i < 6; i += 1) hull.add(box(2.2, 2.2, 1.2), P.graphite, { p: [Math.cos((i / 6) * Math.PI * 2) * 7, Math.sin((i / 6) * Math.PI * 2) * 7, -13] })
    const hg = new Kit()
    hg.pair(() => cyl(0.9, 0.9, 0.5, 6), '#ffb347', { p: [4.2, 15.95, -9] }, true)
    for (let i = 0; i < 6; i += 1) hg.add(cyl(0.8, 0.8, 0.3, 6), '#58d6ff', { p: [Math.cos((i / 6) * Math.PI * 2) * 7, Math.sin((i / 6) * Math.PI * 2) * 7, -13.7], r: [HALF, 0, 0] }, true)
    hg.pair(() => box(1.4, 0.6, 0.4), '#ffe08a', { p: [5.5, -9.5, 5.2] }, true)
    hg.pair(() => box(1.4, 0.6, 0.4), '#ffe08a', { p: [2.2, -9.5, 5.2] }, true)
    const hullParts = hull.build()
    const glowParts = hg.build()
    this.root.add(new THREE.Mesh(hullParts.body, this.bodyMat), new THREE.Mesh(glowParts.glow, this.glowMat))

    // Hazard-striped armour plates (shed in phase III).
    const plateMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.55, metalness: 0.3, flatShading: true })
    const platePos: [number, number, number, number][] = [
      [0, 9.6, 2, 0], [0, -9.6, 2, Math.PI], [9.2, 3.6, 1, -1.1], [-9.2, 3.6, 1, 1.1], [9.2, -3.6, 1, -2.0], [-9.2, -3.6, 1, 2.0],
    ]
    for (const [x, y, z, rz] of platePos) {
      const g = new THREE.BoxGeometry(6, 0.8, 7)
      const uv = g.getAttribute('uv') as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3)
      const m = new THREE.Mesh(g, plateMat)
      m.position.set(x, y, z)
      m.rotation.z = rz
      this.plates.push(m)
      this.root.add(m)
    }

    // Visor: the laser emitter above the drill.
    const visor = new Kit().add(box(8, 1.1, 0.6), '#ff3344', {}, true).build()
    this.visor = new THREE.Mesh(visor.glow, this.glowMat)
    this.visor.position.set(0, 6.4, 10.4)
    this.root.add(this.visor)

    // Drill: four petals (quarter cones) on a spinning hub; they hinge open in phase II.
    this.drillSpin.position.set(0, 0, 11)
    this.root.add(this.drillSpin)
    for (let i = 0; i < 4; i += 1) {
      const side = new THREE.Group()
      side.rotation.z = (i * Math.PI) / 2
      const pivot = new THREE.Group()
      pivot.position.set(0, 0.3, 0)
      const k = new Kit()
      const g = new THREE.ConeGeometry(6.2, 14, 4, 1, false, (3 * Math.PI) / 4, Math.PI / 2)
      g.translate(0, 7, 0)
      k.add(g, i % 2 ? P.steel : '#6b6f8e', { r: [HALF, 0, 0] })
      const slant = Math.atan2(6.2, 14)
      for (const f of [0.15, 0.45, 0.72]) k.add(box(3.4 * (1 - f) + 0.4, 0.5, 1.2), P.mining, { p: [0, 6.2 * (1 - f) * 0.72 + 0.2, 14 * f], r: [-slant, 0, 0] })
      k.add(tet(0.7), P.mining, { p: [0, 0.6, 13.5] })
      const parts = k.build()
      pivot.add(new THREE.Mesh(parts.body, this.bodyMat))
      side.add(pivot)
      this.drillSpin.add(side)
      this.petals.push(pivot)
    }
    // Core (auger core in II, heart in III).
    this.coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(3.3, 1), this.coreMat)
    this.coreMesh.position.set(0, 0, 9.5)
    this.root.add(this.coreMesh)
    const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(3.9, 0), new THREE.MeshStandardMaterial({ color: '#2c2f45', wireframe: true }))
    this.coreMesh.add(cage)

    // Grinder arms with spinning toothed discs (phase I weak points).
    for (const sx of [-1, 1]) {
      const shoulder = new THREE.Vector3(9 * sx, 0, 2)
      const hub = new THREE.Vector3(17 * sx, -1, 9)
      const len = shoulder.distanceTo(hub)
      const ak = new Kit()
      ak.add(box(2.2, 2.6, len), P.steel)
      ak.add(box(2.6, 0.6, len * 0.8), P.mining, { p: [0, 1.5, 0] })
      const arm = new THREE.Mesh(ak.build().body, this.bodyMat)
      arm.position.copy(shoulder).lerp(hub, 0.5)
      arm.lookAt(this.v.copy(hub))
      this.arms.push(arm)
      this.root.add(arm)
      const disc = new THREE.Group()
      disc.position.copy(hub)
      const dk = new Kit()
      dk.add(cyl(4.3, 4.3, 0.9, 14), '#8a8fae', { r: [HALF, 0, 0] })
      dk.add(cyl(2.2, 2.2, 1.3, 8), P.graphite, { r: [HALF, 0, 0] })
      for (let t = 0; t < 14; t += 1) {
        const a = (t / 14) * Math.PI * 2
        dk.add(tet(0.9), '#d9dcef', { p: [Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0], r: [0, 0, a], s: [1, 0.6, 0.5] })
      }
      const dp = dk.build()
      disc.add(new THREE.Mesh(dp.body, this.discMat))
      const hubGlow = new Kit().add(ico(1.2, 0), '#ff3344', { p: [0, 0, 0.8] }, true).build()
      disc.add(new THREE.Mesh(hubGlow.glow, this.glowMat))
      this.discs.push(disc)
      this.root.add(disc)
    }

    // Floodlight cones under the chassis.
    const coneMat = new THREE.MeshBasicMaterial({ color: '#ffe7b0', transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    for (const x of [-5.5, -2.2, 2.2, 5.5]) {
      // Apex at the lamp, widening downward and slightly back: reads as floodlights, never
      // sweeps across the camera.
      const c = new THREE.Mesh(new THREE.ConeGeometry(3.2, 18, 12, 1, true), coneMat)
      c.geometry.translate(0, -9, 0)
      c.position.set(x, -9.5, 5.5)
      c.rotation.x = 0.3
      this.cones.push(c)
      this.root.add(c)
    }
    this.light = new THREE.PointLight('#ff7a2f', 0, 90, 1.6)
    this.light.position.set(0, 0, 16)
    this.root.add(this.light)

    // Beams: three reusable laser beams.
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true)
    beamGeo.translate(0, 0.5, 0)
    beamGeo.rotateX(HALF)
    for (let i = 0; i < 4; i += 1) {
      const g = new THREE.Group()
      const core = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#fff4f0', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
      const outer = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ff2a5a', toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
      const tele = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: '#ff3344', toneMapped: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
      g.add(core, outer, tele)
      g.visible = false
      this.beams.push({ mesh: g, core, outer, tele, state: 'off', t: 0, tele_t: 1, fire_t: 2, mode: 'h', a0: 0, a1: 0, level: 0, index: i, target: new THREE.Vector3() })
    }
    this.root.visible = false
  }

  /** Beams are separate from the root so they are not affected by the boss sway. */
  get beamObjects(): THREE.Object3D[] {
    return this.beams.map(b => b.mesh)
  }

  /** Create colliders (after physics is ready). */
  attachPhysics(): void {
    const ph = this.arena.physics
    this.body = ph.addKinematicBody({ x: 0, y: -500, z: -200 })
    const add = (name: PartName, collider: RAPIER.Collider, offset: THREE.Vector3, hp: number) => {
      collider.setEnabled(false)
      this.parts.push({ name, collider, offset, hp, maxHp: hp, target: false, flash: 0 })
    }
    add('hull', ph.attachBox(this.body, { x: 21, y: 20, z: 18 }, { x: 0, y: 0, z: -3 }, GROUP_TARGET), new THREE.Vector3(0, 0, 6), 1)
    add('drill', ph.attachBall(this.body, 5.6, { x: 0, y: 0, z: 15 }, GROUP_TARGET), new THREE.Vector3(0, 0, 15), 1)
    add('grinderL', ph.attachBall(this.body, 4.6, { x: -17, y: -1, z: 9.5 }, GROUP_TARGET), new THREE.Vector3(-17, -1, 9.5), HP.grinder)
    add('grinderR', ph.attachBall(this.body, 4.6, { x: 17, y: -1, z: 9.5 }, GROUP_TARGET), new THREE.Vector3(17, -1, 9.5), HP.grinder)
    add('core', ph.attachBall(this.body, 3.8, { x: 0, y: 0, z: 10 }, GROUP_TARGET), new THREE.Vector3(0, 0, 10), HP.core)
  }

  private part(name: PartName): Part {
    return this.parts.find(p => p.name === name)!
  }

  partFor(handle: number): Part | undefined {
    return this.parts.find(p => p.collider.handle === handle)
  }

  get active(): boolean {
    return this.state !== 'hidden' && this.state !== 'dead'
  }

  get fighting(): boolean {
    return this.state === 'p1' || this.state === 'p2' || this.state === 'p3'
  }

  /** Phase-relative health 0..1 for the HUD, plus phase index 1..3. */
  get health(): { phase: number; fraction: number; total: number } {
    const g = (this.part('grinderL').hp + this.part('grinderR').hp) / (HP.grinder * 2)
    const c = this.part('core')
    if (this.state === 'intro' || this.state === 'p1') return { phase: 1, fraction: g, total: (2 + g) / 3 }
    if (this.state === 'trans12' || this.state === 'p2') return { phase: 2, fraction: this.state === 'p2' ? c.hp / HP.core : 1, total: (1 + (this.state === 'p2' ? c.hp / HP.core : 1)) / 3 }
    if (this.state === 'trans23' || this.state === 'p3') return { phase: 3, fraction: this.state === 'p3' ? c.hp / HP.heart : 1, total: (this.state === 'p3' ? c.hp / HP.heart : 1) / 3 }
    return { phase: 3, fraction: 0, total: 0 }
  }

  partAlive(name: PartName): boolean {
    return this.part(name).hp > 0
  }

  /** World (rig-space) position of a part. */
  partPos(name: PartName, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.part(name).offset).applyQuaternion(this.root.quaternion).add(this.root.position)
  }

  reset(): void {
    this.state = 'hidden'
    this.root.visible = false
    for (const p of this.parts) {
      p.collider.setEnabled(false)
      p.hp = p.maxHp
      p.target = false
      p.flash = 0
    }
    for (const b of this.beams) {
      b.state = 'off'
      b.mesh.visible = false
    }
    for (const d of this.discs) d.visible = true
    for (const a of this.arms) a.visible = true
    for (const pl of this.plates) pl.visible = true
    for (const pt of this.petals) pt.parent!.visible = true
    this.coreMesh.visible = true
    this.open = 0
    this.heat = 0
    this.lungeZ = 0
    this.attack = undefined
    this.scene = undefined
    this.alarm = 0
    this.arena.bullets.speedScale = 1
    this.body?.setNextKinematicTranslation({ x: 0, y: -500, z: -200 })
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────
  /** Rise into view; the level calls this after the warning. */
  startIntro(): void {
    this.reset()
    this.setState('intro')
    this.root.visible = true
    this.root.position.set(0, -46, -140)
    this.prevPos.copy(this.root.position)
    this.curPos.copy(this.root.position)
    this.drillRate = 0.3
    this.scene = new TimelineBuilder<Boss>()
      .tween(4.2, (b, t) => b.root.position.lerpVectors(this.v.set(0, -46, -140), BASE, t), { ease: Eases.outQuad })
      .at(1.2).call(b => b.arena.audio.play('bossRoar'))
      .at(2.4).call(b => {
        b.arena.impact.shake(0.5)
        b.drillRate = 3
        b.arena.audio.play('drillRev')
      })
      .at(4.3).call(b => b.hooks.banner('boss.name', 'boss.title', 'warning'))
      .at(5.2).call(b => b.beginPhase('p1'))
      .build()
  }

  private beginPhase(state: 'p1' | 'p2' | 'p3'): void {
    this.setState(state)
    const g = this.part('grinderL')
    const gr = this.part('grinderR')
    const core = this.part('core')
    const hull = this.part('hull')
    const drill = this.part('drill')
    hull.collider.setEnabled(true)
    if (state === 'p1') {
      g.target = gr.target = true
      g.collider.setEnabled(true)
      gr.collider.setEnabled(true)
      drill.collider.setEnabled(true)
      this.attack = this.phase1()
    } else if (state === 'p2') {
      drill.collider.setEnabled(false)
      core.hp = core.maxHp = HP.core
      core.target = true
      core.collider.setEnabled(true)
      this.attack = this.phase2()
    } else {
      core.hp = core.maxHp = HP.heart
      core.target = true
      core.collider.setEnabled(true)
      this.attack = this.phase3()
    }
  }

  private setState(s: BossState): void {
    this.state = s
    this.stateTime = 0
    this.hooks.phaseChanged(s)
  }

  // ─── attack loops ──────────────────────────────────────────────────────
  private phase1(): Timeline<Boss> {
    return new TimelineBuilder<Boss>()
      .wait(0.6)
      .every(0.085, 26, (b, i) => b.grinderSpray(-1, i))
      .wait(0.35)
      .every(0.085, 26, (b, i) => b.grinderSpray(1, i))
      .wait(0.8)
      .call(b => b.chargeDrill())
      .wait(0.9)
      .every(0.08, 34, (b, i) => b.drillSpiral(i))
      .wait(1.0)
      .call(b => b.lobChunks(3))
      .wait(1.6)
      .every(0.55, 4, (b, i) => b.grinderRings(i))
      .wait(1.4)
      .build({ loop: true })
  }

  private phase2(): Timeline<Boss> {
    return new TimelineBuilder<Boss>()
      .wait(0.8)
      .call(b => b.beamSweep('h'))
      .wait(3.3)
      .every(0.42, 6, (b, i) => b.coreRing(i, 18))
      .wait(0.6)
      .every(0.13, 20, (b, i) => b.oreShower(i))
      .wait(0.9)
      .call(b => b.beamSweep('v'))
      .wait(3.3)
      .every(0.22, 9, (b, i) => b.visorBurst(i))
      .wait(0.5)
      .call(b => b.lobChunks(4))
      .wait(1.8)
      .build({ loop: true })
  }

  private phase3(): Timeline<Boss> {
    return new TimelineBuilder<Boss>()
      .wait(0.8)
      .every(0.09, 40, (b, i) => b.novaSpiral(i))
      .wait(0.8)
      .call(b => b.lunge())
      .wait(4.4)
      .call(b => b.beamPinwheel())
      .every(0.6, 9, (b, i) => b.coreRing(i, 16))
      .wait(1.2)
      .every(0.14, 16, (b, i) => b.oreShower(i))
      .wait(0.6)
      .every(0.2, 10, (b, i) => b.visorBurst(i))
      .wait(1.0)
      .build({ loop: true })
  }

  // ─── verbs used by the timelines ───────────────────────────────────────
  private grinderSpray(side: number, i: number): void {
    if (!this.part(side < 0 ? 'grinderL' : 'grinderR').target) return
    const o = this.partPos(side < 0 ? 'grinderL' : 'grinderR', this.v)
    o.z += 2
    const p = this.arena.player
    const sweep = (i / 25) * 2 - 1
    this.w.set(p.x + sweep * 11 * -side, p.y + Math.sin(i * 0.5) * 2.5, p.z)
    this.arena.bullets.fan(o, this.w, 25, 3, 0.08, { color: 'orange', radius: 0.4 })
    if (i % 3 === 0) this.arena.audio.play('enemyShot')
    this.arena.fx.spark(o, this.u.set((Math.random() - 0.5) * 20, (Math.random() - 0.2) * 16, 18), '#ffd35c', 0.35)
  }

  private chargeDrill(): void {
    this.drillRate = 6
    this.arena.audio.play('charge')
    const tip = this.partPos('drill', this.v)
    tip.z += 8
    this.arena.fx.flare(tip, 9, '#ff3d8e', 0.9, -0.6)
  }

  private drillSpiral(i: number): void {
    const tip = this.partPos('drill', this.v)
    tip.z += 8
    const target = this.w.copy(this.arena.player).setX(this.arena.player.x * 0.4).setY(this.arena.player.y * 0.4)
    this.arena.bullets.ring(tip, target, 17, 3, 7.5, i * 0.31, { color: 'magenta', radius: 0.44 })
    this.arena.bullets.ring(tip, target, 17, 3, 7.5, -i * 0.31 + 0.5, { color: 'violet', radius: 0.44 })
    if (i % 6 === 3) this.arena.bullets.fan(tip, this.arena.player, 30, 3, 0.06, { color: 'red', needle: true, radius: 0.38 })
    if (i % 2 === 0) this.arena.audio.play('enemyShot')
    if (i === 33) this.drillRate = 1.5
  }

  private lobChunks(n: number): void {
    const p = this.arena.player
    for (let k = 0; k < n; k += 1) {
      const o = this.v.set(-5 + (k / Math.max(1, n - 1)) * 10, 11, this.root.position.z - 3).add(this.u.set(this.root.position.x, this.root.position.y - 1.5, 0))
      const tx = p.x + (k - (n - 1) / 2) * 3.5
      const ty = p.y + (Math.random() - 0.5) * 2
      const t = 2.6
      this.enemies.spawn({ kind: 'chunk', motion: 'thrown', p0: [o.x, o.y, o.z], vel: [(tx - o.x) / t, (ty - o.y) / t, (p.z - o.z) / t] })
    }
    this.arena.audio.play('lob')
  }

  private grinderRings(i: number): void {
    for (const name of ['grinderL', 'grinderR'] as const) {
      if (!this.part(name).target) continue
      const o = this.partPos(name, this.v)
      o.z += 2
      this.arena.bullets.ring(o, this.arena.player, 19, 16, 5, i * 0.2, { color: 'red', radius: 0.42 })
      // Aimed needles through the ring's hole: sitting still in the centre is not safe.
      this.arena.bullets.fan(o, this.arena.player, 27, 3, 0.07, { color: 'red', needle: true, radius: 0.38 })
    }
    this.arena.audio.play('enemyShot')
  }

  private coreRing(i: number, count: number): void {
    const o = this.partPos('core', this.v)
    o.z += 3
    this.arena.bullets.ring(o, this.arena.player, 18, count, 6.5, i * 0.17, { color: this.state === 'p3' ? 'hot' : 'violet', radius: 0.46 }, (i * 5) % count)
    if (i % 2 === 0) this.arena.bullets.fan(o, this.arena.player, 28, 1, 0, { color: 'red', needle: true, radius: 0.4 })
    this.arena.audio.play('enemyShot')
  }

  private oreShower(i: number): void {
    const o = this.v.set(this.root.position.x + (Math.random() - 0.5) * 8, this.root.position.y + 12, this.root.position.z - 2)
    const tx = (Math.random() * 2 - 1) * CONFIG.ship.boundsX * 1.1
    const ty = (Math.random() * 2 - 1) * CONFIG.ship.boundsY * 1.1
    this.arena.bullets.shoot(o, this.w.set(tx - o.x, ty - o.y, this.arena.player.z - o.z), 23, { color: 'orange', radius: 0.85, damage: CONFIG.damage.heavy })
    if (i % 4 === 0) this.arena.bullets.shoot(o, this.w.subVectors(this.arena.player, o), 26, { color: 'orange', radius: 0.85, damage: CONFIG.damage.heavy })
    if (i % 3 === 0) this.arena.audio.play('lob')
  }

  private visorBurst(i: number): void {
    const o = this.v.set(0, 6.4, 10.4).applyQuaternion(this.root.quaternion).add(this.root.position)
    this.arena.bullets.fan(o, this.arena.player, 33, 3, 0.2, { color: 'red', needle: true, radius: 0.4 }, i % 2 ? 1.2 : 0)
    this.arena.audio.play('enemyShot')
  }

  private novaSpiral(i: number): void {
    const o = this.partPos('core', this.v)
    o.z += 3
    const p = this.w.set(this.arena.player.x * 0.3, this.arena.player.y * 0.3, 0)
    this.arena.bullets.ring(o, p, 16, 3, 8, i * 0.26, { color: 'hot', radius: 0.44, curve: 0.25 })
    this.arena.bullets.ring(o, p, 16, 3, 8, -i * 0.26, { color: 'orange', radius: 0.44, curve: -0.25 })
    if (i % 8 === 0) this.arena.bullets.ring(o, this.arena.player, 21, 18, 5, i, { color: 'magenta', radius: 0.4 })
    if (i % 8 === 4) this.arena.bullets.fan(o, this.arena.player, 29, 3, 0.09, { color: 'red', needle: true, radius: 0.38 })
    if (i % 2 === 0) this.arena.audio.play('enemyShot')
  }

  private beamSweep(mode: 'h' | 'v'): void {
    const b = this.beams[0]
    const p = this.arena.player
    b.mode = mode
    b.state = 'tele'
    b.t = 0
    b.tele_t = 1.0
    b.fire_t = 1.9
    const dir = Math.random() < 0.5 ? 1 : -1
    if (mode === 'h') {
      b.level = THREE.MathUtils.clamp(p.y, -CONFIG.ship.boundsY, CONFIG.ship.boundsY)
      b.a0 = -16 * dir
      b.a1 = 16 * dir
    } else {
      b.level = THREE.MathUtils.clamp(p.x, -CONFIG.ship.boundsX, CONFIG.ship.boundsX)
      b.a0 = 10 * dir
      b.a1 = -10 * dir
    }
    // A second parallel beam narrows the escape lane.
    const b2 = this.beams[1]
    Object.assign(b2, { mode, state: 'tele', t: 0, tele_t: 1.0, fire_t: 1.9, a0: b.a0, a1: b.a1 })
    b2.level = b.level + (b.level > 0 ? -1 : 1) * (mode === 'h' ? 5.2 : 7.5)
    this.arena.audio.play('beamCharge')
  }

  private beamPinwheel(): void {
    const start = Math.random() * Math.PI
    for (let i = 0; i < 3; i += 1) {
      const b = this.beams[i]
      Object.assign(b, { mode: 'spin', state: 'tele', t: 0, tele_t: 1.1, fire_t: 5.2, a0: start + (i * Math.PI * 2) / 3, a1: 0.62, level: 0 })
    }
    this.arena.audio.play('beamCharge')
  }

  private lunge(): void {
    this.lungeZ = 0
    const tl = new TimelineBuilder<Boss>()
      .call(b => {
        b.drillRate = 8
        b.alarm = 1
        b.arena.audio.play('drillRev')
        b.hooks.roll()
      })
      .tween(1.1, (b, t) => (b.lungeZ = -4 * t), { advance: true })
      .tween(0.55, (b, t) => (b.lungeZ = -4 + 44 * t), { ease: Eases.inQuad, advance: true })
      .call(b => b.shockRing())
      .wait(0.5)
      .tween(1.4, (b, t) => (b.lungeZ = 40 * (1 - t)), { ease: Eases.inOutCubic })
      .every(0.3, 4, b => b.dropMine())
      .wait(0.4)
      .call(b => {
        b.alarm = 0
        b.drillRate = 2
      })
      .build()
    this.scene = tl
  }

  private shockRing(): void {
    const tip = this.partPos('drill', this.v)
    tip.z = -0.9
    const target = this.w.set(tip.x, tip.y, 40)
    // A shock ring that expands across the flight plane: roll through it (the gap is narrow on purpose).
    this.arena.bullets.ring(tip, target, 4, 44, 21, Math.random() * 6, { color: 'hot', radius: 0.5 }, Math.floor(Math.random() * 44))
    this.arena.impact.shake(0.9)
    this.arena.impact.hitStop(0.06)
    this.arena.impact.pulse(0.8)
    this.arena.fx.ring(tip, 26, '#ffd9a0', 0.6)
    this.arena.fx.explode(tip, 2.5, '#ffd9a0', '#ff7a2f', '#555a78')
    this.arena.audio.play('slam')
  }

  private dropMine(): void {
    const p = this.root.position
    const x = p.x + (Math.random() - 0.5) * 14
    const y = p.y - 6 + Math.random() * 4
    this.enemies.spawn({ kind: 'mine', p0: [x, y, p.z + 8], vel: [(this.arena.player.x - x) * 0.08, (this.arena.player.y - y) * 0.08, 19] })
  }

  // ─── damage ────────────────────────────────────────────────────────────
  /** Shot hit a boss collider. Returns true if it dealt damage (vs armour ping). */
  damage(part: Part, amount: number, at: THREE.Vector3): boolean {
    if (!this.fighting) {
      this.arena.fx.ping(at)
      return false
    }
    if (!part.target || part.hp <= 0) {
      this.arena.fx.ping(at)
      this.arena.audio.play('clink')
      return false
    }
    part.hp -= amount
    part.flash = 1
    this.hitFlash = Math.min(1, this.hitFlash + 0.25)
    this.arena.fx.hit(at, part.name === 'core' ? '#ffd9a0' : '#ff8a2a', undefined, 5)
    this.arena.audio.play('hitBoss')
    if (part.hp <= 0) this.partDestroyed(part)
    return true
  }

  private partDestroyed(part: Part): void {
    const a = this.arena
    const pos = this.partPos(part.name, this.v).clone()
    part.target = false
    part.collider.setEnabled(false)
    if (part.name === 'grinderL' || part.name === 'grinderR') {
      const idx = part.name === 'grinderL' ? 0 : 1
      this.discs[idx].visible = false
      this.arms[idx].visible = false
      a.fx.explode(pos, 4, '#ff8a2a', '#ffd35c', '#8a8fae')
      a.impact.hitStop(0.12)
      a.impact.shake(0.7)
      a.impact.flash('#ffe1b0', 0.5, 0.2)
      a.audio.play('explodeHuge')
      a.award(CONFIG.score.grinder, pos, true)
      if (this.part('grinderL').hp <= 0 && this.part('grinderR').hp <= 0) this.transition12()
    } else if (part.name === 'core') {
      a.award(this.state === 'p3' ? CONFIG.score.bossKill : CONFIG.score.auger, pos, true)
      if (this.state === 'p2') this.transition23()
      else this.die()
    }
  }

  private cancelBullets(): void {
    const a = this.arena
    a.bullets.cancelAll((pos, color) => {
      a.fx.flare(pos, 1.4, color, 0.35, 0.5)
    })
    for (const b of this.beams) {
      b.state = 'off'
      b.mesh.visible = false
    }
  }

  private transition12(): void {
    this.attack = undefined
    this.setState('trans12')
    this.cancelBullets()
    const a = this.arena
    a.impact.slowMo(0.3, 1.0, 0.5)
    a.impact.pulse(1)
    this.scene = new TimelineBuilder<Boss>()
      .wait(0.8)
      .call(b => {
        b.arena.audio.play('bossRoar')
        b.arena.impact.shake(0.6)
        b.hooks.banner('boss.phase2', 'boss.phase2.sub', 'phase')
      })
      .tween(2.2, (b, t) => (b.open = t), { ease: Eases.outBack })
      .wait(0.4)
      .call(b => b.arena.audio.play('charge'))
      .wait(1.6)
      .call(b => b.beginPhase('p2'))
      .build()
  }

  private transition23(): void {
    this.attack = undefined
    this.setState('trans23')
    this.cancelBullets()
    const a = this.arena
    const core = this.partPos('core', this.v).clone()
    a.fx.explode(core, 5, '#ffd9a0', '#ff3d8e', '#555a78')
    a.impact.hitStop(0.2)
    a.impact.slowMo(0.25, 1.4, 0.6)
    a.impact.shake(1)
    a.impact.flash('#ffffff', 0.85, 0.35)
    a.audio.play('explodeHuge')
    this.scene = new TimelineBuilder<Boss>()
      .wait(0.6)
      .call(b => b.shedArmour())
      .wait(0.8)
      .call(b => {
        b.heat = 1
        b.arena.audio.play('bossRoar')
        b.arena.impact.shake(0.7)
        b.hooks.banner('boss.phase3', 'boss.phase3.sub', 'phase')
      })
      .wait(2.4)
      .call(b => b.beginPhase('p3'))
      .build()
  }

  private shedArmour(): void {
    const a = this.arena
    for (const plate of this.plates) {
      plate.visible = false
      const p = this.v.copy(plate.position).applyQuaternion(this.root.quaternion).add(this.root.position)
      for (let i = 0; i < 5; i += 1) a.fx.chunk(p, this.w.copy(plate.position).normalize().multiplyScalar(10 + Math.random() * 10).add(this.u.randomDirection().multiplyScalar(4)), '#e8b23a', 1.5, 2.2)
      a.fx.explode(p, 2, '#ff8a2a', '#ffd35c', '#e8b23a')
    }
    for (const petal of this.petals) {
      petal.parent!.visible = false
      const p = this.partPos('drill', this.v)
      for (let i = 0; i < 4; i += 1) a.fx.chunk(p, this.w.randomDirection().multiplyScalar(16).setZ(12), '#6b6f8e', 1.8, 2.4)
    }
    a.impact.shake(0.8)
    a.audio.play('explodeBig')
  }

  private die(): void {
    this.attack = undefined
    this.setState('dying')
    this.cancelBullets()
    const a = this.arena
    a.impact.hitStop(0.28)
    a.impact.slowMo(0.25, 2.6, 0.8)
    a.impact.flash('#ffffff', 0.7, 0.3)
    a.audio.play('explodeHuge')
    this.hooks.banner('boss.down', 'boss.down.sub', 'clear')
    const tl = new TimelineBuilder<Boss>()
      .every(0.16, 16, (b, i) => {
        const p = b.v.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 16 + 4).add(b.root.position)
        b.arena.fx.explode(p, 2 + Math.random() * 2.5, i % 2 ? '#ff8a2a' : '#ffd9a0', '#ff3d8e', '#555a78')
        b.arena.impact.shake(0.45)
        b.arena.audio.play(i % 3 === 0 ? 'explodeHuge' : 'explodeBig', i)
      })
      .call(b => b.finalBlast())
      .wait(1.8)
      .call(b => {
        b.setState('dead')
        b.hooks.defeated()
      })
      .build()
    this.scene = tl
  }

  private finalBlast(): void {
    const a = this.arena
    const p = this.root.position.clone()
    a.impact.hitStop(0.22)
    a.impact.flash('#ffffff', 1, 0.6)
    a.impact.shake(1)
    a.impact.pulse(1)
    for (let i = 0; i < 3; i += 1) a.fx.ring(p, 30 + i * 22, i ? '#ff8a2a' : '#ffffff', 0.7 + i * 0.25)
    a.fx.explode(p, 9, '#ffd9a0', '#ff7a2f', '#555a78')
    for (let i = 0; i < 26; i += 1) a.fx.chunk(p, this.w.randomDirection().multiplyScalar(14 + Math.random() * 20), i % 2 ? '#3b3656' : '#e8b23a', 2.4, 3)
    this.root.visible = false
    for (const part of this.parts) part.collider.setEnabled(false)
    this.body.setNextKinematicTranslation({ x: 0, y: -500, z: -200 })
    a.audio.play('bossDeath')
  }

  // ─── simulation ────────────────────────────────────────────────────────
  step(dt: number): void {
    if (this.state === 'hidden' || this.state === 'dead') return
    this.stateTime += dt
    this.prevPos.copy(this.root.position)
    if (this.scene) {
      this.scene.update(dt, this)
      if (this.scene.done) this.scene = undefined
    }
    const desperate = this.state === 'p3' && this.part('core').hp < HP.heart * 0.35
    this.arena.bullets.speedScale = desperate ? 1.12 : 1
    if (this.attack && this.fighting) this.attack.update(dt * (desperate ? 1.18 : 1), this)
    // Sway around the anchor (except during the intro rise).
    if (this.state !== 'intro') {
      const t = this.stateTime + (this.state === 'p3' ? 10 : 0)
      const amp = this.state === 'p3' ? 1.4 : this.state === 'dying' ? 0.5 : 1
      this.root.position.set(BASE.x + Math.sin(t * 0.33) * 4.2 * amp, BASE.y + Math.sin(t * 0.51) * 1.6 * amp, BASE.z + this.lungeZ)
      if (this.state === 'dying') this.root.position.x += (Math.random() - 0.5) * 0.8
    }
    this.root.rotation.set(Math.sin(this.stateTime * 0.4) * 0.04, Math.sin(this.stateTime * 0.33 + 1) * 0.06, Math.sin(this.stateTime * 0.27) * 0.05)
    this.root.updateMatrix()
    const rp = this.root.position
    this.body.setNextKinematicTranslation({ x: rp.x, y: rp.y, z: rp.z })
    const q = this.root.quaternion
    this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    this.curPos.copy(rp)
    for (const p of this.parts) p.flash = Math.max(0, p.flash - dt * 7)
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5)
    this.stepBeams(dt)
    // Meltdown ambience.
    if ((this.state === 'p3' || this.state === 'dying') && Math.random() < 0.35) {
      const p = this.v.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 16, (Math.random() - 0.3) * 14).add(rp)
      this.arena.fx.spark(p, this.w.randomDirection().multiplyScalar(12).setZ(10), '#ffb347', 0.6, 0.14)
    }
  }

  private stepBeams(dt: number): void {
    const origin = this.v.set(0, 6.4, 11).applyQuaternion(this.root.quaternion).add(this.root.position)
    const p = this.arena.player
    for (const b of this.beams) {
      if (b.state === 'off') continue
      b.t += dt
      if (b.state === 'tele' && b.t >= b.tele_t) {
        b.state = 'fire'
        b.t = 0
        this.arena.audio.play('beamFire')
        this.arena.impact.shake(0.3)
      } else if (b.state === 'fire' && b.t >= b.fire_t) {
        b.state = 'off'
        b.mesh.visible = false
        continue
      }
      const k = b.state === 'tele' ? 0 : Math.min(1, b.t / b.fire_t)
      if (b.mode === 'h') b.target.set(THREE.MathUtils.lerp(b.a0, b.a1, Eases.inOutCubic(k)), b.level, 6)
      else if (b.mode === 'v') b.target.set(b.level, THREE.MathUtils.lerp(b.a0, b.a1, Eases.inOutCubic(k)), 6)
      else {
        const a = b.a0 + (b.state === 'fire' ? b.t * b.a1 : 0)
        b.target.set(Math.cos(a) * 24, Math.sin(a) * 16, 6)
      }
      // Hit test against the segment origin → target.
      if (b.state === 'fire') {
        this.w.subVectors(b.target, origin)
        const len2 = this.w.lengthSq()
        const t = THREE.MathUtils.clamp(this.u.subVectors(p, origin).dot(this.w) / len2, 0, 1)
        this.u.copy(origin).addScaledVector(this.w, t)
        const r = 1.0 + CONFIG.ship.hitRadius
        if (this.u.distanceToSquared(p) < r * r) this.arena.hurtPlayer(CONFIG.damage.beam, this.u, 'beam')
        if (Math.random() < 0.5) this.arena.fx.spark(this.u.copy(origin).addScaledVector(this.w, 0.4 + Math.random() * 0.6), this.w.clone().normalize().multiplyScalar(-6).add(this.u.randomDirection().multiplyScalar(6)), '#ff9ab0', 0.3)
      }
      b.mesh.visible = true
      b.mesh.position.copy(origin)
      b.mesh.lookAt(this.w.copy(b.target).applyMatrix4(this.root.parent!.matrixWorld))
      const len = origin.distanceTo(b.target) + 10
      const fire = b.state === 'fire'
      const flicker = 0.85 + Math.random() * 0.3
      b.core.visible = fire
      b.outer.visible = fire
      b.tele.visible = !fire
      b.core.scale.set(0.35 * flicker, 0.35 * flicker, len)
      b.outer.scale.set(1.1 * flicker, 1.1 * flicker, len)
      b.tele.scale.set(0.07, 0.07, len)
      ;(b.tele.material as THREE.MeshBasicMaterial).opacity = Math.floor(b.t * 14) % 2 ? 0.8 : 0.25
    }
  }

  /** Visual animation (every rendered frame). */
  draw(alpha: number, frameSeconds: number, time: number): void {
    if (!this.root.visible) return
    this.root.position.lerpVectors(this.prevPos, this.curPos, alpha)
    this.drillSpin.rotation.z += frameSeconds * this.drillRate * 3
    for (const [i, d] of this.discs.entries()) d.rotation.z += frameSeconds * (i ? -1 : 1) * (this.state === 'p1' ? 7 : 3)
    for (const petal of this.petals) petal.rotation.x = -this.open * 0.95
    const core = this.part('core')
    const coreHeat = this.state === 'p3' || this.state === 'trans23' || this.state === 'dying' ? 1 : this.open
    const pulse = 0.75 + Math.sin(time * (this.state === 'p3' ? 14 : 6)) * 0.25
    this.coreMat.color.setRGB(1.2 + coreHeat * 1.4 + core.flash * 2, 0.45 + this.heat * 0.9 + core.flash * 2, 0.18 + this.heat * 0.5 + core.flash * 2).multiplyScalar(pulse)
    this.coreMesh.scale.setScalar(0.6 + coreHeat * 0.4 + core.flash * 0.1)
    this.light.intensity = (60 + coreHeat * 220) * pulse
    const gL = this.part('grinderL').flash
    const gR = this.part('grinderR').flash
    this.discMat.emissive.setRGB(Math.max(gL, gR) * 1.2, Math.max(gL, gR) * 0.5, 0.1 * Math.max(gL, gR))
    this.bodyMat.emissive.setRGB(this.hitFlash * 0.35 + this.alarm * 0.15 * pulse, this.hitFlash * 0.12, this.hitFlash * 0.08)
    for (const c of this.cones) {
      const m = c.material as THREE.MeshBasicMaterial
      m.color.set(this.alarm > 0.5 ? '#ff4a4a' : '#ffe7b0')
      c.rotation.z = Math.sin(time * 0.7 + c.position.x) * 0.3
    }
    ;(this.visor.material as THREE.MeshBasicMaterial).color.setScalar(1)
    this.visor.scale.y = this.beams.some(b => b.state === 'tele') ? 1.6 + Math.sin(time * 40) * 0.5 : 1
  }
}
