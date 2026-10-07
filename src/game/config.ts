/**
 * All gameplay tuning in one place. Change numbers here before touching game code; the rules
 * tests read the same values so rule changes stay covered.
 */
export const CONFIG = {
  ship: {
    /** Half extents of the flight window in rail-local units. */
    boundsX: 8.8,
    boundsY: 4.9,
    /** Top steering speed for keyboard / stick / touch (units per second). */
    speed: 16,
    accel: 90,
    /** Mouse aim: the ship slides toward the point under the reticle at this rate. */
    followRate: 7.5,
    hitRadius: 0.55,
    grazeRadius: 1.6,
  },
  roll: {
    duration: 0.5,
    invulnerable: 0.46,
    cooldown: 0.8,
    /** Sideways burst speed during a roll. */
    dash: 11,
  },
  weapon: {
    rate: 12,
    speed: 270,
    damage: 1,
    range: 280,
    /** Lateral gun offset on the ship. */
    gunOffset: 0.95,
  },
  hull: { max: 100 },
  shield: { max: 60, regenDelay: 4, regenRate: 9, grazeGain: 0.5 },
  damage: { bullet: 10, heavy: 15, rock: 16, ram: 20, beam: 22, drill: 30, mine: 16 },
  /** Seconds of invulnerability after a hit. */
  invulnerable: 0.85,
  combo: {
    /** A kill inside this window keeps the chain alive. */
    window: 3,
    /** Kills per multiplier step. */
    perLevel: 5,
    maxMultiplier: 8,
  },
  score: {
    mite: 100,
    chisel: 300,
    lantern: 900,
    rockSmall: 40,
    rockLarge: 150,
    mine: 120,
    chunk: 60,
    graze: 10,
    grinder: 4000,
    auger: 6000,
    bossKill: 30000,
    clear: 10000,
    hullBonus: 120,
    noDamage: 20000,
  },
  repair: { hull: 22, shield: 30 },
  powerups: {
    weaponDuration: 8,
    weaponDamageMultiplier: 1.35,
    weaponFireRateMultiplier: 1.25,
  },
  rail: { speed: 38, boost: 64, boss: 30 },
  aim: {
    /** Distance of the aim point when nothing is under the reticle. */
    depth: 90,
    /** Aim assist radius in NDC per input method. */
    assistMouse: 0.05,
    assistPad: 0.13,
    assistTouch: 0.22,
    /** Gamepad/keyboard reticle travel from the ship (NDC). */
    stickReach: 0.42,
  },
  /** Result grade thresholds (final score). */
  grades: { S: 150000, A: 105000, B: 70000, C: 40000 },
} as const

export type GameConfig = typeof CONFIG
