import { CONFIG } from './config'

/**
 * Pure run rules: hull, shield, combo multiplier, scoring, results. No three.js, no DOM — the
 * scene reports events and reads the resulting state; unit tests cover every rule here.
 */
export type RunPhase = 'playing' | 'won' | 'lost'
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

export type RunState = {
  phase: RunPhase
  /** Gameplay changed through development tuning is excluded from leaderboard submission. */
  unranked: boolean
  score: number
  hull: number
  shield: number
  /** Seconds until the shield starts regenerating. */
  shieldDelay: number
  invulnerable: number
  /** Kill chain length (drives the multiplier). */
  combo: number
  comboTimer: number
  maxCombo: number
  kills: number
  shots: number
  hits: number
  grazes: number
  damageTaken: number
  elapsed: number
  /** End-of-run bonuses, already included in `score`. */
  clearBonus: number
  hullBonus: number
  noDamageBonus: number
}

export function createRun(rules = CONFIG, hullMax: number = rules.hull.max): RunState {
  return {
    phase: 'playing',
    unranked: false,
    score: 0,
    hull: hullMax,
    shield: rules.shield.max,
    shieldDelay: 0,
    invulnerable: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    kills: 0,
    shots: 0,
    hits: 0,
    grazes: 0,
    damageTaken: 0,
    elapsed: 0,
    clearBonus: 0,
    hullBonus: 0,
    noDamageBonus: 0,
  }
}

/** Score multiplier for a chain length: x1, then +1 every `perLevel` kills, capped. */
export function multiplier(combo: number, rules = CONFIG): number {
  return Math.min(rules.combo.maxMultiplier, 1 + Math.floor(Math.max(0, combo) / rules.combo.perLevel))
}

export function tick(s: RunState, dt: number, rules = CONFIG): RunState {
  if (s.phase !== 'playing') return s
  const comboTimer = Math.max(0, s.comboTimer - dt)
  const shieldDelay = Math.max(0, s.shieldDelay - dt)
  const shield = shieldDelay > 0 ? s.shield : Math.min(rules.shield.max, s.shield + rules.shield.regenRate * dt)
  return {
    ...s,
    elapsed: s.elapsed + dt,
    comboTimer,
    combo: comboTimer > 0 ? s.combo : 0,
    shieldDelay,
    shield,
    invulnerable: Math.max(0, s.invulnerable - dt),
  }
}

/** An enemy died. Returns points awarded (base × multiplier) and whether the multiplier rose. */
export function addKill(s: RunState, base: number, rules = CONFIG): { state: RunState; points: number; multiplier: number; levelUp: boolean } {
  if (s.phase !== 'playing') return { state: s, points: 0, multiplier: 1, levelUp: false }
  const before = multiplier(s.combo, rules)
  const combo = s.combo + 1
  const mult = multiplier(combo, rules)
  const points = Math.round(base * mult)
  return {
    state: { ...s, combo, comboTimer: rules.combo.window, maxCombo: Math.max(s.maxCombo, combo), kills: s.kills + 1, score: s.score + points },
    points,
    multiplier: mult,
    levelUp: mult > before,
  }
}

/** Points that use the current multiplier but do not extend the chain (grazes, boss parts hits). */
export function addScore(s: RunState, base: number, rules = CONFIG): { state: RunState; points: number } {
  if (s.phase !== 'playing') return { state: s, points: 0 }
  const points = Math.round(base * multiplier(s.combo, rules))
  return { state: { ...s, score: s.score + points }, points }
}

/** A bullet brushed past the hull: small score, a little shield, and the chain timer is topped up. */
export function graze(s: RunState, rules = CONFIG): { state: RunState; points: number } {
  if (s.phase !== 'playing') return { state: s, points: 0 }
  const r = addScore({ ...s, grazes: s.grazes + 1, shield: s.shieldDelay > 0 ? s.shield : Math.min(rules.shield.max, s.shield + rules.shield.grazeGain), comboTimer: s.combo > 0 ? Math.min(rules.combo.window, s.comboTimer + 0.35) : s.comboTimer }, rules.score.graze, rules)
  return r
}

export type HurtResult = { state: RunState; blocked: boolean; shieldDamage: number; hullDamage: number; died: boolean }

/** Take damage: the shield absorbs first, then the hull. Hits during invulnerability are ignored. */
export function hurt(s: RunState, amount: number, rules = CONFIG): HurtResult {
  if (s.phase !== 'playing' || s.invulnerable > 0 || amount <= 0) return { state: s, blocked: true, shieldDamage: 0, hullDamage: 0, died: false }
  const shieldDamage = Math.min(s.shield, amount)
  const hullDamage = amount - shieldDamage
  const hull = Math.max(0, s.hull - hullDamage)
  const died = hull <= 0
  const next: RunState = {
    ...s,
    shield: s.shield - shieldDamage,
    hull,
    shieldDelay: rules.shield.regenDelay,
    invulnerable: rules.invulnerable,
    combo: 0,
    comboTimer: 0,
    damageTaken: s.damageTaken + amount,
    phase: died ? 'lost' : s.phase,
  }
  return { state: next, blocked: false, shieldDamage, hullDamage, died }
}

export function repair(s: RunState, hull: number, shield: number, rules = CONFIG, hullMax: number = rules.hull.max): RunState {
  if (s.phase !== 'playing') return s
  return { ...s, hull: Math.min(hullMax, s.hull + hull), shield: Math.min(rules.shield.max, s.shield + shield) }
}

export function shotFired(s: RunState, n = 1): RunState {
  return s.phase === 'playing' ? { ...s, shots: s.shots + n } : s
}

export function shotHit(s: RunState): RunState {
  return s.phase === 'playing' ? { ...s, hits: s.hits + 1 } : s
}

/** Grant temporary invulnerability (rolls, cinematics) without other side effects. */
export function shield(s: RunState, seconds: number): RunState {
  return { ...s, invulnerable: Math.max(s.invulnerable, seconds) }
}

/** The boss fell: add clear, hull and flawless bonuses and end the run. */
export function win(s: RunState, rules = CONFIG, hullMax: number = rules.hull.max): RunState {
  if (s.phase !== 'playing') return s
  const clearBonus = rules.score.clear
  const hullBonus = Math.round((s.hull / Math.max(1, hullMax)) * rules.hull.max) * rules.score.hullBonus
  const noDamageBonus = s.damageTaken === 0 ? rules.score.noDamage : 0
  return { ...s, phase: 'won', clearBonus, hullBonus, noDamageBonus, score: s.score + clearBonus + hullBonus + noDamageBonus }
}

export function accuracy(s: RunState): number {
  return s.shots > 0 ? Math.min(1, s.hits / s.shots) : 0
}

export function grade(s: RunState, rules = CONFIG): Grade {
  if (s.phase !== 'won') return 'D'
  const g = rules.grades
  if (s.score >= g.S) return 'S'
  if (s.score >= g.A) return 'A'
  if (s.score >= g.B) return 'B'
  if (s.score >= g.C) return 'C'
  return 'D'
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
