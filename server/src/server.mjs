import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { addSeat, applyInput, BUILD_ID, createRoom, markDisconnected, PROTOCOL, resumeSeat, RULES, snapshotRoom, tickRoom } from './simulation.mjs'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 6
const MAX_MESSAGE_BYTES = 4096
const HANDSHAKE_MS = 6000
const PING_MS = 25_000
const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/
const noStore = 'no-store'

function roomCode() {
  const bytes = randomBytes(ROOM_CODE_LENGTH)
  let value = ''
  for (const byte of bytes) value += ROOM_ALPHABET[byte % ROOM_ALPHABET.length]
  return value
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': noStore, 'x-content-type-options': 'nosniff' })
  res.end(body)
}

function rejectUpgrade(socket, status, phrase) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function parseObject(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))
  if (bytes.byteLength > MAX_MESSAGE_BYTES) return null
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function exactKeys(value, keys) {
  return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key))
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function sendError(ws, code) {
  send(ws, { type: 'error', code, protocol: PROTOCOL, build: BUILD_ID })
}

function closeWithError(ws, code, closeCode = 4400) {
  sendError(ws, code)
  try { ws.close(closeCode, code.slice(0, 120)) } catch { ws.terminate() }
}

function token() {
  return randomBytes(24).toString('base64url')
}

function safeCallsign(value) {
  if (typeof value !== 'string') return `PILOT-${randomBytes(2).toString('hex').toUpperCase()}`
  const clean = value.normalize('NFKC').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 16)
  return clean || `PILOT-${randomBytes(2).toString('hex').toUpperCase()}`
}

export function createPvpServer({ host = '0.0.0.0', port = Number(process.env.PORT || 3000), allowedOrigins = process.env.ALLOWED_ORIGINS || 'https://voidstrike-kg4srpnu.manus.game,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173', now = () => Date.now() } = {}) {
  const origins = new Set(String(allowedOrigins).split(',').map(v => v.trim()).filter(Boolean))
  const rooms = new Map()
  const sockets = new Set()
  let lastTick = now()
  let totalConnections = 0
  const startedAt = now()

  const http = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') {
      const connected = [...rooms.values()].reduce((sum, room) => sum + [...room.players.values()].filter(p => p.connected).length, 0)
      return writeJson(res, 200, { ok: true, service: 'voidstrike-pvp', protocol: PROTOCOL, build: BUILD_ID, uptimeSeconds: Math.floor((now() - startedAt) / 1000), rooms: rooms.size, connectedPlayers: connected, maxRooms: RULES.maxRooms })
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return writeJson(res, 200, { service: 'VOIDSTRIKE PvP', protocol: PROTOCOL, build: BUILD_ID, websocketPath: '/ws', healthPath: '/healthz' })
    }
    writeJson(res, 404, { error: 'not_found' })
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })

  http.on('upgrade', (req, socket, head) => {
    let url
    try { url = new URL(req.url || '/', 'http://localhost') } catch { return rejectUpgrade(socket, 400, 'Bad Request') }
    if (url.pathname !== '/ws') return rejectUpgrade(socket, 404, 'Not Found')
    const origin = req.headers.origin
    if (origin && !origins.has(origin)) return rejectUpgrade(socket, 403, 'Forbidden')
    if (sockets.size >= RULES.maxConnections) return rejectUpgrade(socket, 503, 'Service Unavailable')

    let room
    let isCreate = url.searchParams.get('create') === '1'
    if (isCreate) {
      if (rooms.size >= RULES.maxRooms) return rejectUpgrade(socket, 503, 'Service Unavailable')
      let code = roomCode()
      for (let tries = 0; rooms.has(code) && tries < 12; tries += 1) code = roomCode()
      if (rooms.has(code)) return rejectUpgrade(socket, 503, 'Service Unavailable')
      room = createRoom(code, now())
      rooms.set(code, room)
    } else {
      const code = String(url.searchParams.get('room') || '').toUpperCase()
      if (!ROOM_CODE_RE.test(code)) return rejectUpgrade(socket, 400, 'Bad Request')
      room = rooms.get(code)
      if (!room) return rejectUpgrade(socket, 404, 'Not Found')
    }
    const context = { room, isCreate }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.context = context
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', ws => {
    sockets.add(ws)
    totalConnections += 1
    ws.isAlive = true
    ws.authedSeat = null
    ws.context = ws.context
    ws.inputWindowAt = now()
    ws.inputCount = 0
    ws.messageWindowAt = now()
    ws.messageCount = 0
    ws.on('pong', () => { ws.isAlive = true })
    const handshakeTimer = setTimeout(() => {
      if (!ws.authedSeat) closeWithError(ws, 'handshake_timeout', 4408)
    }, HANDSHAKE_MS)
    handshakeTimer.unref?.()

    ws.on('message', raw => {
      const t = now()
      if (t - ws.messageWindowAt >= 1000) { ws.messageWindowAt = t; ws.messageCount = 0 }
      ws.messageCount += 1
      if (ws.messageCount > RULES.maxMessagesPerSecond) return closeWithError(ws, 'message_rate_limited', 4429)
      const value = parseObject(raw)
      if (!value || typeof value.type !== 'string') return closeWithError(ws, 'invalid_message')
      if (!ws.authedSeat) {
        if (value.type !== 'hello' && value.type !== 'resume') return closeWithError(ws, 'hello_required')
        if (value.protocol !== PROTOCOL) return closeWithError(ws, 'protocol_mismatch', 4401)
        if (value.build !== BUILD_ID) return closeWithError(ws, 'build_mismatch', 4402)
        const room = ws.context.room
        let player
        if (value.type === 'hello') {
          if (!exactKeys(value, ['type', 'protocol', 'build', 'aircraft', 'callsign'])) return closeWithError(ws, 'invalid_hello')
          const result = addSeat(room, { token: token(), classId: value.aircraft, callsign: safeCallsign(value.callsign), now: now() }, now())
          if (!result.ok) return closeWithError(ws, result.code, result.code === 'room_full' ? 4409 : 4400)
          player = result.player
        } else {
          if (!exactKeys(value, ['type', 'protocol', 'build', 'seatToken']) || typeof value.seatToken !== 'string' || value.seatToken.length < 24 || value.seatToken.length > 80) return closeWithError(ws, 'invalid_resume')
          player = resumeSeat(room, value.seatToken, ws, now())
          if (!player) return closeWithError(ws, 'resume_expired', 4404)
        }
        clearTimeout(handshakeTimer)
        player.ws = ws
        ws.authedSeat = player
        ws.authedRoom = room
        send(ws, { type: 'welcome', protocol: PROTOCOL, build: BUILD_ID, room: room.code, seatId: player.seatId, seatToken: player.token, resumed: value.type === 'resume' })
        broadcast(room)
        return
      }

      const player = ws.authedSeat
      const room = ws.authedRoom
      if (value.type === 'heartbeat') {
        if (!exactKeys(value, ['type']) && !exactKeys(value, ['type', 'pingId'])) return closeWithError(ws, 'invalid_heartbeat')
        if (Object.hasOwn(value, 'pingId') && !Number.isSafeInteger(value.pingId)) return closeWithError(ws, 'invalid_heartbeat')
        room.lastActivity = now()
        send(ws, { type: 'heartbeat_ack', protocol: PROTOCOL, build: BUILD_ID, pingId: value.pingId ?? null, serverTime: now() })
        return
      }
      if (value.type === 'input') {
        if (t - ws.inputWindowAt >= 1000) { ws.inputWindowAt = t; ws.inputCount = 0 }
        ws.inputCount += 1
        if (ws.inputCount > RULES.maxInputPerSecond) return closeWithError(ws, 'input_rate_limited', 4429)
        if (!applyInput(room, player.seatId, value, t)) return closeWithError(ws, 'invalid_input')
        return
      }
      if (value.type === 'leave') {
        if (!exactKeys(value, ['type'])) return closeWithError(ws, 'invalid_leave')
        room.lastActivity = now()
        try { ws.close(1000, 'leave') } catch { ws.terminate() }
        return
      }
      closeWithError(ws, 'unknown_message')
    })

    ws.on('close', () => {
      clearTimeout(handshakeTimer)
      sockets.delete(ws)
      if (ws.authedSeat && ws.authedRoom) markDisconnected(ws.authedRoom, ws.authedSeat, now())
    })
    ws.on('error', () => undefined)
  })

  function broadcast(room) {
    const snapshot = snapshotRoom(room, now())
    const payload = JSON.stringify(snapshot)
    for (const player of room.players.values()) {
      if (player.connected && player.ws?.readyState === WebSocket.OPEN) player.ws.send(payload)
    }
  }

  const simulationTimer = setInterval(() => {
    const t = now()
    const elapsed = Math.max(0.001, Math.min(0.05, (t - lastTick) / 1000))
    lastTick = t
    for (const [code, room] of rooms) {
      if (![...room.players.values()].some(p => p.connected) && t - room.lastActivity > RULES.roomIdleMs) {
        rooms.delete(code)
        continue
      }
      for (const player of room.players.values()) {
        if (!player.connected && player.token && t - player.disconnectedAt > RULES.reconnectGraceMs) player.token = ''
      }
      if (room.phase === 'complete' && room.phaseEndsAt > 0 && t > room.phaseEndsAt) {
        for (const player of room.players.values()) if (player.ws?.readyState === WebSocket.OPEN) player.ws.close(1000, 'match_complete')
        room.lastActivity = Math.min(room.lastActivity, t - RULES.roomIdleMs)
      }
      tickRoom(room, elapsed, t)
      if (t - room.lastSnapshotAt >= RULES.snapshotMs) {
        room.lastSnapshotAt = t
        broadcast(room)
      }
    }
  }, 16)
  simulationTimer.unref?.()

  const pingTimer = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.isAlive) { ws.terminate(); continue }
      ws.isAlive = false
      try { ws.ping() } catch { ws.terminate() }
    }
  }, PING_MS)
  pingTimer.unref?.()

  return {
    http,
    rooms,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = error => { http.off('listening', onListening); reject(error) }
        const onListening = () => { http.off('error', onError); resolve(http.address()) }
        http.once('error', onError)
        http.once('listening', onListening)
        http.listen(port, host)
      })
    },
    async close() {
      clearInterval(simulationTimer)
      clearInterval(pingTimer)
      for (const ws of sockets) { try { ws.terminate() } catch { /* already closed */ } }
      await new Promise(resolve => wss.close(() => resolve()))
      if (http.listening) await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()))
    },
    get stats() { return { sockets: sockets.size, rooms: rooms.size, totalConnections } },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createPvpServer()
  app.listen().then(address => {
    console.log(`VOIDSTRIKE PvP ${BUILD_ID} listening on ${address.address}:${address.port}`)
  }).catch(error => {
    console.error('Failed to start VOIDSTRIKE PvP server', error)
    process.exitCode = 1
  })
  const shutdown = () => app.close().finally(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
