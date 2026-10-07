import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { accuracy, addKill, createRun, formatClock, grade, graze, hurt, multiplier, repair, shotFired, shotHit, tick, win } from '../src/game/rules'

describe('run rules', () => {
  it('raises the multiplier every perLevel kills and caps it', () => {
    expect(multiplier(0)).toBe(1)
    expect(multiplier(CONFIG.combo.perLevel - 1)).toBe(1)
    expect(multiplier(CONFIG.combo.perLevel)).toBe(2)
    expect(multiplier(10_000)).toBe(CONFIG.combo.maxMultiplier)
  })

  it('scores kills with the chain multiplier and resets after the window', () => {
    let s = createRun()
    for (let i = 0; i < CONFIG.combo.perLevel - 1; i += 1) s = addKill(s, 100).state
    const r = addKill(s, 100)
    expect(r.levelUp).toBe(true)
    expect(r.points).toBe(200)
    s = tick(r.state, CONFIG.combo.window + 0.01)
    expect(s.combo).toBe(0)
    expect(s.maxCombo).toBe(CONFIG.combo.perLevel)
    expect(addKill(s, 100).points).toBe(100)
  })

  it('absorbs damage with the shield first, then the hull, and breaks the chain', () => {
    let s = addKill(createRun(), 100).state
    const a = hurt(s, CONFIG.shield.max + 10)
    expect(a.shieldDamage).toBe(CONFIG.shield.max)
    expect(a.hullDamage).toBe(10)
    expect(a.state.hull).toBe(CONFIG.hull.max - 10)
    expect(a.state.combo).toBe(0)
    s = a.state
    expect(hurt(s, 10).blocked).toBe(true)
  })

  it('regenerates the shield only after the delay', () => {
    let s = hurt(createRun(), 20).state
    const before = s.shield
    s = tick(s, CONFIG.shield.regenDelay * 0.5)
    expect(s.shield).toBe(before)
    s = tick(s, CONFIG.shield.regenDelay)
    s = tick(s, 1)
    expect(s.shield).toBeGreaterThan(before)
    expect(s.shield).toBeLessThanOrEqual(CONFIG.shield.max)
  })

  it('dies when the hull reaches zero and freezes afterwards', () => {
    let s = createRun()
    let died = false
    for (let i = 0; i < 40 && !died; i += 1) {
      const r = hurt(s, 30)
      died = r.died
      s = tick(r.state, CONFIG.invulnerable + 0.01)
    }
    expect(died).toBe(true)
    expect(s.phase).toBe('lost')
    expect(tick(s, 1)).toBe(s)
    expect(addKill(s, 100).points).toBe(0)
  })

  it('grazes add score and a little shield', () => {
    const s = hurt(createRun(), 20).state
    const g = graze(s)
    expect(g.points).toBe(CONFIG.score.graze)
    expect(g.state.grazes).toBe(1)
    // No shield from grazes while the post-hit regen delay is running...
    expect(g.state.shield).toBe(s.shield)
    // ...but a little once it has elapsed.
    const later = { ...s, shieldDelay: 0 }
    expect(graze(later).state.shield).toBeGreaterThan(later.shield)
  })

  it('repairs are capped', () => {
    const s = repair(hurt(createRun(), 90).state, 1000, 1000)
    expect(s.hull).toBe(CONFIG.hull.max)
    expect(s.shield).toBe(CONFIG.shield.max)
  })

  it('applies a selected aircraft hull maximum to starts, repairs and fair end bonuses', () => {
    const hullMax = 140
    const started = createRun(CONFIG, hullMax)
    expect(started.hull).toBe(hullMax)
    expect(repair({ ...started, hull: 100 }, 80, 0, CONFIG, hullMax).hull).toBe(hullMax)
    const finished = win({ ...started, hull: 70 }, CONFIG, hullMax)
    expect(finished.hullBonus).toBe(Math.round((70 / hullMax) * CONFIG.hull.max) * CONFIG.score.hullBonus)
  })

  it('adds clear, hull and flawless bonuses on win and grades the run', () => {
    const s = win(addKill(createRun(), 1000).state)
    expect(s.phase).toBe('won')
    expect(s.noDamageBonus).toBe(CONFIG.score.noDamage)
    expect(s.hullBonus).toBe(CONFIG.hull.max * CONFIG.score.hullBonus)
    expect(s.score).toBe(1000 + s.clearBonus + s.hullBonus + s.noDamageBonus)
    expect(grade(createRun())).toBe('D')
    expect(grade({ ...s, score: CONFIG.grades.S })).toBe('S')
    expect(grade({ ...s, score: CONFIG.grades.B })).toBe('B')
    const hit = win(hurt(createRun(), 5).state)
    expect(hit.noDamageBonus).toBe(0)
  })

  it('tracks accuracy', () => {
    let s = shotFired(createRun(), 4)
    s = shotHit(s)
    expect(accuracy(s)).toBe(0.25)
    expect(accuracy(createRun())).toBe(0)
  })

  it('formats the clock', () => {
    expect(formatClock(150)).toBe('2:30')
    expect(formatClock(59.9)).toBe('0:59')
    expect(formatClock(0)).toBe('0:00')
  })
})
