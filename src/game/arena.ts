import type * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Impact } from '../engine/impact'
import type { Physics } from '../engine/physics'
import type { EnemyBullets } from './bullets'
import type { Fx } from './fx'

/** Rapier interaction groups: (membership << 16) | filter. */
export const GROUP_TARGET = (0x0001 << 16) | 0xffff
/** Query groups for player shots: hit anything that is a target. */
export const QUERY_SHOTS = (0x0002 << 16) | 0x0001

/** What enemy, boss and level systems may touch. The scene implements it. */
export interface Arena {
  /** Simulation seconds since the run started. */
  readonly time: number
  /** Player position in rig space (current step). */
  readonly player: THREE.Vector3
  readonly playerAlive: boolean
  readonly railSpeed: number
  readonly bullets: EnemyBullets
  readonly fx: Fx
  readonly impact: Impact
  readonly audio: Audio
  readonly physics: Physics
  /** Damage the player (returns true if it landed). */
  hurtPlayer(amount: number, from: THREE.Vector3, kind: 'bullet' | 'ram' | 'beam' | 'drill'): boolean
  /** Award points for a destroyed target at a position (handles multiplier + popup). */
  award(base: number, at: THREE.Vector3, kill: boolean): void
}
