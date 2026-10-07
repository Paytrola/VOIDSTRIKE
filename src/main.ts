import './styles/main.css'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import type { Game } from './game/game'
import { TouchControls } from './ui/touch'
import { Ui } from './ui/ui'

let bootTimers: number[] = []

function clearBootTimers(): void {
  for (const timer of bootTimers) window.clearTimeout(timer)
  bootTimers = []
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const firstRun = safeGet(SAVE_KEY) === null
  const save = new SaveStore()
  const i18n = new I18n('en')
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined
  let menuMusic: AudioBuffer | undefined
  let menuMusicSource: AudioBufferSourceNode | undefined
  const playMenuMusic = () => {
    if (!menuMusic || menuMusicSource || game?.mode !== 'title' || ui.screen !== 'title') return
    menuMusicSource = audio.playBuffer(menuMusic, 'music', true)
  }
  const stopMenuMusic = () => {
    if (!menuMusicSource) return
    try { menuMusicSource.stop() } catch { /* already stopped */ }
    menuMusicSource.disconnect()
    menuMusicSource = undefined
  }
  const menuMusicUrl = new URL('/manus-storage/Operation_Cryo_Intro_music_BRM5_KLICKAUD_c7f295ac.mp3', document.baseURI).href
  let lockLostAt = 0

  const applySettings = (d: SaveData) => {
    input.sensitivity = d.sensitivity
    input.invertY = d.invertY
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
    if (game) game.reducedMotion = d.reducedMotion
  }
  const enterRun = () => {
    ui.show('hud')
    loop.resetAccumulator()
    input.endFrame()
    input.lockPointer()
  }
  const startRun = (tutorial: boolean) => {
    if (!game) return
    stopMenuMusic()
    audio.unlock()
    ui.clearHudFx()
    game.start(tutorial)
    enterRun()
  }
  const pause = () => {
    if (game?.mode !== 'playing') return
    game.pause()
    ui.show('pause')
    input.unlockPointer()
  }
  const resume = () => {
    if (game?.mode !== 'paused') return
    game.resume()
    ui.show('hud')
    loop.resetAccumulator()
    input.endFrame()
    input.lockPointer()
  }
  const ui = new Ui(i18n, save, audio, input, {
    play: () => startRun(!save.data.tutorialDone),
    restart: () => startRun(false),
    checkpoint: () => {
      if (!game) return
      ui.clearHudFx()
      if (game.startFromCheckpoint()) enterRun()
      else startRun(false)
    },
    resume,
    quit: () => {
      ui.clearHudFx()
      game?.toTitle()
      ui.show('title')
      input.unlockPointer()
      playMenuMusic()
    },
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (qualityChanged) game?.setQuality(save.data.quality)
    },
    selectAircraft: id => {
      save.update({ aircraftClass: id })
      game?.setAircraftClass(id)
    },
  })
  ui.show('boot')
  applySettings(save.data)

  let bootIsSlow = false
  bootTimers = [
    window.setTimeout(() => {
      if (ui.screen !== 'boot') return
      bootIsSlow = true
      ui.setBootProgress(null)
      ui.setBootStatus('boot.slow')
    }, 10_000),
    window.setTimeout(() => {
      if (ui.screen !== 'boot') return
      bootIsSlow = true
      ui.setBootProgress(null)
      ui.setBootStatus('boot.stalled')
      ui.setBootRetryVisible(true)
    }, 30_000),
  ]

  // three.js, Rapier (WASM) and the game load as a separate chunk behind the progress bar.
  let loaded = 0
  const track = <T>(p: Promise<T>): Promise<T> => p.then(v => {
    loaded += 1
    if (!bootIsSlow) ui.setBootProgress(0.1 + (loaded / 4) * 0.9)
    return v
  })
  ui.setBootProgress(0.1)
  const [{ Game }, { Renderer, suggestQuality }, physics] = await Promise.all([
    track(import('./game/game')),
    track(import('./engine/renderer')),
    track(import('./engine/physics')),
    track(document.fonts.ready),
  ])
  await physics.initPhysics()
  if (firstRun) {
    save.update({ quality: suggestQuality() })
    ui.refreshSettings()
  }
  const renderer = new Renderer(canvas, save.data.quality)
  game = new Game(renderer, input, audio, {
    popup: (text, at, kind) => ui.popup(text, at, kind),
    hurt: kind => ui.hurt(kind),
    hint: key => ui.hint(key),
    banner: (key, sub, style) => ui.banner(key, sub, style),
    letterbox: on => ui.letterbox(on),
    warning: on => ui.warning(on),
    bossBar: on => ui.bossBar(on),
    cue: key => ui.cue(key),
    tutorialDone: () => save.update({ tutorialDone: true }),
    end: (run, info) => {
      input.unlockPointer()
      const fromCheckpoint = g.usedCheckpointRun
      window.setTimeout(() => ui.showResults(run, info.grade, { checkpoint: info.checkpoint, fromCheckpoint }), run.phase === 'won' ? 1600 : 700)
    },
  })
  game.reducedMotion = save.data.reducedMotion
  const g = game
  g.setAircraftClass(save.data.aircraftClass)
  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }
  void audio.load(menuMusicUrl).then(buffer => {
    menuMusic = buffer
    if (audio.running) playMenuMusic()
  }).catch(error => console.warn('Menu music could not be loaded', error))
  const loop = new GameLoop({
    step: dt => g.step(dt),
    render: (alpha, frameSeconds, simSeconds) => {
      input.update()
      if (input.consume('pause') && performance.now() - lockLostAt > 300) {
        if (g.mode === 'playing') pause()
        else if (g.mode === 'paused' && ui.screen === 'pause') resume()
      }
      ui.frame(frameSeconds)
      loop.paused = g.mode === 'paused'
      g.render(alpha, frameSeconds, simSeconds)
      loop.timeScale = g.timeScale
      if (g.mode !== 'title') ui.updateHud(g.hud())
    },
  })
  loop.start()
  g.toTitle()

  // Browsers only allow audio after a gesture: unlock on the first input and start the supplied title track.
  const unlock = () => {
    audio.unlock()
    if (g.mode === 'title') playMenuMusic()
  }
  window.addEventListener('pointerdown', unlock, { capture: true })
  window.addEventListener('keydown', unlock, { capture: true })

  document.addEventListener('pointerlockchange', () => {
    // Browsers release pointer lock on Escape without delivering the key: treat that as pause.
    if (!document.pointerLockElement && g.mode === 'playing' && input.method === 'keyboard') {
      lockLostAt = performance.now()
      pause()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  window.addEventListener('game:pause', pause)
  canvas.addEventListener('click', () => {
    if (g.mode === 'playing') input.lockPointer()
  })
  new TouchControls(document.getElementById('ui')!, input, () => g.mode === 'playing')
  clearBootTimers()
  window.setTimeout(() => { ui.show('title'); playMenuMusic() }, 300)
  // Debug/test hook: QA scripts drive and inspect the run through it.
  ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save, loop }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

boot().catch(err => {
  clearBootTimers()
  console.error(err)
  const el = document.getElementById('ui')
  if (el) {
    el.innerHTML = '<section class="screen screen-boot is-active"><div class="boot-mark"><img src="./assets/share/favicon.png" alt="" /></div><h1 class="boot-logo">VOIDSTRIKE</h1><p class="boot-label">Startup failed. Check your connection, then retry.</p><button class="btn btn-primary" type="button">Retry</button></section>'
    el.querySelector('button')?.addEventListener('click', () => window.location.reload())
  }
})
