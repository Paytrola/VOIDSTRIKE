// Local end-to-end smoke for the real Three.js PvP client. Run after `pnpm build`.
// It temporarily rewrites only dist/multiplayer/bootstrap.json and restores it in finally.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createPvpServer } from '../server/src/server.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distIndex = resolve(root, 'dist/index.html')
const bootstrapPath = resolve(root, 'dist/multiplayer/bootstrap.json')
const previewPort = 4300 + Math.floor(Math.random() * 500)
const origin = `http://127.0.0.1:${previewPort}`
const previewUrl = `${origin}/`
const screenshots = resolve(root, 'shots')

if (!existsSync(distIndex)) throw new Error('Run `pnpm build` before `pnpm smoke:pvp`.')
mkdirSync(screenshots, { recursive: true })
mkdirSync(dirname(bootstrapPath), { recursive: true })
const hadBootstrap = existsSync(bootstrapPath)
const originalBootstrap = hadBootstrap ? readFileSync(bootstrapPath, 'utf8') : undefined
const server = createPvpServer({ host: '127.0.0.1', port: 0, allowedOrigins: origin })
let preview
let browser

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitForPreview() {
  for (let i = 0; i < 80; i += 1) {
    if (preview?.exitCode !== null && preview?.exitCode !== undefined) throw new Error(`Vite preview exited early: ${previewLog}`)
    try {
      const response = await fetch(previewUrl)
      if (response.ok) return
    } catch {}
    await pause(250)
  }
  throw new Error(`Vite preview did not start: ${previewLog}`)
}

let previewLog = ''
try {
  const address = await server.listen()
  writeFileSync(bootstrapPath, JSON.stringify({
    protocol: 'voidstrike-pvp-v1',
    build: 'voidstrike-pvp-0.2.0',
    signalingUrl: `ws://127.0.0.1:${address.port}/ws`,
  }, null, 2))

  preview = spawn(process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'), 'preview',
    '--port', String(previewPort), '--strictPort', '--host', '127.0.0.1',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  preview.stdout.on('data', data => { previewLog = (previewLog + data.toString()).slice(-2000) })
  preview.stderr.on('data', data => { previewLog = (previewLog + data.toString()).slice(-2000) })
  await waitForPreview()

  browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] })
  const errors = []
  const makePage = async context => {
    const page = await context.newPage()
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', error => errors.push(String(error)))
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`) })
    await page.goto(previewUrl)
    await page.waitForSelector('[data-screen="title"].is-active', { timeout: 60_000 })
    await page.locator('[data-action="pvp"]').click()
    await page.waitForSelector('[data-screen="pvp-lobby"].is-active')
    return page
  }

  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const hostPage = await makePage(hostContext)
  await hostPage.locator('[data-action="pvp-create"]').click()
  await hostPage.waitForSelector('[data-screen="pvp-match"].is-active', { timeout: 60_000 })
  await hostPage.waitForFunction(() => document.querySelector('[data-el="pvpRoomCodeMatch"]')?.textContent?.trim() !== '------', null, { timeout: 15_000 })
  const room = (await hostPage.locator('[data-el="pvpRoomCodeMatch"]').textContent())?.trim() ?? ''
  assert.match(room, /^[A-HJ-NP-Z2-9]{6}$/, 'host should receive a server-generated six-character room code')

  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const guestPage = await makePage(guestContext)
  await guestPage.locator('[data-el="pvpRoomInput"]').fill(room)
  await guestPage.locator('[data-action="pvp-join"]').click()
  await guestPage.waitForSelector('[data-screen="pvp-match"].is-active', { timeout: 60_000 })

  const isLive = () => hostPage.evaluate(() => window.__game?.pvp?.()?.session?.latestSnapshot?.phase === 'live')
  await hostPage.waitForFunction(() => window.__game?.pvp?.()?.session?.latestSnapshot?.phase === 'live', null, { timeout: 20_000 })
  await guestPage.waitForFunction(() => window.__game?.pvp?.()?.session?.latestSnapshot?.phase === 'live', null, { timeout: 20_000 })
  assert.equal(server.stats.rooms, 1)
  assert.equal(server.stats.sockets, 2)

  const readLocalPosition = page => page.evaluate(() => {
    const session = window.__game?.pvp?.()?.session
    const player = session?.latestSnapshot?.players?.find(value => value.id === session.seatId)
    return player ? { x: player.position.x, y: player.position.y, z: player.position.z } : null
  })
  const before = await readLocalPosition(hostPage)
  assert.ok(before, 'host should receive its authoritative player snapshot')
  await hostPage.keyboard.down('KeyW')
  await hostPage.waitForTimeout(1000)
  await hostPage.keyboard.up('KeyW')
  await hostPage.waitForFunction(position => {
    const session = window.__game?.pvp?.()?.session
    const player = session?.latestSnapshot?.players?.find(value => value.id === session.seatId)
    if (!player) return false
    return Math.hypot(player.position.x - position.x, player.position.y - position.y, player.position.z - position.z) > 1
  }, before, { timeout: 5_000 })
  const after = await readLocalPosition(hostPage)
  assert.ok(after && Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 1, 'flight input should advance the authoritative ship position')
  await hostPage.screenshot({ path: resolve(screenshots, '08-pvp-local-duel.png') })

  if (errors.length) throw new Error(`browser console/network errors:\n  ${errors.join('\n  ')}`)
  console.log(`pvp smoke: OK — room ${room}, two browser clients live, authoritative flight movement verified; screenshot shots/08-pvp-local-duel.png`)
  await guestContext.close()
  await hostContext.close()
} finally {
  await browser?.close().catch(() => {})
  if (preview && preview.exitCode === null) {
    preview.kill('SIGTERM')
    await new Promise(resolve => preview.once('exit', resolve)).catch(() => {})
  }
  await server.close().catch(() => {})
  if (hadBootstrap) writeFileSync(bootstrapPath, originalBootstrap)
  else if (existsSync(bootstrapPath)) unlinkSync(bootstrapPath)
}
