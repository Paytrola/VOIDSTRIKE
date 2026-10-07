import type { AircraftClassId } from '../engine/save'

export type WeaponKind = 'twin' | 'siege' | 'triad'
export type AbilityKind = 'afterburn' | 'aegis' | 'emp'

export type AircraftProfile = {
  id: AircraftClassId
  titleKey: string
  roleKey: string
  hp: number
  speedMultiplier: number
  tint: string
  weapon: {
    kind: WeaponKind
    nameKey: string
    descriptionKey: string
    damageMultiplier: number
    rateMultiplier: number
    spread: number
    color: string
    sound: string
  }
  ability: {
    kind: AbilityKind
    nameKey: string
    descriptionKey: string
    cooldown: number
    duration: number
    sound: string
    speedBoost?: number
    fireRateBoost?: number
  }
}

/** Combat profiles deliberately reuse the supplied ship model and layer over CONFIG/Tweak. */
export const AIRCRAFT_CLASSES: Record<AircraftClassId, AircraftProfile> = {
  wraith: {
    id: 'wraith', titleKey: 'aircraft.wraith.name', roleKey: 'aircraft.wraith.role', hp: 80, speedMultiplier: 1.25, tint: '#ffffff',
    weapon: { kind: 'twin', nameKey: 'aircraft.wraith.weapon', descriptionKey: 'aircraft.wraith.weaponDesc', damageMultiplier: 0.55, rateMultiplier: 1, spread: 0, color: '#4fe3ff', sound: 'shoot' },
    ability: { kind: 'afterburn', nameKey: 'aircraft.wraith.ability', descriptionKey: 'aircraft.wraith.abilityDesc', cooldown: 12, duration: 2.5, sound: 'abilityBoost', speedBoost: 1.35, fireRateBoost: 1.35 },
  },
  bulwark: {
    id: 'bulwark', titleKey: 'aircraft.bulwark.name', roleKey: 'aircraft.bulwark.role', hp: 140, speedMultiplier: 0.78, tint: '#ffd3a1',
    weapon: { kind: 'siege', nameKey: 'aircraft.bulwark.weapon', descriptionKey: 'aircraft.bulwark.weaponDesc', damageMultiplier: 2.2, rateMultiplier: 0.45, spread: 0, color: '#ffad5c', sound: 'siegeShot' },
    ability: { kind: 'aegis', nameKey: 'aircraft.bulwark.ability', descriptionKey: 'aircraft.bulwark.abilityDesc', cooldown: 18, duration: 2.4, sound: 'abilityAegis' },
  },
  tempest: {
    id: 'tempest', titleKey: 'aircraft.tempest.name', roleKey: 'aircraft.tempest.role', hp: 100, speedMultiplier: 1, tint: '#d6c8ff',
    weapon: { kind: 'triad', nameKey: 'aircraft.tempest.weapon', descriptionKey: 'aircraft.tempest.weaponDesc', damageMultiplier: 0.48, rateMultiplier: 0.7, spread: 0.14, color: '#ad83ff', sound: 'triadShot' },
    ability: { kind: 'emp', nameKey: 'aircraft.tempest.ability', descriptionKey: 'aircraft.tempest.abilityDesc', cooldown: 20, duration: 0, sound: 'abilityEMP' },
  },
}

export const AIRCRAFT_CLASS_IDS = Object.freeze(['wraith', 'bulwark', 'tempest'] as const)

export function isAircraftClassId(value: unknown): value is AircraftClassId {
  return typeof value === 'string' && AIRCRAFT_CLASS_IDS.some(id => id === value)
}
