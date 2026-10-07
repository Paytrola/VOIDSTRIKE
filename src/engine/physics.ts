import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

export { RAPIER }

/** Initialise the Rapier WASM module once, before creating any `Physics`. */
let ready: Promise<void> | undefined
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init()
  return ready
}

type Binding = { body: RAPIER.RigidBody; object: THREE.Object3D; prev: THREE.Vector3; prevRot: THREE.Quaternion }

/**
 * Thin owner of one Rapier world. It steps at the loop's fixed rate and keeps dynamic/kinematic
 * bodies and their three.js objects in sync with render interpolation.
 *
 * Gameplay creates colliders through the helpers below instead of calling Rapier directly, so the
 * collider shape always matches the visible mesh size it was derived from.
 */
export class Physics {
  readonly world: RAPIER.World
  private bindings: Binding[] = []

  constructor(gravity = -24) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 })
  }

  step(stepSeconds: number): void {
    for (const b of this.bindings) {
      const t = b.body.translation()
      const r = b.body.rotation()
      b.prev.set(t.x, t.y, t.z)
      b.prevRot.set(r.x, r.y, r.z, r.w)
    }
    this.world.timestep = stepSeconds
    this.world.step()
  }

  /** Copy body transforms to their objects, blending the last two steps by `alpha`. */
  sync(alpha: number): void {
    const cur = new THREE.Vector3()
    const curRot = new THREE.Quaternion()
    for (const b of this.bindings) {
      const t = b.body.translation()
      const r = b.body.rotation()
      cur.set(t.x, t.y, t.z)
      curRot.set(r.x, r.y, r.z, r.w)
      b.object.position.lerpVectors(b.prev, cur, alpha)
      b.object.quaternion.slerpQuaternions(b.prevRot, curRot, alpha)
    }
  }

  /** Fixed box collider (level geometry). `size` is the full extent, matching BoxGeometry arguments. */
  addStaticBox(center: THREE.Vector3, size: THREE.Vector3, rotation?: THREE.Quaternion, friction = 0.9): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(friction)
    if (rotation) desc.setRotation(rotation)
    return this.world.createCollider(desc)
  }

  /** Fixed upright cylinder collider; matches CylinderGeometry(radius, radius, height). */
  addStaticCylinder(center: THREE.Vector3, radius: number, height: number, friction = 0.9): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(center.x, center.y, center.z).setFriction(friction)
    return this.world.createCollider(desc)
  }

  /** Sensor sphere that reports overlaps without physical response (pickups, triggers). */
  addSensorSphere(center: THREE.Vector3, radius: number): RAPIER.Collider {
    return this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setTranslation(center.x, center.y, center.z).setSensor(true))
  }

  /** Kinematic body driven by gameplay (moving platforms, patrol drones), rendered with interpolation. */
  addKinematic(object: THREE.Object3D, collider: RAPIER.ColliderDesc): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(object.position.x, object.position.y, object.position.z),
    )
    this.world.createCollider(collider, body)
    this.bind(body, object)
    return body
  }

  /** Dynamic body simulated by Rapier (crates, debris). */
  addDynamic(object: THREE.Object3D, collider: RAPIER.ColliderDesc, linearDamping = 0.1): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(object.position.x, object.position.y, object.position.z)
        .setLinearDamping(linearDamping)
        .setCcdEnabled(true),
    )
    this.world.createCollider(collider, body)
    this.bind(body, object)
    return body
  }

  bind(body: RAPIER.RigidBody, object: THREE.Object3D): void {
    const t = body.translation()
    const r = body.rotation()
    this.bindings.push({ body, object, prev: new THREE.Vector3(t.x, t.y, t.z), prevRot: new THREE.Quaternion(r.x, r.y, r.z, r.w) })
  }

  /** Forget interpolation history after a teleport so the object does not streak across the map. */
  snap(body: RAPIER.RigidBody): void {
    const b = this.bindings.find(x => x.body === body)
    if (!b) return
    const t = body.translation()
    b.prev.set(t.x, t.y, t.z)
  }

  /**
   * Kinematic body without a bound three.js object, for gameplay entities that render through
   * instanced batches. Move it with `body.setNextKinematicTranslation()` before `step()`.
   */
  addKinematicBody(position: { x: number; y: number; z: number }): RAPIER.RigidBody {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z))
  }

  /** Sensor ball attached to a body at a local offset; `groups` = Rapier interaction groups. */
  attachBall(body: RAPIER.RigidBody, radius: number, offset = { x: 0, y: 0, z: 0 }, groups = 0xffffffff): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.ball(radius).setTranslation(offset.x, offset.y, offset.z).setSensor(true).setCollisionGroups(groups)
    return this.world.createCollider(desc, body)
  }

  /** Sensor box attached to a body; `size` is the full extent. */
  attachBox(body: RAPIER.RigidBody, size: { x: number; y: number; z: number }, offset = { x: 0, y: 0, z: 0 }, groups = 0xffffffff): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(offset.x, offset.y, offset.z).setSensor(true).setCollisionGroups(groups)
    return this.world.createCollider(desc, body)
  }

  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

  /**
   * Swept query from `from` to `to` (a bullet's movement this step); sensors are included.
   * Returns the first collider hit and the distance along the segment, or null.
   */
  segment(from: THREE.Vector3, to: THREE.Vector3, groups = 0xffffffff): { collider: RAPIER.Collider; distance: number } | null {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dz = to.z - from.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) return null
    this.ray.origin = { x: from.x, y: from.y, z: from.z }
    this.ray.dir = { x: dx / len, y: dy / len, z: dz / len }
    const hit = this.world.castRay(this.ray, len, true, undefined, groups)
    return hit ? { collider: hit.collider, distance: hit.timeOfImpact } : null
  }

  /** Ray query from `origin` along unit `dir` up to `max`. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number, groups = 0xffffffff): { collider: RAPIER.Collider; distance: number } | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z }
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z }
    const hit = this.world.castRay(this.ray, max, true, undefined, groups)
    return hit ? { collider: hit.collider, distance: hit.timeOfImpact } : null
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.bindings = this.bindings.filter(b => b.body !== body)
    this.world.removeRigidBody(body)
  }

  dispose(): void {
    this.bindings = []
    this.world.free()
  }
}
