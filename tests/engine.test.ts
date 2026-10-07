import { describe, expect, it } from 'vitest'
import { Impact } from '../src/engine/impact'
import { ObjectPool } from '../src/engine/pool'
import { Eases, TimelineBuilder } from '../src/engine/timeline'

type Ctx = { log: string[]; open: boolean; value: number }
const ctx = (): Ctx => ({ log: [], open: false, value: 0 })
const run = (tl: { update(dt: number, c: Ctx): void }, c: Ctx, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) tl.update(dt, c)
}

describe('timeline', () => {
  it('fires calls in script order at their times', () => {
    const tl = new TimelineBuilder<Ctx>()
      .call(c => c.log.push('a'))
      .wait(1)
      .call(c => c.log.push('b'))
      .every(0.5, 3, (c, i) => c.log.push(`e${i}`))
      .build()
    const c = ctx()
    run(tl, c, 0.5)
    expect(c.log).toEqual(['a'])
    run(tl, c, 0.6)
    expect(c.log).toEqual(['a', 'b', 'e0'])
    run(tl, c, 2)
    expect(c.log).toEqual(['a', 'b', 'e0', 'e1', 'e2'])
    expect(tl.done).toBe(true)
  })

  it('holds the clock at a gate until it opens', () => {
    const tl = new TimelineBuilder<Ctx>().gate(c => c.open).wait(1).call(c => c.log.push('after')).build()
    const c = ctx()
    run(tl, c, 5)
    expect(c.log).toEqual([])
    expect(tl.waiting).toBe(true)
    c.open = true
    run(tl, c, 0.5)
    expect(c.log).toEqual([])
    run(tl, c, 0.6)
    expect(c.log).toEqual(['after'])
  })

  it('lets a gate time out', () => {
    const tl = new TimelineBuilder<Ctx>().gate(() => false, 2).call(c => c.log.push('late')).build()
    const c = ctx()
    run(tl, c, 1.9)
    expect(c.log).toEqual([])
    run(tl, c, 0.3)
    expect(c.log).toEqual(['late'])
  })

  it('reports eased tween progress and finishes at 1', () => {
    const tl = new TimelineBuilder<Ctx>().tween(1, (c, t) => (c.value = t), { ease: Eases.linear, advance: true }).build()
    const c = ctx()
    run(tl, c, 0.5)
    expect(c.value).toBeGreaterThan(0.4)
    expect(c.value).toBeLessThan(0.6)
    run(tl, c, 1)
    expect(c.value).toBe(1)
  })

  it('seeks to labels without firing skipped calls and loops', () => {
    const tl = new TimelineBuilder<Ctx>()
      .call(c => c.log.push('intro'))
      .wait(10)
      .label('boss')
      .call(c => c.log.push('boss'))
      .wait(1)
      .build({ loop: true })
    const c = ctx()
    expect(tl.seek('boss')).toBe(true)
    run(tl, c, 0.1)
    expect(c.log).toEqual(['boss'])
    expect(tl.label).toBe('boss')
    run(tl, c, 1)
    expect(c.log[1]).toBe('intro')
    expect(tl.seek('missing')).toBe(false)
  })
})

describe('impact toolkit', () => {
  it('freezes time during hit-stop and recovers from slow motion', () => {
    const fx = new Impact()
    fx.hitStop(0.1)
    expect(fx.timeScale).toBe(0)
    fx.update(0.05)
    expect(fx.stopped).toBe(true)
    fx.update(0.06)
    expect(fx.timeScale).toBe(1)
    fx.slowMo(0.25, 0.5, 0.2)
    expect(fx.timeScale).toBe(0.25)
    for (let i = 0; i < 5; i += 1) fx.update(0.1)
    fx.update(0.1)
    expect(fx.timeScale).toBeGreaterThan(0.25)
    fx.update(0.2)
    expect(fx.timeScale).toBe(1)
  })

  it('keeps the kick spring stable at low frame rates', () => {
    const fx = new Impact()
    for (let i = 0; i < 200; i += 1) {
      fx.kick(0.1, -0.05)
      fx.update(0.1)
    }
    const s = fx.sampleShake()
    expect(Math.abs(s.x)).toBeLessThan(1)
    expect(Math.abs(s.y)).toBeLessThan(1)
  })
  it('scales shake with trauma and decays to rest', () => {
    const fx = new Impact({ maxOffset: 1 })
    fx.shake(1)
    let peak = 0
    for (let i = 0; i < 10; i += 1) {
      fx.update(1 / 60)
      const s = fx.sampleShake()
      peak = Math.max(peak, Math.abs(s.x) + Math.abs(s.y))
    }
    expect(peak).toBeGreaterThan(0.05)
    for (let i = 0; i < 120; i += 1) fx.update(1 / 60)
    const rest = fx.sampleShake()
    expect(Math.abs(rest.x) + Math.abs(rest.y)).toBeLessThan(1e-3)
  })

  it('respects intensity 0 for reduced motion', () => {
    const fx = new Impact()
    fx.intensity = 0
    fx.shake(1)
    fx.kick(5, 5)
    fx.update(1 / 60)
    const s = fx.sampleShake()
    expect(Math.abs(s.x) + Math.abs(s.y)).toBe(0)
  })
})

describe('object pool', () => {
  it('reuses released objects and honours capacity', () => {
    let created = 0
    const pool = new ObjectPool(() => ({ id: created++ }), 0, 3)
    const a = pool.acquire()!
    pool.acquire()
    pool.acquire()
    expect(pool.acquire()).toBeUndefined()
    pool.update(item => item !== a)
    expect(pool.size).toBe(2)
    expect(pool.acquire()).toBe(a)
    expect(created).toBe(3)
  })
})
