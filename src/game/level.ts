import { TimelineBuilder, type Timeline } from '../engine/timeline'
import type { FirePattern, SpawnSpec } from './enemies'

/**
 * Stage 1 "The Shattered Ring", authored as one engine Timeline. The Director (the scene) exposes
 * only verbs; every beat of pacing lives here as data, so re-pacing never touches gameplay code.
 */
export interface Director {
  spawn(spec: SpawnSpec): void
  rock(big: boolean, lane?: 'player' | 'random'): void
  mine(): void
  banner(key: string, sub: string, style: 'phase' | 'warning' | 'clear'): void
  hint(key: string | null): void
  setRail(kind: 'cruise' | 'boost' | 'boss'): void
  setMusic(section: string): void
  hostiles(): number
  warning(on: boolean): void
  letterbox(on: boolean): void
  cinematic(name: 'launch' | 'boss' | 'none'): void
  startBoss(): void
  bossDefeated(): boolean
  checkpointHere(): void
  tutorialFinished(): void
  readonly tutorial: boolean
}

type B = TimelineBuilder<Director>

// ─── formation fragments ────────────────────────────────────────────────
const snake = (side: number, fire: FirePattern = 'none', count = 6, y = 4) => (b: B) =>
  b.every(0.3, count, d =>
    d.spawn({ kind: 'mite', motion: 'swoop', p0: [side * 38, y, -78], p1: [-side * 4, y - 7, -44], p2: [-side * 42, y + 3, -34], duration: 5.4, fire, fireDelay: 1.4 + Math.random(), heat: 0.85 }),
  )

const vee = (cx: number, cy: number, fire: FirePattern = 'none') => (b: B) =>
  b.call(d => {
    const off = [[-6, 3], [-3, 1.5], [0, 0], [3, 1.5], [6, 3]]
    for (const [i, [dx, dy]] of off.entries()) {
      d.spawn({ kind: 'mite', motion: 'swoop', p0: [cx + dx, cy + dy + 16, -135], p1: [cx + dx * 1.3, cy + dy, -44], p2: [cx + dx * 3.2, cy + dy - 26, 6], duration: 5.8 + i * 0.05, fire, fireDelay: 1.2 + i * 0.25, heat: 0.9 })
    }
  })

const spiral = (fire: FirePattern = 'none') => (b: B) =>
  b.every(0.18, 8, (d, i) => {
    const a = (i / 8) * Math.PI * 2
    d.spawn({ kind: 'mite', motion: 'swoop', p0: [Math.cos(a) * 32, Math.sin(a) * 20, -92], p1: [Math.cos(a + 1.3) * 7, Math.sin(a + 1.3) * 4, -42], p2: [Math.cos(a + 2.7) * 38, Math.sin(a + 2.7) * 24, -22], duration: 5.2, fire, fireDelay: 1.5 })
  })

const overtake = (fire: FirePattern = 'none', count = 6) => (b: B) =>
  b.every(0.22, count, (d, i) => {
    const side = i % 2 ? 1 : -1
    const x = side * (3 + (i % 3) * 2.2)
    const y = -2 + (i % 3) * 2
    d.spawn({ kind: 'mite', motion: 'swoop', p0: [x * 1.6, y - 3, 18], p1: [x * 0.7, y + 1, -26], p2: [x * 2.4, y + 8, -118], duration: 5, fire, fireDelay: 1.6 })
  })

const chisel = (x: number, y: number, fire: FirePattern, hold = 4.5, drop = false) => (d: Director) =>
  d.spawn({ kind: 'chisel', motion: 'hold', p0: [x * 3, y + 20, -115], p1: [x, y, -46], p2: [x * 4, y + 26, -85], hold, fire, fireDelay: 0.3, drop })

const lantern = (x: number, y: number, fire: FirePattern = 'spiral', hold = 7) => (d: Director) =>
  d.spawn({ kind: 'lantern', motion: 'hold', p0: [x, y + 32, -125], p1: [x, y, -56], p2: [x, y - 40, -95], hold, fire, fireDelay: 0.2, drop: true })

// ─── the stage ──────────────────────────────────────────────────────────
export function buildStage(): Timeline<Director> {
  const b = new TimelineBuilder<Director>()
  b.label('intro')
    .call(d => {
      d.setMusic('cruise')
      d.setRail('cruise')
      d.letterbox(true)
      d.cinematic('launch')
      d.banner('stage.title', 'stage.sub', 'phase')
    })
    .wait(3.4)
    .call(d => {
      d.letterbox(false)
      d.cinematic('none')
      if (d.tutorial) d.hint('hint.move')
    })
    .wait(1.2)

  b.label('warmup')
    .use(snake(-1))
    .wait(2.2)
    .call(d => d.tutorial && d.hint('hint.fire'))
    .use(snake(1))
    .wait(3.2)
    .use(vee(0, 2, 'aimed'))
    .wait(3.6)
    .call(d => d.tutorial && d.hint('hint.roll'))
    .use(vee(-8, -1, 'aimed'))
    .wait(0.8)
    .use(vee(8, 3, 'aimed'))
    .gate(d => d.hostiles() === 0, 7)
    .call(d => {
      d.hint(null)
      d.tutorialFinished()
    })
    .wait(0.8)

  b.label('wave1')
    .call(d => {
      d.banner('wave1.title', 'wave1.sub', 'phase')
      d.setMusic('battle')
    })
    .wait(1.6)
    .use(snake(-1, 'aimed', 7, 5))
    .wait(1.0)
    .use(snake(1, 'aimed', 7, -1))
    .wait(2.6)
    .call(chisel(-7, 3, 'fan3'))
    .call(chisel(7, 3, 'fan3'))
    .wait(3.2)
    .use(spiral('aimed'))
    .wait(3.0)
    .call(d => d.hint(null))
    .use(overtake('aimed', 8))
    .wait(3.0)
    .call(chisel(-9, -2, 'burst'))
    .call(chisel(0, 5, 'burst', 4.5, true))
    .call(chisel(9, -2, 'burst'))
    .wait(3.4)
    .call(lantern(0, 1.5))
    .wait(1.4)
    .use(vee(-12, 5))
    .wait(1.2)
    .use(vee(12, -3))
    .gate(d => d.hostiles() === 0, 14)
    .wait(1.0)

  b.label('storm')
    .call(d => {
      d.banner('storm.title', 'storm.sub', 'warning')
      d.setRail('boost')
      d.setMusic('storm')
    })
    .wait(1.2)
  const rocksStart = b.time
  b.every(0.32, 56, (d, i) => {
      d.rock(i % 9 === 4, i % 6 === 0 ? 'player' : 'random')
      if (i % 2) d.rock(false)
      if (i % 11 === 5) d.mine()
    })
  const rocksEnd = b.time
  // Layer two harmless formations over the rock storm for bonus points.
  b.at(rocksStart + 5)
    .use(snake(-1, 'none', 6, 6))
    .wait(3.5)
    .use(snake(1, 'none', 6, -3))
    .at(rocksEnd + 1.5)
    .call(d => d.setRail('cruise'))
    .wait(2.2)

  b.label('wave2')
    .call(d => {
      d.banner('wave2.title', 'wave2.sub', 'phase')
      d.setMusic('battle')
    })
    .wait(1.6)
    .call(chisel(-8, 4, 'ring', 5))
    .call(chisel(8, 4, 'ring', 5))
    .call(chisel(0, -3, 'fan5', 5, true))
    .wait(3.8)
    .use(overtake('burst', 8))
    .wait(3.4)
    .call(lantern(-9, 3, 'spiral', 7))
    .call(lantern(9, 3, 'ring', 7))
    .wait(2.5)
    .use(snake(-1, 'aimed', 6, -4))
    .wait(4.5)
    .use(vee(0, 8, 'fan3'))
    .wait(0.6)
    .use(vee(0, -6, 'aimed'))
    .wait(3)
    .call(chisel(-6, 0, 'fan5', 4))
    .call(chisel(6, 0, 'fan5', 4, true))
    .every(0.9, 5, d => d.rock(false, 'random'))
    .use(spiral('burst'))
    .wait(2.5)
    .call(lantern(0, 2, 'spiral', 6))
    .use(snake(1, 'aimed', 6, 7))
    .gate(d => d.hostiles() === 0, 16)
    .wait(1.2)

  b.label('boss')
    .call(d => {
      d.checkpointHere()
      d.setRail('boss')
      d.setMusic('none')
      d.warning(true)
      d.banner('warning.title', 'warning.sub', 'warning')
    })
    .wait(3.6)
    .call(d => {
      d.warning(false)
      d.letterbox(true)
      d.cinematic('boss')
      d.startBoss()
      d.setMusic('boss')
    })
    .wait(5.2)
    .call(d => {
      d.letterbox(false)
      d.cinematic('none')
    })
    .gate(d => d.bossDefeated())
    .label('clear')
  return b.build()
}
