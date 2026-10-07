import { describe, expect, it } from 'vitest'
import type { Audio } from '../src/engine/audio'
import { defineSounds } from '../src/game/audio-content'
import { AIRCRAFT_CLASSES, AIRCRAFT_CLASS_IDS, isAircraftClassId } from '../src/game/aircraft'

describe('aircraft classes', () => {
  it('defines three persistent selectable classes with distinct hull and flight speed', () => {
    expect(AIRCRAFT_CLASS_IDS).toEqual(['wraith', 'bulwark', 'tempest'])
    expect(AIRCRAFT_CLASSES.wraith.hp).toBe(80)
    expect(AIRCRAFT_CLASSES.wraith.speedMultiplier).toBe(1.25)
    expect(AIRCRAFT_CLASSES.bulwark.hp).toBe(140)
    expect(AIRCRAFT_CLASSES.bulwark.speedMultiplier).toBe(0.78)
    expect(AIRCRAFT_CLASSES.tempest.hp).toBe(100)
    expect(AIRCRAFT_CLASSES.tempest.speedMultiplier).toBe(1)
  })

  it('gives each aircraft a unique weapon, ability, sound and cooldown profile', () => {
    const profiles = Object.values(AIRCRAFT_CLASSES)
    expect(profiles.map(p => p.weapon.kind)).toEqual(['twin', 'siege', 'triad'])
    expect(profiles.map(p => p.weapon.sound)).toEqual(['shoot', 'siegeShot', 'triadShot'])
    expect(profiles.map(p => p.ability.kind)).toEqual(['afterburn', 'aegis', 'emp'])
    expect(profiles.map(p => p.ability.cooldown)).toEqual([12, 18, 20])
    expect(profiles.map(p => p.ability.sound)).toEqual(['abilityBoost', 'abilityAegis', 'abilityEMP'])
  })

  it('registers every class-specific weapon and ability sound in the existing SFX mixer', () => {
    const names: string[] = []
    defineSounds({ define: (name: string) => names.push(name) } as unknown as Audio)
    expect(names).toEqual(expect.arrayContaining(['shoot', 'siegeShot', 'triadShot', 'abilityBoost', 'abilityAegis', 'abilityEMP']))
  })

  it('validates persisted class identifiers without accepting unknown values', () => {
    expect(isAircraftClassId('wraith')).toBe(true)
    expect(isAircraftClassId('tempest')).toBe(true)
    expect(isAircraftClassId('unknown')).toBe(false)
    expect(isAircraftClassId(null)).toBe(false)
  })
})
