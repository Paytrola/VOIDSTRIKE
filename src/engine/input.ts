/**
 * Unified input: keyboard + mouse, gamepad and touch all feed one action state.
 * Gameplay reads `move` (ship steering), aim sources (`takeMouseDelta`, `pointer`, `aim`) and
 * `held()/consume()` for actions; it never checks raw keys.
 *
 * Bindings
 *   Keyboard/mouse: WASD/arrows steer, mouse aims (pointer lock gives relative aim), left mouse
 *                   or J fires, Space / K / right mouse rolls, E activates the aircraft ability, Esc/P pauses.
 *   Gamepad:        left stick steers, right stick aims, RT/RB/A fire, LT/X roll, LB ability, Start pauses.
 *   Touch:          on-screen stick steers, FIRE and ROLL buttons (see ui/touch.ts).
 *
 * Call `update()` once per rendered frame before gameplay and `endFrame()` after it.
 */
export type Action = 'fire' | 'roll' | 'ability' | 'pause' | 'confirm' | 'back' | 'skip'
export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  fire: ['KeyJ'],
  roll: ['Space', 'KeyK'],
  ability: ['KeyE'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  back: [],
  skip: ['Tab'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standard mapping: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9.
const PAD_BINDINGS: Record<Action, number[]> = { fire: [7, 5, 0], roll: [6, 2], ability: [4], pause: [9], confirm: [0], back: [1], skip: [8, 3] }

export class Input {
  /** Steering intent in [-1, 1]: x = right, y = up. */
  readonly move = { x: 0, y: 0 }
  /** Right-stick aim in [-1, 1] (gamepad). */
  readonly aim = { x: 0, y: 0 }
  /** Last absolute pointer position in NDC (-1..1, y up) and whether it moved since read. */
  readonly pointer = { x: 0, y: 0, moved: false }
  /** Touch-first devices (phones, tablets) start in touch mode so prompts and controls fit. */
  method: InputMethod = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches ? 'touch' : 'keyboard'
  /** Multiplies aim speed for mouse deltas and sticks; settings write it. */
  sensitivity = 1
  invertY = false
  private keys = new Set<string>()
  private mouseButtons = new Set<number>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private mouseDelta = { x: 0, y: 0 }
  private touchMove = { x: 0, y: 0 }
  private touchButtons = new Set<Action>()
  private padPrev = new Set<Action>()
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea')
      if (typing) return
      if (!e.repeat) {
        this.keys.add(e.code)
        this.method = 'keyboard'
        for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
          if (codes.includes(e.code)) this.pressed_.add(action)
        }
      }
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault()
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.mouseButtons.clear()
    })
    on(canvas, 'mousedown', e => {
      this.method = 'keyboard'
      this.mouseButtons.add(e.button)
      if (e.button === 2) this.pressed_.add('roll')
      if (e.button === 0) this.pressed_.add('fire')
    })
    on(window, 'mouseup', e => this.mouseButtons.delete(e.button))
    on(canvas, 'contextmenu', e => e.preventDefault())
    on(window, 'mousemove', e => {
      if (document.pointerLockElement === canvas) {
        this.mouseDelta.x += e.movementX
        this.mouseDelta.y += e.movementY
      } else {
        const r = canvas.getBoundingClientRect()
        this.pointer.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1
        this.pointer.y = -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1)
        this.pointer.moved = true
      }
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) this.method = 'keyboard'
    })
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas
  }

  /** Request pointer lock for relative mouse aim (must be called from a user gesture). */
  lockPointer(): void {
    if (this.method !== 'touch' && document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined
        p?.catch?.(() => undefined)
      } catch {
        // Unsupported (embedded frames): absolute pointer aim still works.
      }
    }
  }

  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  /** Touch controls feed these from the on-screen stick and buttons. */
  setTouchMove(x: number, y: number): void {
    this.method = 'touch'
    this.touchMove.x = x
    this.touchMove.y = y
  }

  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action)
    else this.touchButtons.delete(action)
  }

  /** Sample continuous sources. Call once per rendered frame before gameplay reads input. */
  update(): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      if (k(codes)) this.held_.add(action)
    }
    if (this.mouseButtons.has(0)) this.held_.add('fire')
    if (this.mouseButtons.has(2)) this.held_.add('roll')
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
      x = this.touchMove.x
      y = this.touchMove.y
    }
    this.aim.x = 0
    this.aim.y = 0
    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      const dead = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84)
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const rx = dead(pad.axes[2] ?? 0)
      const ry = dead(pad.axes[3] ?? 0)
      const padActive = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || pad.buttons.some(b => b.pressed)
      if (padActive) this.method = 'gamepad'
      if (lx !== 0 || ly !== 0) {
        x = lx
        y = -ly
      }
      this.aim.x = rx
      this.aim.y = -ry * (this.invertY ? -1 : 1)
      const now = new Set<Action>()
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => (pad.buttons[i]?.value ?? 0) > 0.35 || pad.buttons[i]?.pressed)) now.add(action)
      }
      for (const action of now) {
        this.held_.add(action)
        if (!this.padPrev.has(action)) this.pressed_.add(action)
      }
      this.padPrev = now
    }
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x
    this.move.y = len > 1 ? y / len : y
  }

  held(action: Action): boolean {
    return this.held_.has(action)
  }

  /** True once per physical press. */
  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }

  /**
   * Read and clear a press. Use this inside fixed simulation steps: several steps can run in one
   * rendered frame, and a press must trigger exactly one roll/confirm.
   */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }

  /** Relative mouse movement (pixels × sensitivity) since the last read, with invert applied. */
  takeMouseDelta(): { x: number; y: number } {
    const out = { x: this.mouseDelta.x * this.sensitivity, y: this.mouseDelta.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.mouseDelta.x = 0
    this.mouseDelta.y = 0
    return out
  }

  /** Read the absolute pointer if it moved since the last read. */
  takePointer(): { x: number; y: number } | null {
    if (!this.pointer.moved) return null
    this.pointer.moved = false
    return { x: this.pointer.x, y: this.pointer.y }
  }

  endFrame(): void {
    this.pressed_.clear()
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
