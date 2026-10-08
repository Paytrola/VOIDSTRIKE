import { describe, expect, it } from 'vitest'
import {
  loadPvpConfig,
  parsePvpConfig,
  parseServerMessage,
  PVP_BUILD_ID,
  PVP_PROTOCOL,
  validRoomCode,
} from '../src/game/pvp/protocol'

const vector = { x: 0, y: 0, z: 0 }
const snapshot = {
  type: 'snapshot',
  protocol: PVP_PROTOCOL,
  build: PVP_BUILD_ID,
  room: 'ABC234',
  phase: 'waiting',
  phaseEndsAt: 0,
  serverTime: 1_000,
  winner: null,
  players: [{
    id: 'p1', callsign: 'PILOT', classId: 'wraith',
    position: vector, velocity: vector, yaw: 0, pitch: 0,
    hull: 80, maxHull: 80, shield: 60, score: 0, deaths: 0,
    alive: true, connected: true, invulnerable: false,
    rollReadyIn: 0, abilityReadyIn: 0, abilityActive: false,
    abilityActiveRemaining: 0, weaponBoostRemaining: 0,
    pickupEventId: 1, lastPickupKind: 'health',
  }],
  projectiles: [],
  pickups: [],
}

describe('PvP connection protocol', () => {
  it('accepts only build-matched WSS service URLs and local development WS', () => {
    const config = { protocol: PVP_PROTOCOL, build: PVP_BUILD_ID, signalingUrl: 'wss://voidstrike-pvp.example.onrender.com/ws' }
    expect(parsePvpConfig(config)?.signalingUrl).toBe(config.signalingUrl)
    expect(parsePvpConfig({ ...config, signalingUrl: 'https://voidstrike-pvp.example.onrender.com/ws' })).toBeNull()
    expect(parsePvpConfig({ ...config, signalingUrl: 'ws://voidstrike-pvp.example.onrender.com/ws' })).toBeNull()
    expect(parsePvpConfig({ ...config, signalingUrl: 'ws://localhost:3001/ws' })?.signalingUrl).toBe('ws://localhost:3001/ws')
    expect(parsePvpConfig({ ...config, build: 'older-client' })).toBeNull()
  })

  it('treats the absent public bootstrap as unavailable instead of simulating a local match', async () => {
    const result = await loadPvpConfig('https://voidstrike.example/', async () => new Response(null, { status: 404 }))
    expect(result).toEqual({ config: null, reason: 'missing' })
  })

  it('accepts bounded room codes and validates server-issued pickup events', () => {
    expect(validRoomCode('ABC234')).toBe(true)
    expect(validRoomCode('ABO234')).toBe(false)
    expect(parseServerMessage(snapshot)?.type).toBe('snapshot')
    expect(parseServerMessage({ ...snapshot, players: [{ ...snapshot.players[0], pickupEventId: -1 }] })).toBeNull()
    expect(parseServerMessage({ ...snapshot, players: [{ ...snapshot.players[0], lastPickupKind: 'admin' }] })).toBeNull()
  })
})
