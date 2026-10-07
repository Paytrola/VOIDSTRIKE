// End-to-end smoke test: builds must already exist in dist/ (`pnpm build`).
// Serves dist/, boots VOIDSTRIKE in headless Chromium, flies a few seconds, walks the menus,
// forces a boss clear through the real damage rules to reach Results, checks English-only mode
// and a phone-landscape HUD, fails on any console error, and writes screenshots to ./shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out'), 240_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 60_000 })
  await page.waitForTimeout(900)
  return page
}

const state = page => page.evaluate(() => {
  const { game } = window.__game
  const p = game.ship.pos
  return { mode: game.mode, run: game.run, pos: { x: p.x, y: p.y }, cam: game['camMode'] }
})

try {
  await waitForServer()
  // Prefer Playwright's bundled Chromium; fall back to an installed Google Chrome.
  const args = ['--ignore-gpu-blocklist']
  // CHROMIUM_PATH lets CI or a sandbox point at an already-installed browser binary.
  const exe = process.env.CHROMIUM_PATH
  browser = await chromium.launch({ args, ...(exe ? { executablePath: exe } : {}) }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []

  const en = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(en, errors)
  await page.screenshot({ path: `${out}/01-title-en.png` })

  await page.keyboard.press('Space')
  await page.waitForSelector('[data-screen="hud"].is-active')
  // Wait out the launch cinematic, then steer with the keyboard.
  await page.waitForFunction(() => window.__game.game['camMode'] === 'play', null, { timeout: 30_000 })
  const before = await state(page)
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(900)
  await page.keyboard.press('Space')
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyD')
  await page.keyboard.down('KeyJ')
  await page.waitForTimeout(800)
  await page.keyboard.up('KeyJ')
  await page.screenshot({ path: `${out}/02-gameplay.png` })
  const after = await state(page)
  if (after.mode !== 'playing') throw new Error(`expected playing, got ${after.mode}`)
  if (!(after.run.elapsed > before.run.elapsed)) throw new Error('run clock did not advance')
  if (!(after.run.shots > before.run.shots)) throw new Error('fire (J) did not shoot')
  const moved = Math.abs(after.pos.x - before.pos.x)
  if (moved < 1) throw new Error(`ship barely moved (${moved.toFixed(2)})`)
  console.log(`smoke: steered ${moved.toFixed(1)} units, ${after.run.shots} shots fired`)

  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/03-pause.png` })
  await page.click('[data-screen="pause"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${out}/04-settings.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(300)
  if ((await state(page)).mode !== 'paused') throw new Error('leaving Settings with Escape resumed the run')

  // Results: jump to the boss and break every weak point through the real damage path.
  await page.evaluate(() => {
    const { game } = window.__game
    game.resume()
    game.debug.invincible = true
    game.debugSkip('boss')
    window.__smokeTimer = setInterval(() => {
      const boss = game.boss
      if (!boss.fighting) return
      for (const part of boss['parts']) boss.damage(part, 60, boss.partPos(part.name))
    }, 250)
  })
  await page.waitForSelector('[data-screen="results"].is-active', { timeout: 150_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/05-results.png` })
  const done = await state(page)
  if (done.run.phase !== 'won') throw new Error(`expected a won run, got ${done.run.phase}`)
  await en.close()

  const nonEnglishBrowser = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
  const pinnedPage = await openGame(nonEnglishBrowser, errors)
  const lang = await pinnedPage.evaluate(() => document.documentElement.lang)
  if (lang !== 'en') throw new Error(`game locale is not pinned to English (lang=${lang})`)
  if (await pinnedPage.locator('[data-setting="locale"]').count()) throw new Error('language selector is still exposed')
  await pinnedPage.screenshot({ path: `${out}/06-title-en-only.png` })
  await nonEnglishBrowser.close()

  const phone = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' })
  const phonePage = await openGame(phone, errors)
  await phonePage.tap('[data-action="play"]')
  await phonePage.waitForSelector('[data-screen="hud"].is-active')
  await phonePage.waitForTimeout(1200)
  await phonePage.screenshot({ path: `${out}/07-phone-hud.png` })
  await phone.close()

  if (errors.length) throw new Error(`console errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — screenshots in ${out}/`)
} catch (err) {
  await fail(err?.message ?? String(err))
}
