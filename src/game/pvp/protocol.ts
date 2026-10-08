export const PVP_PROTOCOL = 'voidstrike-pvp-v1' as const
export const PVP_BUILD_ID = 'voidstrike-pvp-0.2.0' as const
export const PVP_WS_PATH = '/ws'

export type PvpPhase = 'waiting' | 'countdown' | 'live' | 'complete'
export type PvpAircraft = 'wraith' | 'bulwark' | 'tempest'
export type PvpVector = { x: number; y: number; z: number }

export type PvpPlayerSnapshot = {
  id: string
  callsign: string
  classId: PvpAircraft
  position: PvpVector
  velocity: PvpVector
  yaw: number
  pitch: number
  hull: number
  maxHull: number
  shield: number
  score: number
  deaths: number
  alive: boolean
  connected: boolean
  invulnerable: boolean
  rollReadyIn: number
  abilityReadyIn: number
  abilityActive: boolean
  abilityActiveRemaining: number
  weaponBoostRemaining: number
  pickupEventId: number
  lastPickupKind: 'health' | 'shield' | 'weapon' | ''
}

export type PvpObjectSnapshot = { id: string; owner?: string; kind: string; color?: string; position: PvpVector }
export type PvpSnapshot = {
  type: 'snapshot'
  protocol: typeof PVP_PROTOCOL
  build: typeof PVP_BUILD_ID
  room: string
  phase: PvpPhase
  phaseEndsAt: number
  serverTime: number
  winner: string | null
  players: PvpPlayerSnapshot[]
  projectiles: PvpObjectSnapshot[]
  pickups: PvpObjectSnapshot[]
}

export type PvpConfig = {
  protocol: typeof PVP_PROTOCOL
  build: typeof PVP_BUILD_ID
  signalingUrl: string
}

export type PvpConfigResult = { config: PvpConfig; reason?: never } | { config: null; reason: 'missing' | 'invalid' | 'network' }

const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const finiteVector = (value: unknown): value is PvpVector => {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

/** Validate a deployment config as public data, never as a source for credentials. */
export function parsePvpConfig(value: unknown): PvpConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  if (obj.protocol !== PVP_PROTOCOL || obj.build !== PVP_BUILD_ID || typeof obj.signalingUrl !== 'string') return null
  try {
    const url = new URL(obj.signalingUrl)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!['wss:', ...(local ? ['ws:'] : [])].includes(url.protocol)) return null
    if (!local && url.protocol !== 'wss:') return null
    if (url.pathname !== PVP_WS_PATH || url.username || url.password || url.hash) return null
    return { protocol: PVP_PROTOCOL, build: PVP_BUILD_ID, signalingUrl: url.toString() }
  } catch {
    return null
  }
}

export async function loadPvpConfig(baseUrl?: string, fetcher: typeof fetch = fetch): Promise<PvpConfigResult> {
  const base = baseUrl ?? (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI)
  const url = new URL('multiplayer/bootstrap.json', base)
  try {
    const response = await fetcher(url, { cache: 'no-store', credentials: 'omit' })
    if (response.status === 404) return { config: null, reason: 'missing' }
    if (!response.ok) return { config: null, reason: 'network' }
    const raw = await response.json()
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as Record<string, unknown>).signalingUrl === 'string' && !(raw as Record<string, string>).signalingUrl.trim()) return { config: null, reason: 'missing' }
    const parsed = parsePvpConfig(raw)
    return parsed ? { config: parsed } : { config: null, reason: 'invalid' }
  } catch {
    return { config: null, reason: 'network' }
  }
}

export function parseServerMessage(value: unknown): PvpSnapshot | { type: 'welcome'; room: string; seatId: string; seatToken: string; resumed: boolean } | { type: 'error'; code: string } | { type: 'heartbeat_ack'; serverTime: number; pingId: number | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  if (obj.protocol !== PVP_PROTOCOL || obj.build !== PVP_BUILD_ID || typeof obj.type !== 'string') return null
  if (obj.type === 'welcome') {
    if (typeof obj.room !== 'string' || !ROOM_CODE_RE.test(obj.room) || !['p1', 'p2'].includes(String(obj.seatId)) || typeof obj.seatToken !== 'string' || obj.seatToken.length < 24 || obj.seatToken.length > 80 || typeof obj.resumed !== 'boolean') return null
    return obj as unknown as { type: 'welcome'; room: string; seatId: string; seatToken: string; resumed: boolean }
  }
  if (obj.type === 'error') return typeof obj.code === 'string' && /^[a-z0-9_]{1,48}$/.test(obj.code) ? obj as unknown as { type: 'error'; code: string } : null
  if (obj.type === 'heartbeat_ack') return Number.isFinite(obj.serverTime) && (obj.pingId === null || Number.isSafeInteger(obj.pingId)) ? obj as unknown as { type: 'heartbeat_ack'; serverTime: number; pingId: number | null } : null
  if (obj.type !== 'snapshot' || typeof obj.room !== 'string' || !ROOM_CODE_RE.test(obj.room)) return null
  if (!['waiting', 'countdown', 'live', 'complete'].includes(String(obj.phase)) || !Array.isArray(obj.players) || obj.players.length > 2 || !Array.isArray(obj.projectiles) || obj.projectiles.length > 128 || !Array.isArray(obj.pickups) || obj.pickups.length > 16) return null
  if (!Number.isFinite(obj.serverTime) || !Number.isFinite(obj.phaseEndsAt) || !(obj.winner === null || obj.winner === 'p1' || obj.winner === 'p2')) return null
  for (const raw of obj.players) {
    if (!raw || typeof raw !== 'object') return null
    const p = raw as Record<string, unknown>
    if (!['p1', 'p2'].includes(String(p.id)) || !['wraith', 'bulwark', 'tempest'].includes(String(p.classId)) || !finiteVector(p.position) || !finiteVector(p.velocity)) return null
    if (![p.yaw, p.pitch, p.hull, p.maxHull, p.shield, p.score, p.deaths, p.rollReadyIn, p.abilityReadyIn, p.abilityActiveRemaining, p.weaponBoostRemaining].every(Number.isFinite)) return null
    if (!Number.isSafeInteger(p.pickupEventId) || (p.pickupEventId as number) < 0 || !['', 'health', 'shield', 'weapon'].includes(String(p.lastPickupKind))) return null
    if (typeof p.callsign !== 'string' || typeof p.alive !== 'boolean' || typeof p.connected !== 'boolean' || typeof p.invulnerable !== 'boolean' || typeof p.abilityActive !== 'boolean') return null
  }
  for (const raw of [...obj.projectiles, ...obj.pickups]) {
    if (!raw || typeof raw !== 'object') return null
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.kind !== 'string' || !finiteVector(item.position)) return null
  }
  return obj as unknown as PvpSnapshot
}

export function validRoomCode(value: string): boolean {
  return ROOM_CODE_RE.test(value)
}
