import * as THREE from 'three'
import { Audio } from '../../engine/audio'
import { Input } from '../../engine/input'
import { Renderer } from '../../engine/renderer'
import { AIRCRAFT_CLASSES } from '../aircraft'
import { Ship } from '../ship'
import rules from '../../../shared/pvp-rules.json'
import type { PvpPhase, PvpPlayerSnapshot, PvpSnapshot } from './protocol'
import { PvpSession } from './session'

type ShipView = {
  ship: Ship
  player: PvpPlayerSnapshot
  renderPosition: THREE.Vector3
  targetPosition: THREE.Vector3
  initialized: boolean
  lastHull: number
  lastShield: number
  lastWeaponBoost: number
}

type ObjectView = { mesh: THREE.Mesh; target: THREE.Vector3 }

export type PvpHudData = {
  room: string
  connection: PvpSession['state']
  errorCode?: string
  phase: PvpPhase
  secondsLeft: number
  weaponBoostMs: number
  winner: string | null
  local: PvpPlayerSnapshot | null
  rival: PvpPlayerSnapshot | null
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const wrapYaw = (value: number) => ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
const vec = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)
const Y_AXIS = new THREE.Vector3(0, 1, 0)

/**
 * A separate 3D free-flight scene. The network server owns all combat and match state; this class
 * predicts only the local ship's movement and corrects it to projected authoritative snapshots.
 */
export class FreeFlightPvp {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 700)
  private readonly views = new Map<string, ShipView>()
  private readonly projectileViews = new Map<string, ObjectView>()
  private readonly pickupViews = new Map<string, ObjectView>()
  private readonly projectileMaterials = new Map<string, THREE.MeshBasicMaterial>()
  private readonly pickupMaterials = new Map<string, THREE.MeshBasicMaterial>()
  private readonly projectileGeometry = new THREE.SphereGeometry(0.58, 8, 6)
  private readonly pickupGeometry = new Map<string, THREE.BufferGeometry>()
  private readonly localPosition = new THREE.Vector3()
  private readonly localVelocity = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly lookAt = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private sequence = 0
  private sendAccumulator = 0
  private hudAccumulator = 0
  private lastSnapshot?: PvpSnapshot
  private localInitialized = false
  private pendingRoll = false
  private rollImpulsePredicted = false
  private pendingAbility = false
  private rollCuePredicted = false
  private abilityCuePredicted = false
  private predictedAfterburnUntil = 0
  private predictedAegisUntil = 0
  private lastShotSoundAt = 0
  private seenShots = new Set<string>()
  private disposed = false
  private originalBloomStrength = 0.9
  private lastConnectionState: PvpSession['state'] = 'disconnected'
  private readonly starMaterial = new THREE.PointsMaterial({ color: '#9dd8ff', size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.82, depthWrite: false })

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly session: PvpSession,
    private readonly onHud: (hud: PvpHudData) => void,
  ) {
    this.originalBloomStrength = this.renderer.bloomStrength
    this.scene.background = new THREE.Color('#060a18')
    this.scene.fog = new THREE.FogExp2('#060a18', 0.0019)
    this.scene.add(new THREE.HemisphereLight('#d5e8ff', '#14132c', 1.45))
    const key = new THREE.DirectionalLight('#b8e6ff', 1.8)
    key.position.set(38, 52, 12)
    this.scene.add(key)
    this.buildArena()
    this.buildStars()
    this.renderer.bloomStrength = 0.72
  }

  private buildArena(): void {
    const box = new THREE.BoxGeometry(rules.arena.x * 2, rules.arena.y * 2, rules.arena.z * 2)
    const edges = new THREE.EdgesGeometry(box)
    const border = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#287d9d', transparent: true, opacity: 0.44, toneMapped: false }))
    border.position.y = 0
    this.scene.add(border)
    box.dispose()

    const reticleGeometry = new THREE.TorusGeometry(1.35, 0.06, 6, 40)
    const markerMaterial = new THREE.MeshBasicMaterial({ color: '#4fe3ff', transparent: true, opacity: 0.5, toneMapped: false })
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const z of [-1, 1]) {
          const marker = new THREE.Mesh(reticleGeometry, markerMaterial)
          marker.position.set(x * (rules.arena.x - 1), y * (rules.arena.y - 1), z * (rules.arena.z - 1))
          marker.scale.set(2.3, 1.5, 1)
          marker.rotation.set(Math.PI * 0.28, Math.PI * 0.18, Math.PI * 0.12)
          this.scene.add(marker)
        }
      }
    }

    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#273c76', transparent: true, opacity: 0.4, wireframe: true, toneMapped: false })
    for (let i = 0; i < 4; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(36 + i * 9, 0.32, 6, 96), ringMaterial)
      ring.position.set((i % 2 ? 1 : -1) * 9, (i - 1.5) * 7, (i % 2 ? -1 : 1) * 12)
      ring.rotation.set(0.62 + i * 0.18, 0.4 * i, 0.28 * i)
      this.scene.add(ring)
    }
  }

  private buildStars(): void {
    let seed = 20261008
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x1_0000_0000
    }
    const positions = new Float32Array(900 * 3)
    for (let i = 0; i < 900; i += 1) {
      positions[i * 3] = (random() * 2 - 1) * rules.arena.x * 1.65
      positions[i * 3 + 1] = (random() * 2 - 1) * rules.arena.y * 1.7
      positions[i * 3 + 2] = (random() * 2 - 1) * rules.arena.z * 1.65
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.scene.add(new THREE.Points(geometry, this.starMaterial))
  }

  private ensureShip(player: PvpPlayerSnapshot): ShipView {
    let view = this.views.get(player.id)
    if (!view) {
      const ship = new Ship()
      ship.reset()
      ship.setAircraftClass(player.classId)
      this.scene.add(ship.group, ...ship.trailMeshes)
      view = {
        ship,
        player,
        renderPosition: vec(player.position),
        targetPosition: vec(player.position),
        initialized: false,
        lastHull: player.hull,
        lastShield: player.shield,
        lastWeaponBoost: player.weaponBoostRemaining,
      }
      this.views.set(player.id, view)
    }
    if (view.player.classId !== player.classId) view.ship.setAircraftClass(player.classId)
    if (player.id === this.session.seatId) {
      if (view.initialized && player.hull < view.lastHull) this.audio.play(player.shield < view.lastShield ? 'shieldHit' : 'hullHit')
      if (view.initialized && player.weaponBoostRemaining > 0 && view.lastWeaponBoost <= 0) this.audio.play('pickup')
      if (view.initialized && player.hull > view.lastHull && player.shield >= view.lastShield) this.audio.play('pickup')
    }
    view.player = player
    view.lastHull = player.hull
    view.lastShield = player.shield
    view.lastWeaponBoost = player.weaponBoostRemaining
    return view
  }

  private setObjectViews(source: Array<{ id: string; kind: string; color?: string; position: { x: number; y: number; z: number } }>, target: Map<string, ObjectView>, pickup: boolean): void {
    const present = new Set<string>()
    for (const item of source) {
      present.add(item.id)
      let view = target.get(item.id)
      if (!view) {
        let material: THREE.MeshBasicMaterial
        const materialKey = pickup ? item.kind : item.color ?? item.kind
        const materials = pickup ? this.pickupMaterials : this.projectileMaterials
        material = materials.get(materialKey)!
        if (!material) {
          const color = pickup
            ? item.kind === 'health' ? '#9dff5c' : item.kind === 'shield' ? '#4fe3ff' : '#ffd35c'
            : item.color ?? '#ff7799'
          material = new THREE.MeshBasicMaterial({ color, wireframe: pickup, transparent: pickup, opacity: pickup ? 0.85 : 1, toneMapped: false })
          materials.set(materialKey, material)
        }
        let geometry: THREE.BufferGeometry
        if (pickup) {
          geometry = this.pickupGeometry.get(item.kind)!
          if (!geometry) {
            geometry = new THREE.IcosahedronGeometry(2.25, 1)
            this.pickupGeometry.set(item.kind, geometry)
          }
        } else geometry = this.projectileGeometry
        const mesh = new THREE.Mesh(geometry, material)
        if (pickup) mesh.scale.set(1, 1.2, 1)
        this.scene.add(mesh)
        view = { mesh, target: vec(item.position) }
        target.set(item.id, view)
      }
      view.target.set(item.position.x, item.position.y, item.position.z)
    }
    for (const [id, view] of target) {
      if (present.has(id)) continue
      this.scene.remove(view.mesh)
      target.delete(id)
    }
  }

  private readSnapshot(): void {
    const snapshot = this.session.latestSnapshot
    if (!snapshot || snapshot === this.lastSnapshot) return
    this.lastSnapshot = snapshot
    for (const player of snapshot.players) {
      const previousAlive = this.views.get(player.id)?.player.alive
      const view = this.ensureShip(player)
      const teleported = view.initialized && previousAlive !== player.alive
      const projected = vec(player.position)
      if (snapshot.phase === 'live' && player.alive && player.connected) {
        projected.addScaledVector(vec(player.velocity), this.session.snapshotAgeMs / 1000)
      }
      projected.x = clamp(projected.x, -rules.arena.x, rules.arena.x)
      projected.y = clamp(projected.y, -rules.arena.y, rules.arena.y)
      projected.z = clamp(projected.z, -rules.arena.z, rules.arena.z)
      view.targetPosition.copy(projected)
      if (!view.initialized || teleported) {
        view.renderPosition.copy(projected)
        view.initialized = true
        if (player.id === this.session.seatId) {
          this.localPosition.copy(projected)
          this.localVelocity.copy(vec(player.velocity))
          this.yaw = player.yaw
          this.pitch = player.pitch
          this.localInitialized = true
        }
      }
      view.ship.alive = player.alive
      view.ship.model.visible = player.alive
      view.ship.barrierActive = player.invulnerable || player.abilityActive
    }
    this.setObjectViews(snapshot.projectiles, this.projectileViews, false)
    this.setObjectViews(snapshot.pickups, this.pickupViews, true)
    this.playShotCues(snapshot)
  }

  private playShotCues(snapshot: PvpSnapshot): void {
    const localId = this.session.seatId
    if (!localId) return
    for (const shot of snapshot.projectiles) {
      if (shot.owner !== localId || this.seenShots.has(shot.id)) continue
      this.seenShots.add(shot.id)
      if (this.seenShots.size > 256) this.seenShots.clear()
      const local = snapshot.players.find(player => player.id === localId)
      const sound = local ? AIRCRAFT_CLASSES[local.classId].weapon.sound : 'shoot'
      const now = performance.now()
      if (now - this.lastShotSoundAt >= 65) {
        this.audio.play(sound)
        this.lastShotSoundAt = now
      }
    }
  }

  private updateAim(dt: number): void {
    if (this.input.pointerLocked) {
      const delta = this.input.takeMouseDelta()
      this.yaw = wrapYaw(this.yaw - delta.x * 0.0022)
      this.pitch = clamp(this.pitch + delta.y * 0.0022, -1.2, 1.2)
      return
    }
    if (this.input.method === 'gamepad') {
      this.yaw = wrapYaw(this.yaw + this.input.aim.x * 2.5 * dt)
      this.pitch = clamp(this.pitch + this.input.aim.y * 1.75 * dt, -1.2, 1.2)
      return
    }
    const pointer = this.input.takePointer()
    if (pointer) {
      this.yaw = wrapYaw(pointer.x * Math.PI * 0.72)
      this.pitch = clamp(pointer.y * 0.95, -1.2, 1.2)
    }
  }

  private predictLocal(dt: number): void {
    const player = this.lastSnapshot?.players.find(p => p.id === this.session.seatId)
    if (!player || !this.localInitialized || !this.session.connected || this.lastSnapshot?.phase !== 'live' || !player.alive) return
    const profile = AIRCRAFT_CLASSES[player.classId]
    const afterburn = profile.ability.kind === 'afterburn' && (player.abilityActive || performance.now() < this.predictedAfterburnUntil)
    const speed = rules.speed * profile.speedMultiplier * (afterburn && profile.ability.kind === 'afterburn' ? profile.ability.speedBoost ?? 1 : 1)
    const cp = Math.cos(this.pitch)
    this.forward.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
    this.right.set(Math.cos(this.yaw), 0, Math.sin(this.yaw))
    const axes = this.input.flight
    const target = this.forward.clone().multiplyScalar(axes.forward).addScaledVector(this.right, axes.strafe).add(Y_AXIS.clone().multiplyScalar(axes.vertical))
    if (target.lengthSq() > 1) target.normalize()
    target.multiplyScalar(speed)
    const accel = rules.acceleration * dt
    this.localVelocity.x += clamp(target.x - this.localVelocity.x, -accel, accel)
    this.localVelocity.y += clamp(target.y - this.localVelocity.y, -accel, accel)
    this.localVelocity.z += clamp(target.z - this.localVelocity.z, -accel, accel)
    if (this.pendingRoll && !this.rollImpulsePredicted && player.rollReadyIn <= 0) {
      const direction = Math.sign(axes.strafe || this.localVelocity.x || 1)
      this.localVelocity.x += this.right.x * direction * rules.rollBurst
      this.localVelocity.z += this.right.z * direction * rules.rollBurst
      this.rollImpulsePredicted = true
    }
    this.localPosition.addScaledVector(this.localVelocity, dt)
    for (const [key, max] of [['x', rules.arena.x], ['y', rules.arena.y], ['z', rules.arena.z]] as const) {
      if (Math.abs(this.localPosition[key]) > max) {
        this.localPosition[key] = Math.sign(this.localPosition[key]) * max
        this.localVelocity[key] *= -0.2
      }
    }
  }

  step(dt: number): void {
    if (this.disposed) return
    if (this.session.state === 'connected' && this.lastConnectionState !== 'connected') {
      this.localInitialized = false
      for (const view of this.views.values()) view.initialized = false
    }
    this.lastConnectionState = this.session.state
    this.readSnapshot()
    this.updateAim(dt)
    const rollPressed = this.input.consume('roll')
    const abilityPressed = this.input.consume('ability')
    if (this.lastSnapshot?.phase === 'live' && this.session.connected) {
      this.pendingRoll ||= rollPressed
      this.pendingAbility ||= abilityPressed
    }
    const local = this.lastSnapshot?.players.find(p => p.id === this.session.seatId)
    if (this.pendingAbility && !this.abilityCuePredicted && local?.abilityReadyIn === 0 && local.alive && this.lastSnapshot?.phase === 'live' && this.session.connected) {
      this.abilityCuePredicted = true
      const profile = AIRCRAFT_CLASSES[local.classId]
      this.audio.play(profile.ability.sound)
      const now = performance.now()
      if (profile.ability.kind === 'afterburn') this.predictedAfterburnUntil = now + profile.ability.duration * 1000
      if (profile.ability.kind === 'aegis') this.predictedAegisUntil = now + profile.ability.duration * 1000
    }
    if (this.pendingRoll && !this.rollCuePredicted && local?.rollReadyIn === 0 && local.alive && this.lastSnapshot?.phase === 'live' && this.session.connected) {
      this.rollCuePredicted = true
      this.audio.play('roll')
    }
    this.predictLocal(dt)
    this.sendAccumulator += dt
    if (this.sendAccumulator >= rules.snapshotMs / 1000 && this.session.connected) {
      this.sendAccumulator %= rules.snapshotMs / 1000
      const sendRoll = this.pendingRoll
      const sendAbility = this.pendingAbility
      this.pendingRoll = false
      this.rollCuePredicted = false
      this.rollImpulsePredicted = false
      this.pendingAbility = false
      this.abilityCuePredicted = false
      this.session.sendInput({
        seq: this.sequence++,
        move: { strafe: this.input.flight.strafe, vertical: this.input.flight.vertical, forward: this.input.flight.forward },
        look: { yaw: this.yaw, pitch: this.pitch },
        fire: this.input.held('fire'),
        roll: sendRoll,
        ability: sendAbility,
      })
    }
    this.hudAccumulator += dt
    if (this.hudAccumulator >= 0.1) {
      this.hudAccumulator = 0
      this.onHud(this.hud())
    }
  }

  hud(): PvpHudData {
    const snapshot = this.session.latestSnapshot
    const local = snapshot?.players.find(player => player.id === this.session.seatId) ?? null
    const rival = snapshot?.players.find(player => player.id !== this.session.seatId) ?? null
    return {
      room: snapshot?.room ?? this.session.room ?? '',
      connection: this.session.state,
      errorCode: this.session.errorCode,
      phase: snapshot?.phase ?? 'waiting',
      secondsLeft: snapshot && snapshot.phaseEndsAt > 0 ? Math.max(0, Math.ceil((snapshot.phaseEndsAt - this.session.estimatedServerNow) / 1000)) : 0,
      weaponBoostMs: rules.weaponBoostMs,
      winner: snapshot?.winner ?? null,
      local,
      rival,
    }
  }

  private easeViews(dt: number): void {
    const localId = this.session.seatId
    const localSnapshot = this.lastSnapshot?.players.find(player => player.id === localId)
    const localCanPredict = !!localSnapshot && localSnapshot.alive && this.lastSnapshot?.phase === 'live' && this.session.connected
    if (localCanPredict) {
      const view = this.views.get(localId!)
      if (view) {
        const error = view.targetPosition.clone().sub(this.localPosition)
        if (error.length() > 28) this.localPosition.copy(view.targetPosition)
        else this.localPosition.addScaledVector(error, 1 - Math.exp(-dt * 9))
        view.renderPosition.lerpVectors(view.renderPosition, this.localPosition, 1 - Math.exp(-dt * 22))
      }
    }
    for (const [id, view] of this.views) {
      if (id === localId && localCanPredict) continue
      const weight = 1 - Math.exp(-dt * (id === localId ? 15 : 10))
      view.renderPosition.lerp(view.targetPosition, weight)
    }
    for (const view of [...this.projectileViews.values(), ...this.pickupViews.values()]) {
      view.mesh.position.lerp(view.target, 1 - Math.exp(-dt * 18))
    }
  }

  render(frameSeconds: number, simSeconds: number): void {
    if (this.disposed) return
    const dt = Math.min(0.05, Math.max(0, frameSeconds))
    this.readSnapshot()
    this.easeViews(dt)
    for (const view of this.views.values()) {
      const player = view.player
      view.ship.pos.copy(view.renderPosition)
      view.ship.prev.copy(view.renderPosition)
      view.ship.vel.set(player.velocity.x, player.velocity.y, player.velocity.z)
      view.ship.thrust = player.id === this.session.seatId ? Math.max(0, this.input.flight.forward) : Math.min(1, vec(player.velocity).length() / (rules.speed * 1.4))
      const localAegis = player.id === this.session.seatId && performance.now() < this.predictedAegisUntil
      view.ship.barrierActive = player.invulnerable || player.abilityActive || localAegis
      view.ship.draw(1, dt, simSeconds, player.invulnerable || player.abilityActive || localAegis)
      view.ship.model.rotation.set(player.id === this.session.seatId ? this.pitch : player.pitch, player.id === this.session.seatId ? this.yaw : player.yaw, 0, 'YXZ')
      view.ship.group.visible = player.connected || player.alive
    }
    for (const view of this.pickupViews.values()) {
      view.mesh.rotation.x += dt * 0.45
      view.mesh.rotation.y += dt * 0.85
      view.mesh.position.y = view.target.y + Math.sin(simSeconds * 2 + view.target.x) * 0.8
    }
    for (const view of this.projectileViews.values()) view.mesh.rotation.x += dt * 1.4
    const local = this.views.get(this.session.seatId ?? '')
    if (local) {
      const forward = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch))
      const up = new THREE.Vector3(0, 1, 0)
      this.camera.position.copy(local.renderPosition).addScaledVector(forward, -14).addScaledVector(up, 5.2)
      this.lookAt.copy(local.renderPosition).addScaledVector(forward, 14)
      this.camera.up.copy(up)
      this.camera.lookAt(this.lookAt)
    } else {
      this.camera.position.set(0, 17, 112)
      this.camera.lookAt(0, 0, 0)
    }
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        geometries.add(object.geometry)
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of objectMaterials) materials.add(material)
      }
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    this.scene.clear()
    this.views.clear()
    this.projectileViews.clear()
    this.pickupViews.clear()
    this.renderer.bloomStrength = this.originalBloomStrength
  }
}
