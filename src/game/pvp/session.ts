import { PVP_BUILD_ID, PVP_PROTOCOL, parseServerMessage, type PvpConfig, type PvpSnapshot } from './protocol'

export type PvpIntent = { kind: 'create' } | { kind: 'join'; room: string }
export type PvpSessionCallbacks = {
  onState(state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', code?: string): void
  onWelcome(info: { room: string; seatId: string; resumed: boolean }): void
  onSnapshot(snapshot: PvpSnapshot): void
  onError(code: string): void
}

const RETRY_MS = [1000, 2000, 4000, 8000, 12_000, 15_000, 15_000, 15_000, 15_000, 15_000]
const MAX_SERVER_MESSAGE_BYTES = 64 * 1024
const CLIENT_HEARTBEAT_MS = 15_000
const CONNECT_TIMEOUT_MS = 75_000

function safeStorageGet(key: string): string | null {
  try { return sessionStorage.getItem(key) } catch { return null }
}
function safeStorageSet(key: string, value: string): void {
  try { sessionStorage.setItem(key, value) } catch { /* storage may be unavailable in private/embedded contexts */ }
}
function safeStorageRemove(key: string): void {
  try { sessionStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}

export class PvpSession {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' = 'disconnected'
  private socket?: WebSocket
  private heartbeatTimer?: number
  private retryTimer?: number
  private connectTimer?: number
  private retryIndex = 0
  private stopped = false
  private fatalError = false
  private heartbeatId = 0
  private readonly outstandingPings = new Map<number, number>()
  private lastSnapshotAt = 0
  private rttMs = 120
  private clockOffsetMs = 0
  errorCode?: string
  private currentIntent?: PvpIntent
  private config?: PvpConfig
  private classId: string = 'wraith'
  private callsign = 'PILOT'
  private storageKey?: string
  private seatToken?: string
  room?: string
  seatId?: string
  latestSnapshot?: PvpSnapshot

  get connected(): boolean { return this.socket?.readyState === WebSocket.OPEN && !!this.seatId }
  get snapshotAgeMs(): number {
    if (!this.lastSnapshotAt) return 0
    return Math.max(0, Math.min(150, this.rttMs * 0.5 + performance.now() - this.lastSnapshotAt))
  }
  get estimatedServerNow(): number { return Date.now() + this.clockOffsetMs }

  constructor(private readonly callbacks: PvpSessionCallbacks) {}

  private setState(state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', code?: string): void {
    this.state = state
    if (state === 'connected') this.errorCode = undefined
    else if (code) this.errorCode = code
    this.callbacks.onState(state, code)
  }

  connect(config: PvpConfig, intent: PvpIntent, classId: string, callsign: string): void {
    this.dispose(false)
    this.stopped = false
    this.config = config
    this.currentIntent = intent
    this.classId = classId
    this.callsign = callsign
    this.retryIndex = 0
    this.fatalError = false
    this.room = intent.kind === 'join' ? intent.room : undefined
    this.storageKey = this.room ? `voidstrike:pvp:resume:${this.room}` : undefined
    this.seatToken = this.storageKey ? safeStorageGet(this.storageKey) ?? undefined : undefined
    this.connectSocket(false)
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState !== WebSocket.OPEN) return
      const pingId = ++this.heartbeatId
      this.outstandingPings.set(pingId, performance.now())
      while (this.outstandingPings.size > 8) this.outstandingPings.delete(this.outstandingPings.keys().next().value!)
      this.send({ type: 'heartbeat', pingId })
    }, CLIENT_HEARTBEAT_MS)
  }

  private connectSocket(reconnecting: boolean): void {
    if (this.stopped || !this.config || !this.currentIntent) return
    const url = new URL(this.config.signalingUrl)
    if (reconnecting && this.room) url.searchParams.set('room', this.room)
    else if (this.currentIntent.kind === 'create') url.searchParams.set('create', '1')
    else url.searchParams.set('room', this.currentIntent.room)
    this.setState(reconnecting ? 'reconnecting' : 'connecting')
    let socket: WebSocket
    try { socket = new WebSocket(url.toString()) } catch {
      this.setState('disconnected', 'network_error')
      return
    }
    this.socket = socket
    this.connectTimer = window.setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.CONNECTING) {
        try { socket.close(4000, 'connect_timeout') } catch { /* close handler will schedule the next bounded attempt */ }
      }
    }, CONNECT_TIMEOUT_MS)
    socket.addEventListener('open', () => {
      if (this.connectTimer !== undefined) window.clearTimeout(this.connectTimer)
      this.connectTimer = undefined
      if (this.stopped || this.socket !== socket) return socket.close()
      if (reconnecting && this.seatToken) {
        this.send({ type: 'resume', protocol: PVP_PROTOCOL, build: PVP_BUILD_ID, seatToken: this.seatToken })
      } else {
        this.send({ type: 'hello', protocol: PVP_PROTOCOL, build: PVP_BUILD_ID, aircraft: this.classId, callsign: this.callsign })
      }
    })
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return
      const data = event.data
      const text = typeof data === 'string' ? data : ''
      if (!text || new TextEncoder().encode(text).byteLength > MAX_SERVER_MESSAGE_BYTES) {
        socket.close(4400, 'oversized_message')
        return
      }
      let raw: unknown
      try { raw = JSON.parse(text) } catch { socket.close(4400, 'invalid_json'); return }
      const message = parseServerMessage(raw)
      if (!message) { socket.close(4401, 'invalid_server_message'); return }
      if (message.type === 'welcome') {
        this.room = message.room
        this.seatId = message.seatId
        this.seatToken = message.seatToken
        this.storageKey = `voidstrike:pvp:resume:${message.room}`
        safeStorageSet(this.storageKey, message.seatToken)
        this.retryIndex = 0
        this.fatalError = false
        this.setState('connected')
        this.callbacks.onWelcome({ room: message.room, seatId: message.seatId, resumed: message.resumed })
      } else if (message.type === 'snapshot') {
        this.latestSnapshot = message
        this.lastSnapshotAt = performance.now()
        this.callbacks.onSnapshot(message)
      } else if (message.type === 'error') {
        this.fatalError = true
        this.errorCode = message.code
        this.callbacks.onError(message.code)
      } else if (message.type === 'heartbeat_ack' && message.pingId !== null) {
        const sentAt = this.outstandingPings.get(message.pingId)
        if (sentAt !== undefined) {
          const sample = Math.max(0, performance.now() - sentAt)
          this.rttMs = this.rttMs * 0.7 + sample * 0.3
          this.clockOffsetMs = message.serverTime - (Date.now() - sample * 0.5)
          this.outstandingPings.delete(message.pingId)
        }
      }
    })
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.setState('disconnected', 'network_error')
    })
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return
      if (this.connectTimer !== undefined) window.clearTimeout(this.connectTimer)
      this.connectTimer = undefined
      this.socket = undefined
      if (this.stopped) return
      if (!this.fatalError && this.currentIntent && this.retryIndex < RETRY_MS.length) {
        const delay = RETRY_MS[this.retryIndex++]
        this.setState('reconnecting', event.reason || 'connection_lost')
        this.retryTimer = window.setTimeout(() => this.connectSocket(!!(this.seatToken && this.room)), delay)
      } else {
        this.setState('disconnected', event.reason || `closed_${event.code}`)
      }
    })
  }

  sendInput(input: { seq: number; move: { strafe: number; vertical: number; forward: number }; look: { yaw: number; pitch: number }; fire: boolean; roll: boolean; ability: boolean }): void {
    this.send({ type: 'input', ...input })
  }

  retry(): void {
    if (this.stopped || !this.currentIntent || !this.config) return
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.retryIndex = 0
    this.fatalError = false
    this.connectSocket(!!(this.seatToken && this.room))
  }

  markMatchComplete(): void {
    this.fatalError = true
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    try { this.socket.send(JSON.stringify(message)) } catch { /* close handler will surface connection loss */ }
  }

  dispose(clearToken = true): void {
    this.stopped = true
    if (this.heartbeatTimer !== undefined) window.clearInterval(this.heartbeatTimer)
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer)
    if (this.connectTimer !== undefined) window.clearTimeout(this.connectTimer)
    this.heartbeatTimer = undefined
    this.retryTimer = undefined
    this.connectTimer = undefined
    const socket = this.socket
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'leave' })) } catch { /* close below */ }
    }
    this.socket = undefined
    try { socket?.close(1000, 'client_leave') } catch { /* already closed */ }
    if (clearToken && this.storageKey) safeStorageRemove(this.storageKey)
    this.room = undefined
    this.seatId = undefined
    this.seatToken = undefined
    this.latestSnapshot = undefined
    this.lastSnapshotAt = 0
    this.outstandingPings.clear()
  }
}
