import type { AircraftClassId } from '../engine/save'
import sharedAircraftProfiles from '../../shared/aircraft-profiles.json'

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
export const AIRCRAFT_CLASSES = sharedAircraftProfiles as unknown as Record<AircraftClassId, AircraftProfile>

export const AIRCRAFT_CLASS_IDS = Object.freeze(['wraith', 'bulwark', 'tempest'] as const)

export function isAircraftClassId(value: unknown): value is AircraftClassId {
  return typeof value === 'string' && AIRCRAFT_CLASS_IDS.some(id => id === value)
}
