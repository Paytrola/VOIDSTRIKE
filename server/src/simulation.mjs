import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const AIRCRAFT = require('../../shared/aircraft-profiles.json')
const sharedRules = require('../../shared/pvp-rules.json')
export const PROTOCOL = 'voidstrike-pvp-v1'
export const BUILD_ID = 'voidstrike-pvp-0.2.0'
export const RULES = Object.freeze(sharedRules)

const BASE_PICKUP_POINTS = [
  { x: -40, y: -12, z: -36 }, { x: 42, y: 16, z: -28 }, { x: 4, y: -4, z: 43 },
  { x: -12, y: 28, z: 22 }, { x: 27, y: -26, z: 14 }, { x: -46, y: 4, z: 5 },
  { x: 48, y: -4, z: 42 }, { x: -28, y: -30, z: -9 }, { x: 12, y: 25, z: -46 },
]
const PICKUP_KINDS = ['health', 'shield', 'weapon']
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const length3 = v => Math.hypot(v.x, v.y, v.z)
const distSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
const copy3 = v => ({ x: v.x, y: v.y, z: v.z })

export function validateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const allowed = new Set(['type', 'seq', 'move', 'look', 'fire', 'roll', 'ability'])
  if (Object.keys(value).some(key => !allowed.has(key)) || value.type !== 'input') return null
  if (!Number.isSafeInteger(value.seq) || value.seq < 0) return null
  const move = value.move
  const look = value.look
  if (!move || !look || typeof move !== 'object' || typeof look !== 'object') return null
  if (Object.keys(move).some(k => !['strafe', 'vertical', 'forward'].includes(k))) return null
  if (Object.keys(look).some(k => !['yaw', 'pitch'].includes(k))) return null
  const axes = [move.strafe, move.vertical, move.forward]
  if (axes.some(v => !Number.isFinite(v) || Math.abs(v) > 1)) return null
  if (!Number.isFinite(look.yaw) || Math.abs(look.yaw) > Math.PI * 4) return null
  if (!Number.isFinite(look.pitch) || Math.abs(look.pitch) > 1.35) return null
  if (typeof value.fire !== 'boolean' || typeof value.roll !== 'boolean' || typeof value.ability !== 'boolean') return null
  return {
    type: 'input', seq: value.seq,
    move: { strafe: move.strafe, vertical: move.vertical, forward: move.forward },
    look: { yaw: ((look.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI, pitch: clamp(look.pitch, -1.25, 1.25) },
    fire: value.fire, roll: value.roll, ability: value.ability,
  }
}

export function createRoom(code, now = Date.now()) {
  return {
    code,
    phase: 'waiting',
    phaseEndsAt: 0,
    winner: null,
    resumePhase: null,
    resumeRemainingMs: 0,
    players: new Map(),
    projectiles: [],
    pickups: [],
    pickupRespawns: [],
    pickupSerial: 0,
    projectileSerial: 0,
    spawnSerial: 0,
    createdAt: now,
    lastActivity: now,
    lastSnapshotAt: 0,
  }
}

function freshPlayer({ seatId, token, classId, callsign, now, connected = true }) {
  const profile = AIRCRAFT[classId]
  return {
    seatId, token, classId, callsign, connected, disconnectedAt: 0,
    ws: null, lastSeq: -1, lastRollSeq: -1, lastAbilitySeq: -1,
    input: { move: { strafe: 0, vertical: 0, forward: 0 }, look: { yaw: 0, pitch: 0 }, fire: false },
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, hull: profile.hp, shield: RULES.shieldMax,
    score: 0, deaths: 0, alive: true, respawnAt: 0, pickupEventId: 0, lastPickupKind: '',
    invulnerableUntil: now + RULES.spawnInvulnerableMs,
    rollReadyAt: 0, abilityReadyAt: 0, abilityUntil: 0, weaponBoostUntil: 0,
    lastDamageAt: now, nextFireAt: now,
  }
}

function resumeOrStart(room, now) {
  if ([...room.players.values()].filter(p => p.connected).length !== RULES.maxSeats) return
  if (!room.resumePhase) {
    prepareCountdown(room, now)
    return
  }
  room.phase = room.resumePhase
  room.phaseEndsAt = room.resumeRemainingMs > 0 ? now + room.resumeRemainingMs : 0
  room.resumePhase = null
  room.resumeRemainingMs = 0
  for (const player of room.players.values()) {
    player.input = { move: { strafe: 0, vertical: 0, forward: 0 }, look: { yaw: player.yaw, pitch: player.pitch }, fire: false }
    player.invulnerableUntil = Math.max(player.invulnerableUntil, now + RULES.spawnInvulnerableMs)
  }
}

export function addSeat(room, details, now = Date.now()) {
  if (!AIRCRAFT[details.classId]) return { ok: false, code: 'invalid_aircraft' }
  const expired = [...room.players.values()].find(p => !p.connected && now - p.disconnectedAt > RULES.reconnectGraceMs)
  const seatId = expired?.seatId ?? (!room.players.has('p1') ? 'p1' : !room.players.has('p2') ? 'p2' : null)
  if (!seatId) return { ok: false, code: 'room_full' }
  if (expired) {
    room.players.delete(expired.seatId)
    room.resumePhase = null
    room.resumeRemainingMs = 0
  }
  const player = freshPlayer({ seatId, ...details, now })
  room.players.set(seatId, player)
  room.lastActivity = now
  resumeOrStart(room, now)
  return { ok: true, player }
}

export function resumeSeat(room, token, ws, now = Date.now()) {
  const player = [...room.players.values()].find(p => !p.connected && p.token === token && now - p.disconnectedAt <= RULES.reconnectGraceMs)
  if (!player) return null
  player.connected = true
  player.disconnectedAt = 0
  player.ws = ws
  player.invulnerableUntil = now + RULES.spawnInvulnerableMs
  player.input = { move: { strafe: 0, vertical: 0, forward: 0 }, look: { yaw: player.yaw, pitch: player.pitch }, fire: false }
  room.lastActivity = now
  resumeOrStart(room, now)
  return player
}

export function markDisconnected(room, player, now = Date.now()) {
  if (!player) return
  if (room.phase !== 'waiting' && !room.resumePhase) {
    room.resumePhase = room.phase
    room.resumeRemainingMs = room.phaseEndsAt > 0 ? Math.max(0, room.phaseEndsAt - now) : 0
  }
  player.connected = false
  player.ws = null
  player.disconnectedAt = now
  player.input.fire = false
  player.invulnerableUntil = Number.MAX_SAFE_INTEGER
  room.phase = 'waiting'
  room.phaseEndsAt = 0
  room.lastActivity = now
}

function prepareCountdown(room, now) {
  if ([...room.players.values()].filter(p => p.connected).length !== RULES.maxSeats) return
  room.resumePhase = null
  room.resumeRemainingMs = 0
  room.phase = 'countdown'
  room.winner = null
  room.phaseEndsAt = now + RULES.countdownMs
  room.projectiles = []
  room.pickups = []
  room.pickupRespawns = []
  room.projectileSerial = 0
  for (const player of room.players.values()) {
    const profile = AIRCRAFT[player.classId]
    const side = player.seatId === 'p1' ? -1 : 1
    player.position = { x: side * 25, y: 0, z: 0 }
    player.velocity = { x: 0, y: 0, z: 0 }
    player.yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2
    player.pitch = 0
    player.hull = profile.hp
    player.shield = RULES.shieldMax
    player.score = 0
    player.deaths = 0
    player.alive = true
    player.respawnAt = 0
    player.invulnerableUntil = now + RULES.countdownMs + RULES.spawnInvulnerableMs
    player.rollReadyAt = 0
    player.abilityReadyAt = 0
    player.abilityUntil = 0
    player.weaponBoostUntil = 0
    player.lastDamageAt = now
    player.nextFireAt = now
    player.lastSeq = -1
    player.lastRollSeq = -1
    player.lastAbilitySeq = -1
  }
  const roomHash = [...room.code].reduce((n, c) => n + c.charCodeAt(0), 0)
  for (let i = 0; i < PICKUP_KINDS.length; i += 1) {
    const point = BASE_PICKUP_POINTS[(roomHash + i * 2) % BASE_PICKUP_POINTS.length]
    room.pickups.push({ id: `u${room.pickupSerial++}`, kind: PICKUP_KINDS[i], position: copy3(point) })
  }
}

export function applyInput(room, seatId, raw, now = Date.now()) {
  const player = room.players.get(seatId)
  const input = validateInput(raw)
  if (!player?.connected || !input || input.seq <= player.lastSeq) return false
  player.lastSeq = input.seq
  player.yaw = input.look.yaw
  player.pitch = input.look.pitch
  player.input = { move: input.move, look: input.look, fire: input.fire }
  room.lastActivity = now
  if (room.phase !== 'live' || !player.alive) return true
  if (input.roll && input.seq > player.lastRollSeq && now >= player.rollReadyAt) {
    player.lastRollSeq = input.seq
    const right = { x: Math.cos(player.yaw), y: 0, z: Math.sin(player.yaw) }
    const direction = Math.sign(input.move.strafe || player.velocity.x || 1)
    player.velocity.x += right.x * direction * RULES.rollBurst
    player.velocity.z += right.z * direction * RULES.rollBurst
    player.rollReadyAt = now + RULES.rollCooldownMs
    player.invulnerableUntil = Math.max(player.invulnerableUntil, now + RULES.rollInvulnerableMs)
  } else if (input.roll) player.lastRollSeq = input.seq
  if (input.ability && input.seq > player.lastAbilitySeq) {
    player.lastAbilitySeq = input.seq
    if (now >= player.abilityReadyAt) activateAbility(room, player, now)
  } else if (input.ability) player.lastAbilitySeq = input.seq
  return true
}

function activateAbility(room, player, now) {
  const ability = AIRCRAFT[player.classId].ability
  player.abilityReadyAt = now + ability.cooldown * 1000
  if (ability.kind === 'afterburn') player.abilityUntil = now + ability.duration * 1000
  if (ability.kind === 'aegis') {
    player.abilityUntil = now + ability.duration * 1000
    player.invulnerableUntil = Math.max(player.invulnerableUntil, player.abilityUntil)
  }
  if (ability.kind === 'emp') {
    const radiusSq = 78 * 78
    room.projectiles = room.projectiles.filter(b => b.owner === player.seatId || distSq(b.position, player.position) > radiusSq)
    player.abilityUntil = now + 1100
  }
}

function direction(yaw, pitch) {
  const cp = Math.cos(pitch)
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }
}

function fire(player, now, room) {
  const profile = AIRCRAFT[player.classId]
  const afterburn = now < player.abilityUntil && profile.ability.kind === 'afterburn'
  const uplink = now < player.weaponBoostUntil
  const rate = RULES.baseFireRate * profile.weapon.rateMultiplier * (afterburn ? (profile.ability.fireRateBoost ?? 1) : 1) * (uplink ? RULES.weaponRateBoost : 1)
  if (!player.input.fire || now < player.nextFireAt || rate <= 0) return
  player.nextFireAt = now + 1000 / rate
  const weapon = profile.weapon
  const lanes = weapon.kind === 'twin' ? [-0.72, 0.72] : weapon.kind === 'triad' ? [-1, 0, 1] : [0]
  const forward = direction(player.yaw, player.pitch)
  const right = { x: Math.cos(player.yaw), y: 0, z: Math.sin(player.yaw) }
  const baseSpeed = weapon.kind === 'siege' ? 60 : 82
  const damage = RULES.baseDamage * weapon.damageMultiplier * (uplink ? RULES.weaponDamageBoost : 1)
  for (const lane of lanes) {
    const spreadYaw = weapon.kind === 'triad' ? lane * weapon.spread : 0
    const shotDir = direction(player.yaw + spreadYaw, player.pitch)
    const lateral = weapon.kind === 'twin' ? lane : 0
    room.projectiles.push({
      id: `b${room.projectileSerial++}`,
      owner: player.seatId,
      kind: weapon.kind,
      color: weapon.color,
      damage,
      life: 2.8,
      position: { x: player.position.x + forward.x * 2 + right.x * lateral, y: player.position.y + forward.y * 2, z: player.position.z + forward.z * 2 + right.z * lateral },
      velocity: { x: shotDir.x * baseSpeed, y: shotDir.y * baseSpeed, z: shotDir.z * baseSpeed },
    })
  }
}

function respawn(player, now) {
  const profile = AIRCRAFT[player.classId]
  const side = player.seatId === 'p1' ? -1 : 1
  player.position = { x: side * 25, y: 0, z: 0 }
  player.velocity = { x: 0, y: 0, z: 0 }
  player.yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2
  player.pitch = 0
  player.hull = profile.hp
  player.shield = RULES.shieldMax
  player.alive = true
  player.respawnAt = 0
  player.invulnerableUntil = now + RULES.spawnInvulnerableMs
  player.lastDamageAt = now
  player.abilityUntil = 0
  player.weaponBoostUntil = 0
}

function eliminate(room, attacker, target, now) {
  target.alive = false
  target.hull = 0
  target.respawnAt = now + RULES.respawnMs
  target.deaths += 1
  if (attacker) attacker.score += 1
  if (attacker && attacker.score >= RULES.firstTo) {
    room.phase = 'complete'
    room.winner = attacker.seatId
    room.phaseEndsAt = now + 120_000
  }
}

function applyDamage(room, attacker, target, damage, now) {
  if (!target.alive || now < target.invulnerableUntil) return false
  const absorbed = Math.min(target.shield, damage)
  target.shield -= absorbed
  target.hull = Math.max(0, target.hull - (damage - absorbed))
  target.lastDamageAt = now
  if (target.hull <= 0) eliminate(room, attacker, target, now)
  return true
}

function updateMovement(player, dt, now) {
  const profile = AIRCRAFT[player.classId]
  const afterburn = now < player.abilityUntil && profile.ability.kind === 'afterburn'
  const maxSpeed = RULES.speed * profile.speedMultiplier * (afterburn ? (profile.ability.speedBoost ?? 1) : 1)
  const fwd = direction(player.yaw, player.pitch)
  const right = { x: Math.cos(player.yaw), y: 0, z: Math.sin(player.yaw) }
  const m = player.input.move
  let target = {
    x: right.x * m.strafe + fwd.x * m.forward,
    y: m.vertical + fwd.y * m.forward,
    z: right.z * m.strafe + fwd.z * m.forward,
  }
  const len = length3(target)
  if (len > 1) target = { x: target.x / len, y: target.y / len, z: target.z / len }
  target = { x: target.x * maxSpeed, y: target.y * maxSpeed, z: target.z * maxSpeed }
  const accel = RULES.acceleration * dt
  player.velocity.x += clamp(target.x - player.velocity.x, -accel, accel)
  player.velocity.y += clamp(target.y - player.velocity.y, -accel, accel)
  player.velocity.z += clamp(target.z - player.velocity.z, -accel, accel)
  player.position.x += player.velocity.x * dt
  player.position.y += player.velocity.y * dt
  player.position.z += player.velocity.z * dt
  for (const [axis, half] of [['x', RULES.arena.x], ['y', RULES.arena.y], ['z', RULES.arena.z]]) {
    if (Math.abs(player.position[axis]) > half) {
      player.position[axis] = Math.sign(player.position[axis]) * half
      player.velocity[axis] *= -0.2
    }
  }
}

function spawnPickup(room, kind, now) {
  const index = room.spawnSerial++
  const point = BASE_PICKUP_POINTS[(index * 5 + room.code.charCodeAt(index % room.code.length)) % BASE_PICKUP_POINTS.length]
  room.pickups.push({ id: `u${room.pickupSerial++}`, kind, position: copy3(point) })
  room.pickupRespawns = room.pickupRespawns.filter(p => !(p.kind === kind && p.at <= now))
}

function collectPickups(room, now) {
  for (const pickup of [...room.pickups]) {
    const player = [...room.players.values()].find(p => p.connected && p.alive && distSq(p.position, pickup.position) <= RULES.pickupRadius ** 2)
    if (!player) continue
    if (pickup.kind === 'health') player.hull = Math.min(AIRCRAFT[player.classId].hp, player.hull + RULES.healthPickup)
    else if (pickup.kind === 'shield') player.shield = Math.min(RULES.shieldMax, player.shield + RULES.shieldPickup)
    else if (pickup.kind === 'weapon') player.weaponBoostUntil = now + RULES.weaponBoostMs
    player.pickupEventId += 1
    player.lastPickupKind = pickup.kind
    room.pickups = room.pickups.filter(p => p.id !== pickup.id)
    const nextKind = PICKUP_KINDS[(PICKUP_KINDS.indexOf(pickup.kind) + 1) % PICKUP_KINDS.length]
    room.pickupRespawns.push({ kind: nextKind, at: now + RULES.pickupRespawnMs })
  }
  for (const spawn of [...room.pickupRespawns]) {
    if (spawn.at > now) continue
    spawnPickup(room, spawn.kind, now)
  }
}

export function tickRoom(room, dt = 1 / 60, now = Date.now()) {
  if (room.phase === 'countdown' && now >= room.phaseEndsAt) {
    room.phase = 'live'
    room.phaseEndsAt = 0
  }
  if (room.phase !== 'live') return snapshotRoom(room, now)
  const players = [...room.players.values()]
  for (const player of players) {
    if (!player.connected) continue
    if (!player.alive) {
      if (player.respawnAt && now >= player.respawnAt && room.phase === 'live') respawn(player, now)
      continue
    }
    updateMovement(player, dt, now)
    if (player.shield < RULES.shieldMax && now - player.lastDamageAt >= RULES.shieldRegenDelayMs) {
      player.shield = Math.min(RULES.shieldMax, player.shield + RULES.shieldRegenPerSecond * dt)
    }
    fire(player, now, room)
  }
  for (const shot of room.projectiles) {
    shot.position.x += shot.velocity.x * dt
    shot.position.y += shot.velocity.y * dt
    shot.position.z += shot.velocity.z * dt
    shot.life -= dt
    const target = players.find(p => p.seatId !== shot.owner && p.connected && p.alive && distSq(p.position, shot.position) <= RULES.projectileRadius ** 2)
    if (target) {
      applyDamage(room, room.players.get(shot.owner), target, shot.damage, now)
      shot.life = -1
    }
  }
  room.projectiles = room.projectiles.filter(b => b.life > 0 && Math.abs(b.position.x) <= RULES.arena.x + 5 && Math.abs(b.position.y) <= RULES.arena.y + 5 && Math.abs(b.position.z) <= RULES.arena.z + 5)
  collectPickups(room, now)
  return snapshotRoom(room, now)
}

export function snapshotRoom(room, now = Date.now()) {
  const players = [...room.players.values()].map(p => ({
    id: p.seatId, callsign: p.callsign, classId: p.classId,
    position: copy3(p.position), velocity: copy3(p.velocity), yaw: p.yaw, pitch: p.pitch,
    hull: p.hull, maxHull: AIRCRAFT[p.classId].hp, shield: p.shield,
    score: p.score, deaths: p.deaths, alive: p.alive, connected: p.connected,
    invulnerable: now < p.invulnerableUntil,
    rollReadyIn: Math.max(0, p.rollReadyAt - now),
    abilityReadyIn: Math.max(0, p.abilityReadyAt - now),
    abilityActive: now < p.abilityUntil,
    abilityActiveRemaining: Math.max(0, p.abilityUntil - now),
    weaponBoostRemaining: Math.max(0, p.weaponBoostUntil - now),
    pickupEventId: p.pickupEventId,
    lastPickupKind: p.lastPickupKind,
  }))
  return {
    type: 'snapshot', protocol: PROTOCOL, build: BUILD_ID,
    room: room.code, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
    serverTime: now, winner: room.winner,
    players,
    projectiles: room.projectiles.map(b => ({ id: b.id, owner: b.owner, kind: b.kind, color: b.color, position: copy3(b.position) })),
    pickups: room.pickups.map(p => ({ id: p.id, kind: p.kind, position: copy3(p.position) })),
  }
}
