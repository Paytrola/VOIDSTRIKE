import { CONFIG } from './config'
import { repair, type RunState } from './rules'

export const POWERUP_KINDS = ['health', 'shield', 'weapon'] as const
export type PowerupKind = (typeof POWERUP_KINDS)[number]

export const POWERUP_COLORS: Record<PowerupKind, string> = {
  health: '#9dff5c',
  shield: '#48bfff',
  weapon: '#ffbd4a',
}

/** Cycle rather than randomize so each type appears in sequence when its enemy drop is collected. */
export function powerupForDrop(index: number): PowerupKind {
  const length = POWERUP_KINDS.length
  const slot = ((Math.trunc(index) % length) + length) % length
  return POWERUP_KINDS[slot]!
}

export type PowerupResult = { run: RunState; weaponBoostSeconds: number }

/** Applies the collected pickup; a new weapon uplink refreshes its duration without stacking. */
export function collectPowerup(run: RunState, kind: PowerupKind, hullMax: number, weaponBoostSeconds = 0): PowerupResult {
  if (run.phase !== 'playing') return { run, weaponBoostSeconds }

  if (kind === 'health') {
    return { run: repair(run, CONFIG.repair.hull, 0, CONFIG, hullMax), weaponBoostSeconds }
  }

  if (kind === 'shield') {
    const repaired = repair(run, 0, CONFIG.repair.shield, CONFIG, hullMax)
    const next = repaired.shield > run.shield ? { ...repaired, shieldDelay: 0 } : repaired
    return { run: next, weaponBoostSeconds }
  }

  return { run, weaponBoostSeconds: CONFIG.powerups.weaponDuration }
}
