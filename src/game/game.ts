import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import { Impact } from '../engine/impact'
import type { Input } from '../engine/input'
import { Sequencer } from '../engine/music'
import { Physics } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import type { Timeline } from '../engine/timeline'
import { QUERY_SHOTS, type Arena } from './arena'
import { SOUNDTRACK, defineSounds } from './audio-content'
import { Boss, type BossState } from './boss'
import { EnemyBullets, PlayerShots, type EnemyBullet } from './bullets'
import { CONFIG } from './config'
import { Enemies, ENEMY_STATS, type Enemy, type SpawnSpec } from './enemies'
import { Environment, SpeedField } from './env'
import { Fx } from './fx'
import { buildStage, type Director } from './level'
import { Rail } from './rail'
import { addKill, addScore, createRun, graze, grade, hurt, repair, shield, shotFired, shotHit, tick, win, type Grade, type RunState } from './rules'
import { Ship } from './ship'
import { tuning } from './tuning'

export type GameMode = 'title' | 'playing' | 'paused' | 'ended'
export type PopupKind = 'score' | 'combo' | 'pickup' | 'hurt' | 'bonus'
export type BannerStyle = 'phase' | 'warning' | 'clear'

export type GameHooks = {
  popup(text: string, at: { x: number; y: number }, kind: PopupKind): void
  hurt(kind: 'shield' | 'hull'): void
  hint(key: string | null): void
  banner(key: string, sub: string, style: BannerStyle): void
  letterbox(on: boolean): void
  warning(on: boolean): void
  bossBar(on: boolean): void
  cue(key: string): void
  tutorialDone(): void
  end(run: RunState, info: { grade: Grade; checkpoint: boolean }): void
}

export type HudData = {
  score: number
  multiplier: number
  combo: number
  comboFraction: number
  hull: number
  shield: number
  rollReady: number
  grazes: number
  boss: { phase: number; fraction: number; total: number } | null
  reticle: { x: number; y: number; inner: { x: number; y: number }; locked: boolean; visible: boolean }
  lowHull: boolean
}

type CamMode = 'play' | 'launch' | 'boss' | 'title' | 'death' | 'victory'

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()

export class Game implements Arena, Director {
  mode: GameMode = 'title'
  run: RunState = createRun()
  time = 0
  reducedMotion = false
  tutorial = false
  readonly debug = { invincible: false, bot: false }
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly rig = new THREE.Group()
  readonly combat = new THREE.Group()
  readonly physics: Physics
  readonly impact: Impact
  readonly rail = new Rail()
  readonly env: Environment
  readonly speed: SpeedField
  readonly ship = new Ship()
  readonly fx: Fx
  readonly bullets: EnemyBullets
  readonly shots = new PlayerShots()
  readonly enemies: Enemies
  readonly boss: Boss
  readonly music: Sequencer
  private stage: Timeline<Director> = buildStage()
  private fireCooldown = 0
  private gunSide = 1
  private boost = 0
  private boostTarget = 0
  private camMode: CamMode = 'title'
  private camTime = 0
  private readonly camPos = new THREE.Vector3(0, 2, 10)
  private readonly camLook = new THREE.Vector3(0, 0, -30)
  private readonly camM = new THREE.Matrix4()
  private fov = 62
  private readonly reticle = { x: 0, y: 0.05 }
  private mouseAim = false
  private mouseIdle = 99
  private readonly aimPoint = new THREE.Vector3(0, 0, -90)
  private locked = false
  private checkpoint: { run: RunState; s: number } | null = null
  private deathTimer = -1
  private winTimer = -1
  private usedCheckpoint = false
  private lastMultiplier = 1
  private lowHullBeep = 0
  private endSent = false
  private readonly bossAim = { grinderL: new THREE.Vector3(), grinderR: new THREE.Vector3(), core: new THREE.Vector3() }

  constructor(private readonly renderer: Renderer, private readonly input: Input, readonly audio: Audio, private readonly hooks: GameHooks) {
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3200)
    this.scene.add(this.rig)
    this.rig.add(this.camera, this.combat)
    this.physics = new Physics(0)
    this.impact = new Impact({ overlayParent: document.getElementById('ui') ?? document.body, maxOffset: 0.55, maxRoll: 0.045 })
    const detail = renderer.detail
    this.env = new Environment(this.scene, this.rail, detail)
    this.speed = new SpeedField(detail)
    this.rig.add(this.speed.group)
    this.fx = new Fx(detail)
    this.bullets = new EnemyBullets(1600)
    this.enemies = new Enemies(this, {
      killed: e => this.onKilled(e),
      collected: e => this.onCollected(e),
    })
    this.boss = new Boss(this, this.enemies, {
      banner: (k, s, st) => this.banner(k, s, st),
      phaseChanged: s => this.onBossPhase(s),
      defeated: () => this.onBossDefeated(),
      roll: () => this.hooks.cue('cue.roll'),
    })
    this.boss.attachPhysics()
    this.combat.add(this.ship.group, ...this.ship.trailMeshes, this.enemies.group, this.boss.root, ...this.boss.beamObjects, this.shots.group, this.bullets.group, this.fx.group)
    defineSounds(audio)
    this.music = new Sequencer(audio, SOUNDTRACK)
    this.rail.reset(0)
    this.ship.reset()
  }

  // ─── Arena ─────────────────────────────────────────────────────────────
  get player(): THREE.Vector3 {
    return this.ship.pos
  }

  get playerAlive(): boolean {
    return this.ship.alive && this.mode !== 'title'
  }

  get railSpeed(): number {
    return this.rail.speed
  }

  get timeScale(): number {
    return this.impact.timeScale
  }

  hurtPlayer(amount: number, from: THREE.Vector3, kind: 'bullet' | 'ram' | 'beam' | 'drill'): boolean {
    if (!this.playerAlive || this.mode !== 'playing') return false
    if (this.ship.rolling) return false
    if (this.debug.invincible) return false
    const r = hurt(this.run, amount)
    if (r.blocked) return false
    this.run = r.state
    const dx = THREE.MathUtils.clamp(this.ship.pos.x - from.x, -1, 1)
    this.impact.kick(dx * 0.5, 0.25)
    if (r.hullDamage > 0) {
      this.audio.play('hullHit')
      this.impact.shake(kind === 'beam' ? 0.6 : 0.5)
      this.impact.hitStop(0.07)
      this.impact.flash('#ff2a3a', 0.45, 0.28)
      this.impact.pulse(0.7)
      this.ship.flashHit()
      this.fx.explode(this.ship.pos, 0.6, '#ff6a3a', '#ffd35c', '#ece6d6')
      this.hooks.hurt('hull')
    } else {
      this.audio.play('shieldHit')
      this.impact.shake(0.25)
      this.impact.flash('#4fe3ff', 0.22, 0.18)
      this.ship.flashShield()
      this.fx.hit(this.ship.pos, '#7ff6ff', undefined, 10)
      this.hooks.hurt('shield')
    }
    if (this.lastMultiplier > 1) this.popupAt('combo.break', this.ship.pos, 'hurt')
    this.lastMultiplier = 1
    if (r.died) this.onDeath()
    return true
  }

  award(base: number, at: THREE.Vector3, kill: boolean): void {
    if (this.mode !== 'playing') return
    let points: number
    if (kill) {
      const r = addKill(this.run, base)
      this.run = r.state
      points = r.points
      if (r.levelUp) {
        this.audio.play('combo', r.multiplier)
        this.popupAt(`×${r.multiplier}`, this.ship.pos, 'combo', true)
      }
      this.lastMultiplier = r.multiplier
    } else {
      const r = addScore(this.run, base)
      this.run = r.state
      points = r.points
    }
    if (points > 0) this.popupAt(`+${points}`, at, points >= 3000 ? 'bonus' : 'score', true)
  }

  // ─── Director ──────────────────────────────────────────────────────────
  spawn(spec: SpawnSpec): void {
    this.enemies.spawn(spec)
  }

  rock(big: boolean, lane: 'player' | 'random' = 'random'): void {
    const vz = this.rail.targetSpeed * 0.96
    const x = lane === 'player' ? this.ship.pos.x + (Math.random() - 0.5) * 3 : (Math.random() * 2 - 1) * 14
    const y = lane === 'player' ? this.ship.pos.y + (Math.random() - 0.5) * 2 : (Math.random() * 2 - 1) * 9
    const z = -250
    const scale = big ? 0.9 + Math.random() * 0.5 : 0.7 + Math.random() * 0.6
    this.enemies.spawn({ kind: big ? 'bigrock' : 'rock', p0: [x * 1.4, y * 1.4, z], vel: [-x * 0.06, -y * 0.06, vz], scale })
  }

  mine(): void {
    const vz = this.rail.targetSpeed * 0.9
    const x = (Math.random() * 2 - 1) * CONFIG.ship.boundsX
    const y = (Math.random() * 2 - 1) * CONFIG.ship.boundsY
    this.enemies.spawn({ kind: 'mine', p0: [x, y, -220], vel: [0, 0, vz] })
  }

  banner(key: string, sub: string, style: BannerStyle): void {
    this.hooks.banner(key, sub, style)
    this.audio.play('banner')
  }

  hint(key: string | null): void {
    this.hooks.hint(key)
  }

  setRail(kind: 'cruise' | 'boost' | 'boss'): void {
    this.rail.targetSpeed = kind === 'boost' ? CONFIG.rail.boost : kind === 'boss' ? CONFIG.rail.boss : CONFIG.rail.speed
    this.boostTarget = kind === 'boost' ? 1 : 0
  }

  setMusic(section: string): void {
    if (section === 'none') this.music.stop()
    else this.music.play(section)
  }

  hostiles(): number {
    return this.enemies.hostileCount
  }

  warning(on: boolean): void {
    this.hooks.warning(on)
    this.env.alarm = on ? 1 : 0
    if (on) this.audio.play('warning')
  }

  letterbox(on: boolean): void {
    this.hooks.letterbox(on)
  }

  cinematic(name: 'launch' | 'boss' | 'none'): void {
    this.camMode = name === 'none' ? 'play' : name
    this.camTime = 0
  }

  startBoss(): void {
    this.boss.startIntro()
    this.hooks.bossBar(true)
  }

  bossDefeated(): boolean {
    return this.boss.state === 'dead'
  }

  checkpointHere(): void {
    this.checkpoint = { run: { ...this.run }, s: this.rail.s }
  }

  tutorialFinished(): void {
    if (this.tutorial) this.hooks.tutorialDone()
    this.tutorial = false
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────
  private resetWorld(): void {
    this.enemies.clear()
    this.bullets.clear()
    this.shots.clear()
    this.fx.clear()
    this.boss.reset()
    this.impact.clear()
    this.ship.reset()
    this.hooks.bossBar(false)
    this.hooks.hint(null)
    this.hooks.warning(false)
    this.hooks.letterbox(false)
    this.env.alarm = 0
    this.deathTimer = -1
    this.winTimer = -1
    this.endSent = false
    this.lastMultiplier = 1
    this.fireCooldown = 0
    this.boost = this.boostTarget = 0
    this.bullets.speedScale = 1
  }

  start(tutorial: boolean): void {
    tuning.activate('run')
    this.resetWorld()
    this.tutorial = tutorial
    this.run = { ...createRun(), unranked: tuning.unranked }
    this.time = 0
    this.stage = buildStage()
    this.checkpoint = null
    this.usedCheckpoint = false
    this.rail.reset(this.rail.s)
    this.env.reset()
    this.mode = 'playing'
    this.reticle.x = 0
    this.reticle.y = 0.05
  }

  /** Retry from the boss checkpoint (score restored to what it was on arrival). */
  startFromCheckpoint(): boolean {
    if (!this.checkpoint) return false
    const cp = this.checkpoint
    tuning.activate('run')
    this.resetWorld()
    this.tutorial = false
    this.run = { ...cp.run, hull: CONFIG.hull.max, shield: CONFIG.shield.max, phase: 'playing', invulnerable: 0, unranked: cp.run.unranked || tuning.unranked }
    this.stage = buildStage()
    this.stage.seek('boss')
    this.usedCheckpoint = true
    this.mode = 'playing'
    return true
  }

  get hasCheckpoint(): boolean {
    return this.checkpoint !== null
  }

  pause(): void {
    if (this.mode !== 'playing') return
    this.mode = 'paused'
    this.audio.duckMusic(0.3)
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.audio.duckMusic(1)
  }

  toTitle(): void {
    this.resetWorld()
    this.mode = 'title'
    this.run = createRun()
    this.camMode = 'title'
    this.audio.duckMusic(1)
    this.setMusic('none')
  }

  setQuality(q: Quality): void {
    this.renderer.applyQuality(q)
  }

  /** QA/debug: jump the stage to a label (warmup, wave1, storm, wave2, boss). */
  debugSkip(label: string): void {
    this.enemies.clear()
    this.bullets.clear()
    if (label === 'boss') this.checkpointHere()
    this.stage.seek(label)
  }

  // ─── events ────────────────────────────────────────────────────────────
  private onKilled(e: Enemy): void {
    this.award(ENEMY_STATS[e.kind].score, e.pos, true)
  }

  private onCollected(e: Enemy): void {
    this.run = repair(this.run, CONFIG.repair.hull, CONFIG.repair.shield)
    this.audio.play('pickup')
    this.fx.ring(e.pos, 5, '#9dff5c', 0.4)
    this.fx.flare(e.pos, 4, '#9dff5c', 0.3)
    this.popupAt('pickup.repair', this.ship.pos, 'pickup')
  }

  private onBossPhase(s: BossState): void {
    if (s === 'p3' || s === 'trans23') this.setMusic('meltdown')
    if (s === 'dying') this.setMusic('none')
  }

  private onBossDefeated(): void {
    this.hooks.bossBar(false)
    this.winTimer = 2.2
    this.camMode = 'victory'
    this.camTime = 0
  }

  private onDeath(): void {
    this.ship.kill()
    this.fx.explode(this.ship.pos, 2.2, '#ffd9a0', '#4fe3ff', '#ece6d6')
    this.audio.play('explodeHuge')
    this.impact.hitStop(0.2)
    this.impact.slowMo(0.3, 1.6, 0.4)
    this.impact.flash('#ffffff', 0.7, 0.4)
    this.impact.shake(1)
    this.deathTimer = 2.2
    this.camMode = 'death'
    this.camTime = 0
    this.setMusic('none')
  }

  // ─── simulation ────────────────────────────────────────────────────────
  step(dt: number): void {
    if (this.mode === 'paused') return
    this.time += dt
    this.rail.step(dt)
    this.boost += (this.boostTarget - this.boost) * (1 - Math.exp(-dt * 1.6))
    if (this.mode === 'title') {
      this.stepTitle(dt)
      return
    }
    const playing = this.mode === 'playing'
    const controllable = playing && this.ship.alive && this.camMode !== 'launch' && this.camMode !== 'victory'
    let move = { x: this.input.move.x, y: this.input.move.y }
    let follow: THREE.Vector3 | null = null
    if (this.debug.bot && controllable) move = this.botMove()
    else if (controllable && this.mouseAim && move.x === 0 && move.y === 0) {
      follow = tmpC.set(this.reticle.x * CONFIG.ship.boundsX * 1.12, this.reticle.y * CONFIG.ship.boundsY * 1.3 - 0.4, 0)
    }
    if (!controllable) move = { x: 0, y: 0 }
    if (controllable && (this.input.consume('roll') || (this.debug.bot && this.botShouldRoll()))) {
      if (this.ship.roll(move.x || this.ship.vel.x)) {
        this.run = shield(this.run, CONFIG.roll.invulnerable)
        this.audio.play('roll')
        this.impact.kick(-Math.sign(move.x || 1) * 0.25, 0)
      }
    }
    this.ship.step(dt, move, follow, 1, this.rail.speed)
    this.ship.thrust = this.boost
    // Weapons.
    this.fireCooldown -= dt
    const wantFire = controllable && (this.input.held('fire') || this.debug.bot)
    if (wantFire && this.fireCooldown <= 0) this.fire()
    if (playing) this.stage.update(dt, this)
    this.enemies.update(dt)
    this.boss.step(dt)
    this.physics.step(dt)
    this.stepShots(dt)
    this.bullets.update(dt, this.ship.pos, CONFIG.ship.hitRadius, CONFIG.ship.grazeRadius, b => this.onBulletHit(b), b => this.onGraze(b))
    if (playing) this.run = tick(this.run, dt)
    if (this.run.combo === 0) this.lastMultiplier = 1
    if (playing && this.run.hull < 30 && this.ship.alive) {
      this.lowHullBeep -= dt
      if (this.lowHullBeep <= 0) {
        this.audio.play('lowHull')
        this.lowHullBeep = 1.1
      }
    }
    if (this.deathTimer > 0) {
      this.deathTimer -= dt
      if (this.deathTimer <= 0) this.finish()
    }
    if (this.winTimer > 0) {
      this.winTimer -= dt
      if (this.winTimer <= 0) {
        this.run = win(this.run)
        this.audio.play('win')
        this.setMusic('victory')
        this.finish()
      }
    }
  }

  private finish(): void {
    if (this.endSent) return
    this.endSent = true
    this.mode = 'ended'
    if (this.run.phase === 'lost') {
      this.audio.play('lose')
      this.setMusic('defeat')
    }
    this.hooks.end(this.run, { grade: grade(this.run), checkpoint: this.run.phase === 'lost' && this.checkpoint !== null })
  }

  private stepTitle(dt: number): void {
    // Attract mode: the ship weaves gently through the belt.
    const t = this.time
    const target = tmpC.set(Math.sin(t * 0.5) * 4, Math.sin(t * 0.37) * 1.8 - 0.3, 0)
    this.ship.step(dt, { x: 0, y: 0 }, target, 1, this.rail.speed)
    this.ship.thrust = 0.2
    this.enemies.update(dt)
    this.physics.step(dt)
    this.stepShots(dt)
  }

  private fire(): void {
    this.fireCooldown += 1 / CONFIG.weapon.rate
    if (this.fireCooldown < 0) this.fireCooldown = 0
    this.gunSide *= -1
    const m = this.ship.muzzle(this.gunSide, tmpA)
    const dir = tmpB.subVectors(this.aimPoint, m).normalize()
    this.shots.fire(m, dir, CONFIG.weapon.speed, CONFIG.weapon.range / CONFIG.weapon.speed, CONFIG.weapon.damage)
    this.run = shotFired(this.run)
    this.fx.muzzle(m, '#ffb347')
    this.audio.play('shoot')
    this.impact.kick(0, -0.012)
  }

  private stepShots(dt: number): void {
    this.shots.pool.update(s => {
      s.prev.copy(s.pos)
      s.pos.addScaledVector(s.vel, dt)
      s.life -= dt
      if (s.life <= 0) return false
      const hit = this.physics.segment(s.prev, s.pos, QUERY_SHOTS)
      if (!hit) return true
      const at = tmpA.subVectors(s.pos, s.prev).normalize().multiplyScalar(hit.distance).add(s.prev)
      const e = this.enemies.byColliderHandle(hit.collider.handle)
      if (e) {
        if (e.active) {
          this.enemies.damage(e, s.damage, at)
          this.run = shotHit(this.run)
        }
        return false
      }
      const part = this.boss.partFor(hit.collider.handle)
      if (part) {
        if (this.boss.damage(part, s.damage, at)) this.run = shotHit(this.run)
        return false
      }
      return false
    })
  }

  private onBulletHit(b: EnemyBullet): boolean {
    if (!this.playerAlive) return false
    if (this.ship.rolling) return false
    const landed = this.hurtPlayer(b.damage, b.pos, 'bullet')
    if (landed) this.fx.hit(b.pos, b.color, undefined, 6)
    return landed || this.run.invulnerable > 0
  }

  private onGraze(b: EnemyBullet): void {
    if (!this.playerAlive || this.mode !== 'playing') return
    const r = graze(this.run)
    this.run = r.state
    this.audio.play('graze')
    this.fx.spark(b.pos, tmpA.subVectors(b.pos, this.ship.pos).normalize().multiplyScalar(10), '#bff4ff', 0.25, 0.08)
  }

  // ─── QA bot ────────────────────────────────────────────────────────────
  private botMove(): { x: number; y: number } {
    const p = this.ship.pos
    let fx = 0
    let fy = 0
    for (const b of this.bullets.pool.active) {
      const dz = p.z - b.pos.z
      if (dz < -2 || dz > 22) continue
      const tHit = b.vel.z > 1 ? dz / b.vel.z : 99
      if (tHit > 0.9) continue
      const px = b.pos.x + b.vel.x * tHit
      const py = b.pos.y + b.vel.y * tHit
      const dx = p.x - px
      const dy = p.y - py
      const d2 = dx * dx + dy * dy + 0.3
      if (d2 > 16) continue
      fx += (dx / d2) * 3
      fy += (dy / d2) * 3
    }
    for (const e of this.enemies.list) {
      if (e.kind === 'cell') {
        fx += (e.pos.x - p.x) * 0.05
        fy += (e.pos.y - p.y) * 0.05
        continue
      }
      const dz = p.z - e.pos.z
      if (dz < -3 || dz > 40) continue
      const dx = p.x - e.pos.x
      const dy = p.y - e.pos.y
      const d2 = dx * dx + dy * dy + 1
      if (d2 < (e.radius + 3) * (e.radius + 3)) {
        fx += (dx / d2) * 6
        fy += (dy / d2) * 6
      }
    }
    fx += -p.x * 0.05
    fy += -p.y * 0.07
    const len = Math.hypot(fx, fy)
    return len > 1 ? { x: fx / len, y: fy / len } : { x: fx, y: fy }
  }

  private botShouldRoll(): boolean {
    const p = this.ship.pos
    for (const b of this.bullets.pool.active) {
      const dz = p.z - b.pos.z
      if (dz < -1 || dz > 5) continue
      if (Math.hypot(b.pos.x - p.x, b.pos.y - p.y) < 1.6) return true
    }
    return false
  }

  /** QA bot: swing the reticle onto the nearest threat (boss weak points included). */
  private botAim(frameSeconds: number): void {
    let best: THREE.Vector3 | null = null
    let bestZ = -Infinity
    for (const e of this.enemies.list) {
      if (!e.active || e.kind === 'cell' || e.pos.z > -14 || e.pos.z < -200) continue
      if (e.pos.z > bestZ) {
        bestZ = e.pos.z
        best = e.pos
      }
    }
    if (!best && this.boss.fighting) {
      for (const name of ['grinderL', 'grinderR', 'core'] as const) {
        if (!this.bossPartTargetable(name)) continue
        const p = this.boss.partPos(name, tmpC)
        best = p
        break
      }
    }
    if (!best) return
    const n = this.toNdc(best, tmpA)
    const k = 1 - Math.exp(-frameSeconds * 10)
    this.reticle.x += (n.x - this.reticle.x) * k
    this.reticle.y += (n.y - this.reticle.y) * k
  }

  // ─── aim ───────────────────────────────────────────────────────────────
  private updateAim(frameSeconds: number): void {
    const inp = this.input
    const d = inp.takeMouseDelta()
    const ptr = inp.takePointer()
    this.mouseIdle += frameSeconds
    if (d.x !== 0 || d.y !== 0) {
      this.reticle.x += d.x * 0.0021
      this.reticle.y -= d.y * 0.0021 * (innerWidth / innerHeight)
      this.mouseAim = true
      this.mouseIdle = 0
    } else if (ptr) {
      this.reticle.x = ptr.x
      this.reticle.y = ptr.y
      this.mouseAim = true
      this.mouseIdle = 0
    }
    if (inp.method !== 'keyboard' || this.debug.bot) this.mouseAim = false
    if (this.mouseAim && (inp.move.x !== 0 || inp.move.y !== 0) && this.mouseIdle > 1.2) this.mouseAim = false
    const shipNdc = this.toNdc(this.ship.pos, tmpA)
    if (!this.mouseAim) {
      // Stick / keyboard / touch: reticle rides ahead of the ship, right stick pushes it out.
      const reach = CONFIG.aim.stickReach * inp.sensitivity
      const tx = shipNdc.x + inp.aim.x * reach + this.ship.vel.x * 0.006
      const ty = shipNdc.y + 0.06 + inp.aim.y * reach * 0.8 + this.ship.vel.y * 0.006
      const k = 1 - Math.exp(-frameSeconds * 14)
      this.reticle.x += (tx - this.reticle.x) * k
      this.reticle.y += (ty - this.reticle.y) * k
    }
    if (this.debug.bot) this.botAim(frameSeconds)
    this.reticle.x = THREE.MathUtils.clamp(this.reticle.x, -0.98, 0.98)
    this.reticle.y = THREE.MathUtils.clamp(this.reticle.y, -0.96, 0.96)
    // Ray through the reticle in rig space.
    const cam = this.camera
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    const dir = tmpB.set(this.reticle.x * tanV * cam.aspect, this.reticle.y * tanV, -1).normalize().applyQuaternion(cam.quaternion)
    const origin = tmpC.copy(this.camPos)
    const hit = this.physics.raycast(origin, dir, 320, QUERY_SHOTS)
    this.locked = false
    if (hit && hit.distance > 12) {
      this.aimPoint.copy(origin).addScaledVector(dir, hit.distance)
      this.locked = true
    } else {
      // Aim assist: snap to the nearest target on screen within the radius.
      const assist = this.debug.bot ? 0.6 : inp.method === 'touch' ? CONFIG.aim.assistTouch : inp.method === 'gamepad' ? CONFIG.aim.assistPad : this.mouseAim ? CONFIG.aim.assistMouse : CONFIG.aim.assistPad
      let best = assist * assist
      let bestPos: THREE.Vector3 | null = null
      const consider = (pos: THREE.Vector3) => {
        if (pos.z > -12 || pos.z < -260) return
        const n = this.toNdc(pos, tmpA)
        const dx = (n.x - this.reticle.x) * cam.aspect
        const dy = n.y - this.reticle.y
        const d2 = dx * dx + dy * dy
        if (d2 < best) {
          best = d2
          bestPos = pos
        }
      }
      for (const e of this.enemies.list) if (e.active && e.kind !== 'cell') consider(e.pos)
      if (this.boss.fighting) {
        for (const name of ['grinderL', 'grinderR', 'core'] as const) {
          if (this.bossPartTargetable(name)) consider(this.boss.partPos(name, this.bossAim[name]))
        }
      }
      if (bestPos) {
        this.aimPoint.copy(bestPos as THREE.Vector3)
        this.locked = true
      } else this.aimPoint.copy(this.camPos).addScaledVector(dir, CONFIG.aim.depth)
    }
    this.ship.aimDir.subVectors(this.aimPoint, this.ship.pos).normalize()
  }

  private bossPartTargetable(name: 'grinderL' | 'grinderR' | 'core'): boolean {
    const h = this.boss.health
    if (!this.boss.fighting || !this.boss.partAlive(name)) return false
    return name === 'core' ? h.phase >= 2 : h.phase === 1
  }

  /** Rig-space point → NDC. */
  private toNdc(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(p)
    this.rig.localToWorld(out)
    return out.project(this.camera)
  }

  private popupAt(text: string, p: THREE.Vector3, kind: PopupKind, raw = false): void {
    const n = this.toNdc(p, tmpA.clone())
    if (n.z > 1) return
    this.hooks.popup(raw ? text : `@${text}`, { x: (n.x * 0.5 + 0.5) * innerWidth, y: (-n.y * 0.5 + 0.5) * innerHeight }, kind)
  }

  // ─── rendering ─────────────────────────────────────────────────────────
  render(alpha: number, frameSeconds: number, simSeconds: number): void {
    this.impact.intensity = this.reducedMotion ? 0.25 : 1
    this.impact.update(frameSeconds)
    const s = this.rail.at(alpha)
    this.rail.frame(s, this.rig.position, this.rig.quaternion)
    this.rig.updateMatrixWorld(true)
    const inv = this.run.invulnerable > 0 && !this.ship.rolling
    this.ship.draw(alpha, frameSeconds, this.time, inv)
    this.updateCamera(alpha, frameSeconds)
    if (this.mode === 'playing' || this.mode === 'title') this.updateAim(frameSeconds)
    this.enemies.render(alpha, this.time)
    this.boss.draw(alpha, simSeconds, this.time)
    this.fx.camQuat.copy(this.camera.quaternion)
    this.bullets.camQuat.copy(this.camera.quaternion)
    this.shots.camQuat.copy(this.camera.quaternion)
    this.fx.update(simSeconds, this.rail.speed)
    this.fx.render()
    this.bullets.render(this.time)
    this.shots.render(alpha)
    this.speed.boost = this.boost
    this.speed.update(simSeconds, this.rail.speed)
    const camWorld = this.camera.getWorldPosition(tmpA)
    this.env.alarm = Math.max(this.env.alarm * (1 - frameSeconds * 0.8), this.boss.alarm * 0.6)
    this.env.corridor = this.boss.active ? 34 : 0
    this.env.update(camWorld, simSeconds, this.time)
    // Post: distortion pulses, speed blur while boosting, red edge when the hull is low.
    const post = this.renderer.post
    post.aberration = this.impact.distortion * 0.018 * (this.reducedMotion ? 0.3 : 1) + this.boost * 0.0025
    post.zoom = this.reducedMotion ? 0 : this.boost * 0.09 + this.impact.distortion * 0.05
    const low = this.mode === 'playing' && this.run.hull < 30 ? 0.35 + Math.sin(this.time * 6) * 0.15 : 0
    post.tint.setRGB(0.7, 0.02, 0.05)
    post.tintAmount = low + this.env.alarm * 0.25
    post.vignette = 0.38 + this.boost * 0.12
    this.renderer.bloomStrength = 0.85 + this.impact.distortion * 0.5
    this.renderer.render(this.scene, this.camera)
  }

  private updateCamera(alpha: number, frameSeconds: number): void {
    this.camTime += frameSeconds
    const sp = this.ship.group.position
    const k = 1 - Math.exp(-frameSeconds * 5)
    const wantPos = tmpA
    const wantLook = tmpB
    let fovTarget = 62 + this.boost * 14
    switch (this.camMode) {
      case 'title': {
        const t = this.time * 0.18
        wantPos.set(sp.x + Math.sin(t) * 8.5, sp.y + 1.6 + Math.sin(t * 0.7) * 1.4, sp.z + Math.cos(t) * 7.5 + 1)
        wantLook.set(sp.x * 0.6, sp.y * 0.6 + 0.2, sp.z - 2)
        fovTarget = 50
        break
      }
      case 'launch': {
        const t = Math.min(1, this.camTime / 3.2)
        const e = t * t * (3 - 2 * t)
        wantPos.set(THREE.MathUtils.lerp(4.5, sp.x * 0.5, e), THREE.MathUtils.lerp(0.6, sp.y * 0.45 + 2.6, e), THREE.MathUtils.lerp(-7, 9.8, e))
        wantLook.set(sp.x * (1 - e * 0.7), sp.y, THREE.MathUtils.lerp(sp.z, -30, e))
        fovTarget = THREE.MathUtils.lerp(48, 62, e)
        break
      }
      case 'boss': {
        const t = Math.min(1, this.camTime / 5)
        const e = Math.sin(t * Math.PI)
        const bp = this.boss.root.position
        wantPos.set(sp.x * 0.5 - e * 6, sp.y * 0.45 + 2.6 - e * 3.5, 10.4 + e * 8)
        wantLook.set(bp.x * e + sp.x * 0.28 * (1 - e), bp.y * e + 0.4 * (1 - e), THREE.MathUtils.lerp(-30, bp.z, e))
        fovTarget = 62 + e * 8
        break
      }
      case 'death': {
        wantPos.set(sp.x + 6, sp.y + 3, sp.z + 12)
        wantLook.copy(sp)
        fovTarget = 55
        break
      }
      case 'victory': {
        const t = Math.min(1, this.camTime / 3)
        wantPos.set(sp.x * 0.5 + Math.sin(t * 2) * 5 * t, sp.y * 0.45 + 2.6 + t * 1.5, 10.4 + t * 5)
        wantLook.set(sp.x * 0.28, sp.y * 0.25 + 0.4, -30)
        break
      }
      default: {
        wantPos.set(sp.x * 0.52, sp.y * 0.45 + 2.6, 10.4)
        wantLook.set(sp.x * 0.3, sp.y * 0.26 - 0.2, -30)
      }
    }
    const snap = this.camMode === 'launch' || this.camMode === 'title'
    const kk = snap ? 1 - Math.exp(-frameSeconds * 9) : k
    this.camPos.lerp(wantPos, kk)
    this.camLook.lerp(wantLook, kk)
    this.fov += (fovTarget - this.fov) * (1 - Math.exp(-frameSeconds * 3))
    const shake = this.impact.sampleShake()
    this.camera.position.set(this.camPos.x + shake.x, this.camPos.y + shake.y, this.camPos.z)
    this.camM.lookAt(this.camera.position, this.camLook, THREE.Object3D.DEFAULT_UP)
    this.camera.quaternion.setFromRotationMatrix(this.camM)
    const bankRoll = this.camMode === 'play' ? THREE.MathUtils.clamp(-this.ship.vel.x * 0.004, -0.06, 0.06) : 0
    this.camera.rotateZ(bankRoll + shake.roll)
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov
      this.camera.updateProjectionMatrix()
    }
    void alpha
  }

  // ─── HUD ───────────────────────────────────────────────────────────────
  hud(): HudData {
    const r = this.run
    const mult = r.combo > 0 ? Math.min(CONFIG.combo.maxMultiplier, 1 + Math.floor(r.combo / CONFIG.combo.perLevel)) : 1
    const inner = this.toNdc(tmpA.copy(this.ship.pos).lerp(this.aimPoint, 0.22), tmpB.clone())
    return {
      score: r.score,
      multiplier: mult,
      combo: r.combo,
      comboFraction: r.combo > 0 ? r.comboTimer / CONFIG.combo.window : 0,
      hull: r.hull / CONFIG.hull.max,
      shield: r.shield / CONFIG.shield.max,
      rollReady: this.ship.rollCooldown > 0 ? 1 - this.ship.rollCooldown / (CONFIG.roll.duration + CONFIG.roll.cooldown) : 1,
      grazes: r.grazes,
      boss: this.boss.active ? this.boss.health : null,
      reticle: {
        x: this.reticle.x,
        y: this.reticle.y,
        inner: { x: inner.x, y: inner.y },
        locked: this.locked,
        visible: this.mode === 'playing' && this.ship.alive && this.camMode !== 'launch' && this.camMode !== 'victory',
      },
      lowHull: r.hull < 30,
    }
  }

  get usedCheckpointRun(): boolean {
    return this.usedCheckpoint
  }
}
