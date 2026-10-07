import * as THREE from 'three'
import { CONFIG } from './config'

/**
 * The fixed flight path. `s` is distance travelled; the rig frame at `s` gives position and a
 * banked orientation (-Z forward). All combat happens in this moving frame, so the ship always
 * flies "forward" while the world curves and rolls around it.
 */
export class Rail {
  s = 0
  prevS = 0
  speed: number = CONFIG.rail.speed
  targetSpeed: number = CONFIG.rail.speed
  /** Seconds to reach target speed (smoothing). */
  response = 1.2
  private readonly a = new THREE.Vector3()
  private readonly b = new THREE.Vector3()
  private readonly c = new THREE.Vector3()
  private readonly fwd = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly m = new THREE.Matrix4()
  private readonly bankQ = new THREE.Quaternion()
  private readonly zAxis = new THREE.Vector3(0, 0, 1)

  reset(s = 0): void {
    this.s = this.prevS = s
    this.speed = this.targetSpeed = CONFIG.rail.speed
  }

  step(dt: number): void {
    this.prevS = this.s
    const k = 1 - Math.exp(-dt / Math.max(0.05, this.response))
    this.speed += (this.targetSpeed - this.speed) * k
    this.s += this.speed * dt
  }

  /** Path position at distance `s`. Gentle layered curves read as a winding belt passage. */
  point(s: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(46 * Math.sin(s / 310) + 13 * Math.sin(s / 121 + 1.3), 16 * Math.sin(s / 230) + 5 * Math.sin(s / 83 + 0.4), -s)
  }

  /** Bank angle from lateral curvature (leans into turns). */
  bank(s: number): number {
    const h = 6
    const x0 = this.point(s - h, this.a).x
    const x1 = this.point(s, this.b).x
    const x2 = this.point(s + h, this.c).x
    const d2 = (x2 - 2 * x1 + x0) / (h * h)
    return THREE.MathUtils.clamp(d2 * 340, -0.32, 0.32)
  }

  /** Write the rig transform at `s` into `pos` and `quat`. */
  frame(s: number, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.point(s, pos)
    this.point(s + 4, this.a)
    this.point(s - 4, this.b)
    this.fwd.subVectors(this.a, this.b).normalize()
    this.right.crossVectors(this.fwd, THREE.Object3D.DEFAULT_UP).normalize()
    this.up.crossVectors(this.right, this.fwd).normalize()
    // Basis columns: X = right, Y = up, Z = -forward.
    this.m.makeBasis(this.right, this.up, this.c.copy(this.fwd).negate())
    quat.setFromRotationMatrix(this.m)
    this.bankQ.setFromAxisAngle(this.zAxis, this.bank(s))
    quat.multiply(this.bankQ)
  }

  /** Interpolated distance for rendering. */
  at(alpha: number): number {
    return this.prevS + (this.s - this.prevS) * alpha
  }
}
