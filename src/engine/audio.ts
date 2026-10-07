/**
 * Web Audio mixer: master → limiter → speakers, with music and SFX buses. Browsers only allow
 * audio after a user gesture, so call `unlock()` from the first click/key press.
 *
 * Sound effects are synthesized from recipes. The engine provides the primitives (`tone`,
 * `noise`) and a registry; games `define()` their own named sounds and `play(name)` them.
 * Rapid repeats of one sound are throttled so a wall of bullets never clips the mix.
 */
export type ToneOpts = {
  freq: number
  /** End frequency for an exponential glide. */
  to?: number
  dur: number
  type?: OscillatorType
  vol?: number
  delay?: number
  attack?: number
  /** Lowpass cutoff (Hz). */
  filter?: number
  detune?: number
  bus?: 'sfx' | 'music'
  pan?: number
  /** Also feed the echo send (0..1). */
  echo?: number
}

export type NoiseOpts = {
  dur: number
  vol?: number
  delay?: number
  attack?: number
  /** Filter sweep start/end (Hz). */
  from?: number
  to?: number
  filterType?: BiquadFilterType
  q?: number
  bus?: 'sfx' | 'music'
  pan?: number
  echo?: number
}

export type Recipe = (a: Audio, variant: number) => void

export class Audio {
  readonly ctx: AudioContext
  readonly master: GainNode
  readonly musicBus: GainNode
  readonly sfxBus: GainNode
  /** Send into a feedback delay for spacey tails. */
  readonly echo: GainNode
  private readonly duck: GainNode
  private readonly recipes = new Map<string, { fn: Recipe; minGap: number }>()
  private readonly lastPlayed = new Map<string, number>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private noiseBuffer?: AudioBuffer

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.musicBus = this.ctx.createGain()
    this.sfxBus = this.ctx.createGain()
    this.duck = this.ctx.createGain()
    const limiter = this.ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.knee.value = 8
    limiter.ratio.value = 8
    limiter.attack.value = 0.003
    limiter.release.value = 0.18
    this.musicBus.connect(this.duck).connect(this.master)
    this.sfxBus.connect(this.master)
    this.master.connect(limiter).connect(this.ctx.destination)
    this.echo = this.ctx.createGain()
    this.echo.gain.value = 0.25
    const delay = this.ctx.createDelay(1)
    delay.delayTime.value = 0.23
    const fb = this.ctx.createGain()
    fb.gain.value = 0.32
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600
    this.echo.connect(delay)
    delay.connect(lp)
    lp.connect(fb).connect(delay)
    lp.connect(this.sfxBus)
  }

  get now(): number {
    return this.ctx.currentTime
  }

  get running(): boolean {
    return this.ctx.state === 'running'
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volumes in 0..1. */
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.musicBus.gain.setTargetAtTime(muted ? 0 : music * 0.6, t, 0.05)
    this.sfxBus.gain.setTargetAtTime(muted ? 0 : sfx * 0.85, t, 0.05)
  }

  /** Lower the music (pause menus): 1 = full, 0 = silent. */
  duckMusic(level: number, seconds = 0.25): void {
    this.duck.gain.setTargetAtTime(level, this.ctx.currentTime, seconds / 3)
  }

  /** Register a named sound. `minGap` throttles repeats (seconds). */
  define(name: string, fn: Recipe, minGap = 0.03): void {
    this.recipes.set(name, { fn, minGap })
  }

  play(name: string, variant = 0): void {
    if (this.ctx.state !== 'running') return
    const recipe = this.recipes.get(name)
    if (!recipe) return
    const t = this.ctx.currentTime
    if (t - (this.lastPlayed.get(name) ?? -1) < recipe.minGap) return
    this.lastPlayed.set(name, t)
    recipe.fn(this, variant)
  }

  // ─── primitives ─────────────────────────────────────────────────────────
  tone(o: ToneOpts, out?: AudioNode): void {
    const t = this.ctx.currentTime + (o.delay ?? 0)
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = o.type ?? 'sine'
    osc.frequency.setValueAtTime(o.freq, t)
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(o.to, 20), t + o.dur)
    if (o.detune) osc.detune.value = o.detune
    const attack = o.attack ?? 0.006
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(o.vol ?? 0.2, 0.0002), t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    let node: AudioNode = osc
    if (o.filter) {
      const f = this.ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = o.filter
      node.connect(f)
      node = f
    }
    node.connect(g)
    this.route(g, o.bus, o.pan, out, o.echo)
    osc.start(t)
    osc.stop(t + o.dur + 0.05)
  }

  noise(o: NoiseOpts, out?: AudioNode): void {
    const t = this.ctx.currentTime + (o.delay ?? 0)
    const src = this.ctx.createBufferSource()
    src.buffer = this.getNoise()
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = o.filterType ?? 'lowpass'
    f.Q.value = o.q ?? 0.7
    f.frequency.setValueAtTime(o.from ?? 4000, t)
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(o.to, 30), t + o.dur)
    const g = this.ctx.createGain()
    const attack = o.attack ?? 0.004
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(o.vol ?? 0.2, 0.0002), t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
    src.connect(f).connect(g)
    this.route(g, o.bus, o.pan, out, o.echo)
    src.start(t, Math.random() * 1.5)
    src.stop(t + o.dur + 0.05)
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    return buffer
  }

  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = loop
    src.connect(bus === 'music' ? this.musicBus : this.sfxBus)
    src.start()
    return src
  }

  getNoise(): AudioBuffer {
    if (!this.noiseBuffer) {
      const len = this.ctx.sampleRate * 2
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuffer.getChannelData(0)
      for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1
    }
    return this.noiseBuffer
  }

  private route(node: AudioNode, bus: 'sfx' | 'music' = 'sfx', pan = 0, out?: AudioNode, echo = 0): void {
    let tail = node
    if (pan) {
      const p = this.ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, pan))
      node.connect(p)
      tail = p
    }
    tail.connect(out ?? (bus === 'music' ? this.musicBus : this.sfxBus))
    if (echo > 0) {
      const send = this.ctx.createGain()
      send.gain.value = echo
      tail.connect(send).connect(this.echo)
    }
  }
}
