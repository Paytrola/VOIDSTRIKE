/**
 * Timeline event system: author pacing as a readable script, then drive it from fixed steps.
 *
 *   const tl = new TimelineBuilder<Ctx>()
 *     .label('intro').call(c => c.banner('SECTOR 7')).wait(2)
 *     .every(0.4, 8, (c, i) => c.spawn('scout', i))
 *     .gate(c => c.enemiesAlive() === 0, 12)   // hold the clock until cleared (or 12 s)
 *     .tween(3, (c, t) => c.setSpeed(30 + t * 20))
 *     .build()
 *   tl.update(dt, ctx)                         // once per simulation step
 *
 * Steps run at their scheduled script time. A gate freezes the script clock until its predicate
 * holds or its timeout expires, so every later step is relative to the moment the gate opened.
 * Tweens report eased progress 0..1 each step while active. `seek(label)` jumps to a label
 * without firing skipped calls (used for checkpoints and tests). `loop` restarts the script
 * (boss attack cycles). The component knows nothing about the game: `C` is any context type.
 */
export type Ease = (t: number) => number

export const Eases = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c = 1.70158
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  },
} satisfies Record<string, Ease>

type CallStep<C> = { kind: 'call'; at: number; fn: (ctx: C) => void }
type GateStep<C> = { kind: 'gate'; at: number; until: (ctx: C) => boolean; timeout: number }
type LabelStep = { kind: 'label'; at: number; name: string }
type TweenStep<C> = { kind: 'tween'; at: number; duration: number; ease: Ease; fn: (ctx: C, t: number) => void }
export type TimelineStep<C> = CallStep<C> | GateStep<C> | LabelStep | TweenStep<C>

export class TimelineBuilder<C> {
  private cursor = 0
  private readonly steps: TimelineStep<C>[] = []

  /** Current script time of the builder cursor (seconds). */
  get time(): number {
    return this.cursor
  }

  label(name: string): this {
    this.steps.push({ kind: 'label', at: this.cursor, name })
    return this
  }

  wait(seconds: number): this {
    this.cursor += Math.max(0, seconds)
    return this
  }

  /** Move the cursor to an absolute script time (may go backwards to layer parallel events). */
  at(seconds: number): this {
    this.cursor = Math.max(0, seconds)
    return this
  }

  call(fn: (ctx: C) => void): this {
    this.steps.push({ kind: 'call', at: this.cursor, fn })
    return this
  }

  /** Schedule `count` calls `interval` seconds apart starting at the cursor. Advances the cursor. */
  every(interval: number, count: number, fn: (ctx: C, index: number) => void): this {
    for (let i = 0; i < count; i += 1) {
      const index = i
      this.steps.push({ kind: 'call', at: this.cursor + i * interval, fn: ctx => fn(ctx, index) })
    }
    this.cursor += interval * count
    return this
  }

  /** Hold the clock until `until(ctx)` is true, or `timeout` seconds of held time pass. */
  gate(until: (ctx: C) => boolean, timeout = Infinity): this {
    this.steps.push({ kind: 'gate', at: this.cursor, until, timeout })
    return this
  }

  /** Report progress over `duration`. With `advance` the cursor moves past the tween. */
  tween(duration: number, fn: (ctx: C, t: number) => void, opts: { ease?: Ease; advance?: boolean } = {}): this {
    this.steps.push({ kind: 'tween', at: this.cursor, duration: Math.max(1e-4, duration), ease: opts.ease ?? Eases.linear, fn })
    if (opts.advance) this.cursor += duration
    return this
  }

  /** Insert a reusable fragment (e.g. a wave pattern) at the cursor. */
  use(fragment: (b: this) => void): this {
    fragment(this)
    return this
  }

  build(opts: { loop?: boolean } = {}): Timeline<C> {
    // Stable sort: same-time steps keep authoring order.
    const sorted = this.steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at || a.i - b.i).map(x => x.s)
    return new Timeline(sorted, Math.max(this.cursor, sorted.at(-1)?.at ?? 0), opts.loop ?? false)
  }
}

type ActiveTween<C> = { step: TweenStep<C> }

export class Timeline<C> {
  /** Script clock in seconds (frozen while a gate holds). */
  time = 0
  /** Total wall time spent in this timeline, including held gates. */
  elapsed = 0
  done = false
  private index = 0
  private held = 0
  private active: ActiveTween<C>[] = []
  private currentLabel = ''
  private listeners = new Set<(label: string) => void>()

  constructor(
    private readonly steps: TimelineStep<C>[],
    readonly duration: number,
    private readonly loop: boolean,
  ) {}

  get label(): string {
    return this.currentLabel
  }

  /** True while a gate is holding the clock. */
  get waiting(): boolean {
    const next = this.steps[this.index]
    return !!next && next.kind === 'gate' && this.time >= next.at
  }

  onLabel(fn: (label: string) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  update(dt: number, ctx: C): void {
    if (this.done) return
    this.elapsed += dt
    let target = this.time + dt
    while (this.index < this.steps.length) {
      const step = this.steps[this.index]
      if (step.at > target) break
      if (step.kind === 'gate') {
        if (!step.until(ctx)) {
          const overshoot = target - step.at
          this.held += Math.min(overshoot, dt)
          if (this.held < step.timeout) {
            target = step.at
            break
          }
        }
        this.held = 0
        this.index += 1
        continue
      }
      this.index += 1
      if (step.kind === 'call') step.fn(ctx)
      else if (step.kind === 'label') this.enterLabel(step.name)
      else this.active.push({ step })
    }
    this.time = target
    this.active = this.active.filter(({ step }) => {
      const raw = Math.min(1, Math.max(0, (this.time - step.at) / step.duration))
      step.fn(ctx, step.ease(raw))
      return raw < 1
    })
    if (this.index >= this.steps.length && this.active.length === 0 && this.time >= this.duration) {
      if (this.loop && this.steps.length > 0) this.restart()
      else this.done = true
    }
  }

  /** Jump to a label without firing skipped calls or tweens. Returns false if unknown. */
  seek(label: string): boolean {
    const i = this.steps.findIndex(s => s.kind === 'label' && s.name === label)
    if (i < 0) return false
    this.index = i
    this.time = this.steps[i].at
    this.held = 0
    this.active = []
    this.done = false
    return true
  }

  restart(): void {
    this.index = 0
    this.time = 0
    this.held = 0
    this.active = []
    this.done = false
  }

  hasLabel(label: string): boolean {
    return this.steps.some(s => s.kind === 'label' && s.name === label)
  }

  private enterLabel(name: string): void {
    this.currentLabel = name
    for (const fn of this.listeners) fn(name)
  }
}
