/**
 * Impact toolkit: the "game feel" layer shared by every scene.
 *
 * - `hitStop(seconds)` freezes simulated time (the longest active request wins).
 * - `slowMo(scale, seconds)` bends time for cinematic beats and eases back to normal.
 * - `shake(trauma)` adds trauma; the offset scales with trauma² and uses smooth layered noise, so
 *   small hits jitter and big ones rumble. `kick(x, y)` adds a directional spring impulse.
 * - `flash(color, strength, seconds)` fades a full-screen colour overlay (white-out, damage red).
 * - `pulse(amount)` drives a short-lived distortion value (chromatic aberration in the renderer).
 *
 * Call `update(realSeconds)` once per rendered frame with wall time; read `timeScale` into the
 * game loop and `sampleShake()` in the camera. Effects run on wall time so a hit-stop never
 * freezes its own recovery. Nothing here knows about gameplay.
 */
export type ShakeSample = { x: number; y: number; roll: number }

export type ImpactOptions = {
  /** Container for the flash overlay (a full-screen element above the canvas). */
  overlayParent?: HTMLElement
  /** Maximum positional shake in world units at trauma = 1. */
  maxOffset?: number
  /** Maximum roll shake in radians at trauma = 1. */
  maxRoll?: number
  /** Trauma decay per second. */
  decay?: number
}

export class Impact {
  /** 0..1 scale applied to shake, kick and flash (Settings → reduce camera shake). */
  intensity = 1
  private trauma = 0
  private stopLeft = 0
  private stopScale = 0
  private slowScale = 1
  private slowLeft = 0
  private slowTotal = 0
  private slowRecover = 0.35
  private time = 0
  private kickPos = { x: 0, y: 0 }
  private kickVel = { x: 0, y: 0 }
  private pulseValue = 0
  private flashLeft = 0
  private flashTotal = 0
  private flashStrength = 0
  private readonly overlay?: HTMLDivElement
  private readonly maxOffset: number
  private readonly maxRoll: number
  private readonly decay: number

  constructor(opts: ImpactOptions = {}) {
    this.maxOffset = opts.maxOffset ?? 0.6
    this.maxRoll = opts.maxRoll ?? 0.05
    this.decay = opts.decay ?? 1.6
    if (opts.overlayParent) {
      const el = document.createElement('div')
      el.className = 'impact-flash'
      el.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;mix-blend-mode:screen;z-index:5'
      opts.overlayParent.append(el)
      this.overlay = el
    }
  }

  /** Freeze the simulation for `seconds` of wall time (optionally crawl at `scale`). */
  hitStop(seconds: number, scale = 0): void {
    if (seconds * (1 - scale) >= this.stopLeft * (1 - this.stopScale)) {
      this.stopLeft = seconds
      this.stopScale = scale
    }
  }

  /** Run the simulation at `scale` for `seconds`, then ease back to 1 over `recover` seconds. */
  slowMo(scale: number, seconds: number, recover = 0.35): void {
    this.slowScale = Math.min(this.slowLeft > 0 ? this.slowScale : 1, scale)
    this.slowLeft = Math.max(this.slowLeft, seconds)
    this.slowTotal = this.slowLeft
    this.slowRecover = recover
  }

  shake(trauma: number): void {
    this.trauma = Math.min(1, this.trauma + trauma * this.intensity)
  }

  /** Directional camera kick (screen-space units), e.g. recoil or a hit from the left. */
  kick(x: number, y: number): void {
    this.kickVel.x += x * this.intensity
    this.kickVel.y += y * this.intensity
  }

  flash(color: string, strength = 0.8, seconds = 0.18): void {
    if (!this.overlay) return
    const s = Math.min(1, strength * (0.35 + 0.65 * this.intensity))
    if (s < this.currentFlash()) return
    this.overlay.style.background = color
    this.flashStrength = s
    this.flashLeft = this.flashTotal = seconds
  }

  pulse(amount: number): void {
    this.pulseValue = Math.min(1, this.pulseValue + amount)
  }

  /** Current distortion pulse 0..1 (decays quickly). */
  get distortion(): number {
    return this.pulseValue
  }

  get timeScale(): number {
    let scale = 1
    if (this.stopLeft > 0) scale = this.stopScale
    if (this.slowLeft > 0) scale = Math.min(scale, this.slowScale)
    else if (this.slowRecoverLeft > 0) {
      const t = 1 - this.slowRecoverLeft / this.slowRecover
      scale = Math.min(scale, this.slowScale + (1 - this.slowScale) * t * t)
    }
    return scale
  }

  get stopped(): boolean {
    return this.stopLeft > 0
  }

  private slowRecoverLeft = 0

  update(realSeconds: number): void {
    const dt = Math.min(realSeconds, 0.1)
    this.time += dt
    if (this.stopLeft > 0) this.stopLeft = Math.max(0, this.stopLeft - dt)
    if (this.slowLeft > 0) {
      this.slowLeft = this.slowLeft - dt > 1e-6 ? this.slowLeft - dt : 0
      if (this.slowLeft === 0 && this.slowTotal > 0) this.slowRecoverLeft = this.slowRecover
    } else if (this.slowRecoverLeft > 0) {
      this.slowRecoverLeft = Math.max(0, this.slowRecoverLeft - dt)
      if (this.slowRecoverLeft === 0) this.slowScale = 1
    }
    this.trauma = Math.max(0, this.trauma - this.decay * dt)
    // Critically damped-ish spring back to rest for kicks. Integrated in fixed 1/240 s substeps:
    // one large explicit step (slow devices, tab hitches) would make the spring diverge.
    const k = 180
    const c = 18
    const steps = Math.ceil(dt * 240)
    const h = steps > 0 ? dt / steps : 0
    for (let i = 0; i < steps; i += 1) {
      for (const axis of ['x', 'y'] as const) {
        this.kickVel[axis] += (-k * this.kickPos[axis] - c * this.kickVel[axis]) * h
        this.kickPos[axis] += this.kickVel[axis] * h
      }
    }
    this.pulseValue = Math.max(0, this.pulseValue - dt * 3.2)
    if (this.overlay) {
      if (this.flashLeft > 0) this.flashLeft = Math.max(0, this.flashLeft - dt)
      const o = this.currentFlash()
      this.overlay.style.opacity = o > 0.001 ? o.toFixed(3) : '0'
    }
  }

  sampleShake(): ShakeSample {
    const t = this.time
    const s = this.trauma * this.trauma
    // Layered sines at incommensurate rates ≈ cheap smooth noise.
    const n = (a: number, b: number, c: number) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.1) * 0.2
    return {
      x: n(47, 71, 113) * s * this.maxOffset + this.kickPos.x,
      y: n(53, 89, 131) * s * this.maxOffset + this.kickPos.y,
      roll: n(37, 61, 97) * s * this.maxRoll,
    }
  }

  /** Drop every running effect (restart, quit to title). */
  clear(): void {
    this.trauma = 0
    this.stopLeft = 0
    this.slowLeft = 0
    this.slowRecoverLeft = 0
    this.slowScale = 1
    this.kickPos = { x: 0, y: 0 }
    this.kickVel = { x: 0, y: 0 }
    this.pulseValue = 0
    this.flashLeft = 0
    if (this.overlay) this.overlay.style.opacity = '0'
  }

  private currentFlash(): number {
    if (this.flashLeft <= 0 || this.flashTotal <= 0) return 0
    const t = this.flashLeft / this.flashTotal
    return this.flashStrength * t * t
  }
}
