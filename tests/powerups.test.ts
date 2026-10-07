import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { collectPowerup, POWERUP_COLORS, POWERUP_KINDS, powerupForDrop } from '../src/game/powerups'
import { createRun } from '../src/game/rules'

describe('collectible power-ups', () => {
  it('cycles deterministically through health, shield and weapon drops', () => {
    expect([0, 1, 2, 3, 4].map(powerupForDrop)).toEqual(['health', 'shield', 'weapon', 'health', 'shield'])
    expect(powerupForDrop(-1)).toBe('weapon')
    expect(POWERUP_KINDS).toHaveLength(3)
  })

  it('uses distinct colors to distinguish the three pickup types', () => {
    expect(new Set(Object.values(POWERUP_COLORS)).size).toBe(3)
  })

  it('restores hull only and respects the selected aircraft maximum', () => {
    const damaged = { ...createRun(), hull: 20, shield: 15, shieldDelay: 2 }
    const collected = collectPowerup(damaged, 'health', 80)
    expect(collected.run.hull).toBe(20 + CONFIG.repair.hull)
    expect(collected.run.shield).toBe(15)
    expect(collected.run.shieldDelay).toBe(2)
    expect(collectPowerup({ ...damaged, hull: 75 }, 'health', 80).run.hull).toBe(80)
  })

  it('restores shield only up to the cap and resumes regeneration', () => {
    const damaged = { ...createRun(), hull: 42, shield: 50, shieldDelay: 3 }
    const collected = collectPowerup(damaged, 'shield', 100)
    expect(collected.run.hull).toBe(42)
    expect(collected.run.shield).toBe(CONFIG.shield.max)
    expect(collected.run.shieldDelay).toBe(0)
    expect(collectPowerup({ ...damaged, shield: 0 }, 'shield', 100).run.shield).toBe(CONFIG.repair.shield)
    const heavyAircraft = { ...damaged, hull: 132, shield: 20 }
    expect(collectPowerup(heavyAircraft, 'shield', 140).run.hull).toBe(132)
  })

  it('activates the weapon boost for the configured duration and refreshes instead of stacking', () => {
    const state = createRun()
    const first = collectPowerup(state, 'weapon', 100)
    expect(first.weaponBoostSeconds).toBe(CONFIG.powerups.weaponDuration)
    expect(first.run).toBe(state)
    const refreshed = collectPowerup(first.run, 'weapon', 100, 1.5)
    expect(refreshed.weaponBoostSeconds).toBe(CONFIG.powerups.weaponDuration)
    expect(CONFIG.powerups.weaponDamageMultiplier).toBeGreaterThan(1)
    expect(CONFIG.powerups.weaponFireRateMultiplier).toBeGreaterThan(1)
  })
})
