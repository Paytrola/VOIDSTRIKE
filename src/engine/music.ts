import type { Audio } from './audio'

/**
 * Tiny step sequencer for original, fully synthesized music. A song is a set of sections; each
 * section loops bars of 16 steps with drum, bass, arpeggio, pad and lead tracks. Switching
 * sections is quantized to the next bar so transitions always land on the beat.
 *
 * Track strings have one character per 16th step:
 *   drums: 'x' hit, 'o' accent/open, '.' rest
 *   bass/arp: '0'..'3' chord tone, 'r' root +1 octave, '.' rest
 * `lead` lists semitone offsets from the bar's root per step (null = rest).
 */
export type Section = {
  /** Chords per bar (MIDI note numbers), cycled. */
  chords: number[][]
  kick?: string
  snare?: string
  hat?: string
  bass?: string
  arp?: string
  lead?: (number | null)[]
  pad?: boolean
  arpFilter?: number
  gain?: Partial<Record<'kick' | 'snare' | 'hat' | 'bass' | 'arp' | 'pad' | 'lead', number>>
}

export type Song = { bpm: number; sections: Record<string, Section> }

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export class Sequencer {
  private timer = 0
  private current?: Section
  private next?: Section
  private step = 0
  private bar = 0
  private nextTime = 0
  private readonly stepDur: number
  currentName = ''

  constructor(private readonly audio: Audio, private readonly song: Song) {
    this.stepDur = 60 / song.bpm / 4
  }

  get playing(): boolean {
    return this.timer !== 0
  }

  /** Start or change section. `immediate` skips bar quantization. */
  play(name: string, immediate = false): void {
    const section = this.song.sections[name]
    if (!section || name === this.currentName) return
    this.currentName = name
    if (!this.current || immediate || this.timer === 0) {
      this.current = section
      this.step = 0
      this.bar = 0
      this.nextTime = this.audio.now + 0.06
    } else this.next = section
    if (this.timer === 0) this.timer = window.setInterval(() => this.schedule(), 25)
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = 0
    this.current = undefined
    this.next = undefined
    this.currentName = ''
  }

  private schedule(): void {
    if (!this.current) return
    if (!this.audio.running) {
      this.nextTime = this.audio.now + 0.06
      return
    }
    // After a long stall (tab hidden), resync instead of bursting notes.
    if (this.nextTime < this.audio.now - 0.2) this.nextTime = this.audio.now + 0.05
    while (this.nextTime < this.audio.now + 0.14) {
      if (this.step === 0 && this.next) {
        this.current = this.next
        this.next = undefined
        this.bar = 0
      }
      this.playStep(this.current, this.step, this.nextTime)
      this.nextTime += this.stepDur
      this.step = (this.step + 1) % 16
      if (this.step === 0) this.bar += 1
    }
  }

  private playStep(s: Section, i: number, when: number): void {
    const a = this.audio
    const d = Math.max(0, when - a.now)
    const chord = s.chords[this.bar % s.chords.length]
    const g = { kick: 1, snare: 1, hat: 1, bass: 1, arp: 1, pad: 1, lead: 1, ...s.gain }
    const ch = (track?: string) => (track ? track[i % track.length] : '.')
    const k = ch(s.kick)
    if (k !== '.') {
      a.tone({ freq: 150, to: 42, dur: 0.28, type: 'sine', vol: (k === 'o' ? 0.95 : 0.8) * g.kick, delay: d, attack: 0.002, bus: 'music' })
      a.noise({ dur: 0.02, vol: 0.12 * g.kick, from: 3000, delay: d, bus: 'music' })
    }
    const sn = ch(s.snare)
    if (sn !== '.') {
      a.noise({ dur: sn === 'o' ? 0.3 : 0.17, vol: 0.32 * g.snare, from: 2400, to: 900, filterType: 'bandpass', q: 0.8, delay: d, bus: 'music' })
      a.tone({ freq: 220, to: 130, dur: 0.1, type: 'triangle', vol: 0.18 * g.snare, delay: d, bus: 'music' })
    }
    const h = ch(s.hat)
    if (h !== '.') a.noise({ dur: h === 'o' ? 0.18 : 0.035, vol: (h === 'o' ? 0.1 : 0.075) * g.hat, from: 9000, filterType: 'highpass', delay: d, bus: 'music' })
    const note = (c: string, octave: number) => {
      if (c === '.' || !chord) return null
      if (c === 'r') return chord[0] + 12 + octave * 12
      const idx = Number(c)
      if (!Number.isFinite(idx)) return null
      return chord[idx % chord.length] + octave * 12
    }
    const b = note(ch(s.bass), -2)
    if (b !== null) {
      a.tone({ freq: midiHz(b), dur: this.stepDur * 1.7, type: 'sawtooth', vol: 0.16 * g.bass, filter: 520, delay: d, bus: 'music' })
      a.tone({ freq: midiHz(b - 12), dur: this.stepDur * 1.7, type: 'sine', vol: 0.2 * g.bass, delay: d, bus: 'music' })
    }
    const ar = note(ch(s.arp), 1)
    if (ar !== null) a.tone({ freq: midiHz(ar), dur: this.stepDur * 1.1, type: 'square', vol: 0.045 * g.arp, filter: s.arpFilter ?? 2400, delay: d, bus: 'music', pan: i % 2 ? 0.3 : -0.3 })
    const lead = s.lead?.[i % (s.lead?.length ?? 1)]
    if (lead !== undefined && lead !== null && chord) {
      const m = chord[0] + 24 + lead
      a.tone({ freq: midiHz(m), dur: this.stepDur * 2.2, type: 'sawtooth', vol: 0.05 * g.lead, filter: 3200, delay: d, attack: 0.02, bus: 'music', detune: 6 })
      a.tone({ freq: midiHz(m), dur: this.stepDur * 2.2, type: 'triangle', vol: 0.05 * g.lead, delay: d, attack: 0.02, bus: 'music', detune: -6 })
    }
    if (s.pad && i === 0 && chord) {
      const len = this.stepDur * 16
      for (const n of chord) {
        for (const det of [-9, 9]) a.tone({ freq: midiHz(n), dur: len * 1.05, type: 'sawtooth', vol: 0.022 * g.pad, filter: 1100, attack: len * 0.25, delay: d, detune: det, bus: 'music' })
      }
    }
  }
}
