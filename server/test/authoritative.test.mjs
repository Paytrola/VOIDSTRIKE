import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import WebSocket from 'ws'
import { addSeat, AIRCRAFT, applyInput, createRoom, markDisconnected, resumeSeat, RULES, snapshotRoom, tickRoom, validateInput } from '../src/simulation.mjs'
import { createPvpServer } from '../src/server.mjs'

const now = 10_000
function duel() {
  const room = createRoom('TEST42', now)
  const a = addSeat(room, { token: 'a'.repeat(32), classId: 'wraith', callsign: 'ALPHA' }, now).player
  const b = addSeat(room, { token: 'b'.repeat(32), classId: 'bulwark', callsign: 'BRAVO' }, now).player
  tickRoom(room, 1 / 60, now + RULES.countdownMs + 1)
  return { room, a, b, t: now + RULES.countdownMs + 1 }
}
function input(seq, overrides = {}) {
  return {
    type: 'input', seq,
    move: { strafe: 0, vertical: 0, forward: 0 },
    look: { yaw: 0, pitch: 0 },
    fire: false, roll: false, ability: false,
    ...overrides,
  }
}
function waitMessage(ws, type, predicate = () => true, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error(`Timed out waiting for ${type}`)) }, timeoutMs)
    const onMessage = data => {
      let value
      try { value = JSON.parse(data.toString()) } catch { return }
      if (value.type !== type || !predicate(value)) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(value)
    }
    ws.on('message', onMessage)
  })
}

 test('input parser accepts bounded intent only and rejects forged transforms/NaN/oversized axes', () => {
  assert.deepEqual(validateInput(input(1)), input(1))
  assert.equal(validateInput(input(1, { position: { x: 999, y: 0, z: 0 } })), null)
  assert.equal(validateInput(input(1, { move: { strafe: 2, vertical: 0, forward: 0 } })), null)
  assert.equal(validateInput(input(1, { look: { yaw: Number.NaN, pitch: 0 } })), null)
  assert.equal(validateInput({ ...input(1), seq: -1 }), null)
  assert.equal(validateInput({ ...input(1), ability: 1 }), null)
})

test('one shared aircraft profile source preserves campaign class HP, speed, weapon and ability balance', () => {
  assert.equal(AIRCRAFT.wraith.hp, 80)
  assert.equal(AIRCRAFT.bulwark.hp, 140)
  assert.equal(AIRCRAFT.tempest.hp, 100)
  assert.equal(AIRCRAFT.wraith.speedMultiplier, 1.25)
  assert.equal(AIRCRAFT.bulwark.weapon.kind, 'siege')
  assert.equal(AIRCRAFT.tempest.ability.kind, 'emp')
})

test('room seats are capped at two and an invalid aircraft cannot enter', () => {
  const room = createRoom('ROOM42', now)
  assert.equal(addSeat(room, { token: 'a'.repeat(32), classId: 'wraith', callsign: 'A' }, now).ok, true)
  assert.deepEqual(addSeat(room, { token: 'bad', classId: 'unknown', callsign: 'X' }, now), { ok: false, code: 'invalid_aircraft' })
  assert.equal(addSeat(room, { token: 'b'.repeat(32), classId: 'tempest', callsign: 'B' }, now).ok, true)
  assert.equal(addSeat(room, { token: 'c'.repeat(32), classId: 'bulwark', callsign: 'C' }, now).code, 'room_full')
})

test('authoritative movement accelerates, respects class speed and stays inside the arena', () => {
  const { room, a, b, t } = duel()
  a.position = { x: 0, y: 0, z: 0 }
  b.position = { x: 30, y: 0, z: 0 }
  a.yaw = 0
  b.yaw = 0
  assert.equal(applyInput(room, a.seatId, input(1, { move: { strafe: 0, vertical: 0, forward: 1 } }), t + 10), true)
  assert.equal(applyInput(room, b.seatId, input(1, { move: { strafe: 0, vertical: 0, forward: 1 } }), t + 10), true)
  for (let i = 1; i <= 8; i += 1) tickRoom(room, 0.1, t + 10 + i * 100)
  assert.ok(a.position.z < 0)
  assert.ok(Math.abs(a.velocity.z) > Math.abs(b.velocity.z))
  a.position.x = RULES.arena.x + 10
  tickRoom(room, 1 / 60, t + 130)
  assert.ok(a.position.x <= RULES.arena.x)
})

test('ability actions are sequence-gated and obey per-class cooldown', () => {
  const { room, a, t } = duel()
  assert.equal(applyInput(room, a.seatId, input(1, { ability: true }), t + 10), true)
  assert.equal(a.abilityUntil, t + 10 + AIRCRAFT.wraith.ability.duration * 1000)
  assert.equal(a.abilityReadyAt, t + 10 + AIRCRAFT.wraith.ability.cooldown * 1000)
  const previous = a.abilityUntil
  applyInput(room, a.seatId, input(2, { ability: true }), t + 20)
  assert.equal(a.abilityUntil, previous)
})

test('health, shield, and weapon pickups are server-owned and weapon boost refreshes', () => {
  const { room, a, t } = duel()
  a.hull = 20
  a.shield = 0
  a.position = { ...room.pickups.find(p => p.kind === 'health').position }
  tickRoom(room, 1 / 60, t + 10)
  assert.equal(a.hull, 42)
  a.position = { ...room.pickups.find(p => p.kind === 'shield').position }
  tickRoom(room, 1 / 60, t + 20)
  assert.equal(a.shield, 30)
  const weapon = room.pickups.find(p => p.kind === 'weapon')
  a.position = { ...weapon.position }
  tickRoom(room, 1 / 60, t + 30)
  assert.equal(a.weaponBoostUntil, t + 30 + RULES.weaponBoostMs)
  room.pickups.push({ id: 'weapon-again', kind: 'weapon', position: { ...a.position } })
  tickRoom(room, 1 / 60, t + 2000)
  assert.equal(a.weaponBoostUntil, t + 2000 + RULES.weaponBoostMs)
  assert.equal(a.pickupEventId, 4)
  assert.equal(a.lastPickupKind, 'weapon')
})

test('a server projectile damages hull through shield and awards only server-calculated kills', () => {
  const { room, a, b, t } = duel()
  a.position = { x: 0, y: 0, z: 0 }
  a.yaw = 0
  a.pitch = 0
  b.position = { x: 0, y: 0, z: -6 }
  b.invulnerableUntil = 0
  b.shield = 0
  b.hull = 4
  assert.equal(applyInput(room, a.seatId, input(1, { fire: true }), t + 10), true)
  for (let i = 1; i <= 12 && b.alive; i += 1) tickRoom(room, 1 / 60, t + 10 + i * 17)
  assert.equal(b.alive, false)
  assert.equal(a.score, 1)
  assert.equal(b.deaths, 1)
})

test('roll grants short invulnerability, and Tempest EMP clears nearby hostile shots', () => {
  const { room, a, b, t } = duel()
  applyInput(room, a.seatId, input(1, { roll: true }), t + 5)
  assert.ok(a.invulnerableUntil >= t + 5 + RULES.rollInvulnerableMs)
  b.classId = 'tempest'
  room.projectiles.push({ id: 'hostile', owner: 'p1', position: { ...b.position }, velocity: { x: 0, y: 0, z: 0 }, damage: 5, life: 1 })
  applyInput(room, b.seatId, input(1, { ability: true }), t + 20)
  assert.equal(room.projectiles.some(shot => shot.id === 'hostile'), false)
})

test('disconnected seat resumes the paused duel and preserves scores without serializing seat tokens', () => {
  const { room, a, b, t } = duel()
  const token = a.token
  a.score = 3
  b.score = 2
  markDisconnected(room, a, t)
  const player = resumeSeat(room, token, { readyState: 1 }, t + 1000)
  assert.equal(player?.seatId, a.seatId)
  assert.equal(room.phase, 'live')
  assert.equal(a.score, 3)
  assert.equal(b.score, 2)
  const state = JSON.stringify(snapshotRoom(room, t + 1000))
  assert.equal(state.includes(token), false)
})

test('two isolated WebSocket clients create/join a room and receive server snapshots', { timeout: 10_000 }, async t => {
  const app = createPvpServer({ host: '127.0.0.1', port: 0, allowedOrigins: 'https://voidstrike-kg4srpnu.manus.game' })
  const address = await app.listen()
  const base = `ws://127.0.0.1:${address.port}/ws`
  const first = new WebSocket(`${base}?create=1`)
  t.after(() => { try { first.close() } catch {} })
  await once(first, 'open')
  first.send(JSON.stringify({ type: 'hello', protocol: 'voidstrike-pvp-v1', build: 'voidstrike-pvp-0.2.0', aircraft: 'wraith', callsign: 'ONE' }))
  const firstWelcome = await waitMessage(first, 'welcome')
  assert.match(firstWelcome.room, /^[A-HJ-NP-Z2-9]{6}$/)

  const second = new WebSocket(`${base}?room=${firstWelcome.room}`)
  t.after(() => { try { second.close() } catch {} })
  await once(second, 'open')
  const secondSnapshot = waitMessage(second, 'snapshot', v => v.players.length === 2)
  second.send(JSON.stringify({ type: 'hello', protocol: 'voidstrike-pvp-v1', build: 'voidstrike-pvp-0.2.0', aircraft: 'tempest', callsign: 'TWO' }))
  const secondWelcome = await waitMessage(second, 'welcome')
  assert.notEqual(firstWelcome.seatId, secondWelcome.seatId)
  const snapshot = await secondSnapshot
  assert.equal(snapshot.phase, 'countdown')
  assert.equal(snapshot.players.length, 2)
  assert.equal(snapshot.players.some(p => 'token' in p || 'seatToken' in p), false)
  first.send(JSON.stringify({ type: 'heartbeat' }))
  await waitMessage(first, 'heartbeat_ack')
  await app.close()
})

test('all WebSocket message types are rate limited, including non-input heartbeats', { timeout: 10_000 }, async t => {
  const app = createPvpServer({ host: '127.0.0.1', port: 0 })
  const address = await app.listen()
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?create=1`)
  t.after(() => { try { ws.close() } catch {} })
  await once(ws, 'open')
  ws.send(JSON.stringify({ type: 'hello', protocol: 'voidstrike-pvp-v1', build: 'voidstrike-pvp-0.2.0', aircraft: 'wraith', callsign: 'RATE' }))
  await waitMessage(ws, 'welcome')
  const rejected = waitMessage(ws, 'error', value => value.code === 'message_rate_limited')
  for (let i = 0; i < RULES.maxMessagesPerSecond + 1; i += 1) ws.send(JSON.stringify({ type: 'heartbeat' }))
  assert.equal((await rejected).code, 'message_rate_limited')
  await app.close()
})
