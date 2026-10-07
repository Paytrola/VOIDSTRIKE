import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import { insertScore, type Quality, type SaveData, type SaveStore } from '../engine/save'
import type { BannerStyle, HudData, PopupKind } from '../game/game'
import { accuracy, formatClock, type Grade, type RunState } from '../game/rules'

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'settings' | 'leaderboard' | 'results'

export type UiActions = {
  play(): void
  resume(): void
  restart(): void
  checkpoint(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
}

const ICON = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1" fill="currentColor"/></svg>',
  mouse: '<svg viewBox="0 0 16 22" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="19" rx="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 2v7" stroke="currentColor" stroke-width="2"/></svg>',
  lmb: '<svg viewBox="0 0 16 22" aria-hidden="true"><path d="M8 1.5A6.5 6.5 0 0 0 1.5 8v1H8Z" fill="currentColor"/><rect x="1.5" y="1.5" width="13" height="19" rx="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  ship: '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M32 2 38 22 62 30 40 30 36 38 28 38 24 30 2 30 26 22Z" fill="currentColor"/><path d="M32 8 35 22H29Z" fill="#0d0b1f" opacity=".55"/></svg>',
}

const GLYPH = {
  keyboard: {
    keys: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>',
    mouse: `<kbd class="icon">${ICON.mouse}</kbd>`,
    lmb: `<kbd class="icon">${ICON.lmb}</kbd>`,
    j: '<kbd>J</kbd>',
    k: '<kbd>K</kbd>',
    space: '<kbd class="wide">Space</kbd>',
    select: '<kbd>Enter</kbd>',
    back: '<kbd>Esc</kbd>',
  },
  gamepad: {
    ls: '<kbd class="round">L</kbd>',
    rs: '<kbd class="round">R</kbd>',
    rt: '<kbd class="pill">RT</kbd>',
    lt: '<kbd class="pill">LT</kbd>',
    select: '<kbd class="round a">A</kbd>',
    back: '<kbd class="round b">B</kbd>',
  },
}

/**
 * DOM game UI layered over the canvas. Every screen is keyboard-, gamepad- and touch-navigable;
 * all text comes from i18n keys and re-renders on language change.
 */
export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: Screen[] = []
  private readonly cache = new Map<string, string | number | boolean>()
  private hintKey: string | null = null
  private navRepeat = 0
  private lastRun?: RunState
  private lastGrade: Grade = 'D'
  private savedRank = -1
  private lastMethod = ''
  private checkpointRun = false
  private readonly el: Record<string, HTMLElement> = {}

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
  ) {
    this.root = document.getElementById('ui')!
    this.root.insertAdjacentHTML('beforeend', this.template())
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-el]')) this.el[node.dataset.el!] = node
    this.el.bootRetry.addEventListener('click', () => window.location.reload())
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onInput(e))
    this.root.addEventListener('focusin', e => {
      if ((e.target as HTMLElement).matches('.btn, .seg button, .toggle')) this.audio.play('ui')
    })
    window.addEventListener('keydown', e => this.onKey(e))
    i18n.onChange(() => this.translate())
    this.translate()
    this.refreshSettings()
  }

  // ─── screens ────────────────────────────────────────────────────────────
  show(screen: Screen): void {
    this.stack.length = 0
    this.setScreen(screen)
  }

  push(screen: Screen): void {
    this.stack.push(this.screen)
    this.setScreen(screen)
  }

  back(): void {
    const prev = this.stack.pop()
    if (prev) this.setScreen(prev)
    else if (this.screen === 'pause') this.actions.resume()
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    const hudVisible = screen === 'hud' || screen === 'pause' || screen === 'results' || (screen === 'settings' && this.stack.includes('pause'))
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = el.dataset.screen === screen || (el.dataset.screen === 'hud' && hudVisible)
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    if (screen === 'title') this.renderBest()
    if (screen === 'leaderboard') this.renderLeaderboard()
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  setBootProgress(progress: number | null): void {
    const track = this.el.bootBar.parentElement!
    const indeterminate = progress === null
    track.classList.toggle('is-indeterminate', indeterminate)
    if (indeterminate) {
      track.removeAttribute('aria-valuenow')
      track.setAttribute('aria-valuetext', this.el.bootLabel.textContent ?? '')
      this.el.bootBar.style.transform = ''
      return
    }
    const bounded = Math.max(0.04, Math.min(1, progress))
    track.setAttribute('aria-valuenow', String(Math.round(bounded * 100)))
    track.removeAttribute('aria-valuetext')
    this.el.bootBar.style.transform = `scaleX(${bounded})`
  }

  setBootStatus(key: string): void {
    const text = this.i18n.t(key)
    this.el.bootLabel.textContent = text
    const track = this.el.bootBar.parentElement!
    if (track.classList.contains('is-indeterminate')) track.setAttribute('aria-valuetext', text)
  }

  setBootRetryVisible(visible: boolean): void {
    this.el.bootRetry.hidden = !visible
  }

  // ─── HUD ────────────────────────────────────────────────────────────────
  updateHud(h: HudData): void {
    if (this.changed('score', h.score)) this.el.score.textContent = h.score.toLocaleString('en-US')
    const chain = this.el.chain
    if (this.changed('mult', h.multiplier)) {
      this.el.mult.textContent = `×${h.multiplier}`
      chain.classList.remove('pop')
      void chain.offsetWidth
      chain.classList.add('pop')
      chain.dataset.level = String(Math.min(8, h.multiplier))
    }
    chain.classList.toggle('is-active', h.combo > 0)
    if (this.changed('combo', h.combo)) this.el.comboCount.textContent = String(h.combo)
    this.el.chainBar.style.transform = `scaleX(${h.comboFraction.toFixed(3)})`
    this.el.hullBar.style.transform = `scaleX(${h.hull.toFixed(3)})`
    this.el.shieldBar.style.transform = `scaleX(${h.shield.toFixed(3)})`
    if (this.changed('hullN', Math.ceil(h.hull * 100))) this.el.hullN.textContent = String(Math.ceil(h.hull * 100))
    if (this.changed('shieldN', Math.ceil(h.shield * 100))) this.el.shieldN.textContent = String(Math.ceil(h.shield * 100))
    this.el.status.classList.toggle('is-low', h.lowHull)
    this.el.status.classList.toggle('shield-down', h.shield <= 0.01)
    this.el.rollPip.style.setProperty('--ready', h.rollReady.toFixed(3))
    this.el.rollPip.classList.toggle('is-ready', h.rollReady >= 1)
    // Boss bar.
    const b = h.boss
    this.el.bossBar.classList.toggle('is-active', !!b && this.cache.get('bossOn') === true)
    if (b) {
      this.el.bossFill.style.transform = `scaleX(${b.fraction.toFixed(3)})`
      this.el.bossTotal.style.transform = `scaleX(${b.total.toFixed(3)})`
      if (this.changed('bossPhase', b.phase)) {
        this.el.bossPhase.textContent = this.i18n.t('boss.phase', { n: b.phase })
        for (const [i, pip] of [...this.el.bossPips.children].entries()) pip.classList.toggle('is-done', i < b.phase - 1)
        this.el.bossBar.dataset.phase = String(b.phase)
      }
    }
    // Reticle.
    const r = h.reticle
    const W = innerWidth
    const H = innerHeight
    this.el.reticle.classList.toggle('is-visible', r.visible)
    this.el.reticle.classList.toggle('is-locked', r.locked)
    this.el.reticleOuter.style.transform = `translate3d(${((r.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-r.y * 0.5 + 0.5) * H).toFixed(1)}px, 0)`
    this.el.reticleInner.style.transform = `translate3d(${((r.inner.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-r.inner.y * 0.5 + 0.5) * H).toFixed(1)}px, 0)`
  }

  private changed(key: string, v: string | number | boolean): boolean {
    if (this.cache.get(key) === v) return false
    this.cache.set(key, v)
    return true
  }

  bossBar(on: boolean): void {
    this.cache.set('bossOn', on)
    this.cache.delete('bossPhase')
    this.el.bossBar.classList.toggle('is-active', on)
  }

  popup(text: string, at: { x: number; y: number }, kind: PopupKind): void {
    const layer = this.el.popups
    if (layer.childElementCount > 26) layer.firstElementChild?.remove()
    const el = document.createElement('div')
    el.className = `popup popup-${kind}`
    el.textContent = text.startsWith('@') ? this.i18n.t(text.slice(1)) : text
    el.style.left = `${at.x.toFixed(0)}px`
    el.style.top = `${at.y.toFixed(0)}px`
    layer.append(el)
    el.addEventListener('animationend', () => el.remove())
  }

  hurt(kind: 'shield' | 'hull'): void {
    const v = this.el.hurt
    v.dataset.kind = kind
    v.classList.remove('flash')
    void v.offsetWidth
    v.classList.add('flash')
    if (kind === 'hull') {
      const s = this.el.status
      s.classList.remove('shake')
      void s.offsetWidth
      s.classList.add('shake')
    }
  }

  hint(key: string | null): void {
    this.hintKey = key
    this.renderHint()
  }

  private renderHint(): void {
    const el = this.el.hint
    const key = this.hintKey
    if (!key) {
      el.classList.remove('is-active')
      return
    }
    const method = this.input.method
    const vars = { ...GLYPH.keyboard, ...GLYPH.gamepad }
    el.querySelector('span')!.innerHTML = this.i18n.t(`${key}.${method}`, vars)
    el.classList.add('is-active')
  }

  banner(key: string, sub: string, style: BannerStyle): void {
    const el = this.el.banner
    el.dataset.style = style
    this.el.bannerTitle.textContent = this.i18n.t(key)
    this.el.bannerSub.textContent = this.i18n.t(sub)
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
  }

  cue(key: string): void {
    const el = this.el.cue
    el.textContent = this.i18n.t(key)
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
  }

  warning(on: boolean): void {
    this.el.warning.classList.toggle('is-active', on)
  }

  letterbox(on: boolean): void {
    this.el.letterbox.classList.toggle('is-active', on)
    this.root.classList.toggle('is-cinematic', on)
  }

  clearHudFx(): void {
    this.el.popups.replaceChildren()
    this.warning(false)
    this.letterbox(false)
    this.bossBar(false)
    this.hint(null)
    this.el.banner.classList.remove('show')
    this.el.cue.classList.remove('show')
    this.cache.clear()
  }

  // ─── results ────────────────────────────────────────────────────────────
  showResults(run: RunState, grade: Grade, info: { checkpoint: boolean; fromCheckpoint: boolean }): void {
    this.lastRun = run
    this.lastGrade = grade
    this.savedRank = -1
    this.checkpointRun = info.fromCheckpoint
    const won = run.phase === 'won'
    const el = this.q('[data-screen="results"]')
    el.classList.toggle('is-won', won)
    this.el.resultsTitle.setAttribute('data-i18n', won ? 'results.won' : 'results.lost')
    this.el.gradeLetter.textContent = won ? grade : '–'
    this.el.gradeBadge.dataset.grade = won ? grade : 'X'
    const fmt = (v: number) => v.toLocaleString('en-US')
    const rows: [string, string][] = [
      ['results.kills', fmt(run.kills)],
      ['results.maxCombo', fmt(run.maxCombo)],
      ['results.accuracy', `${Math.round(accuracy(run) * 100)}%`],
      ['results.grazes', fmt(run.grazes)],
      ['results.time', formatClock(run.elapsed)],
    ]
    if (won) {
      rows.push(['results.clear', `+${fmt(run.clearBonus)}`], ['results.hullBonus', `+${fmt(run.hullBonus)}`])
      if (run.noDamageBonus > 0) rows.push(['results.flawless', `+${fmt(run.noDamageBonus)}`])
    }
    this.el.resultsTable.innerHTML = rows.map(([k, v], i) => `<div style="--i:${i}"><dt data-i18n="${k}"></dt><dd>${v}</dd></div>`).join('')
    this.el.resultsTotal.textContent = fmt(run.score)
    const best = this.save.data.leaderboard[0]?.score ?? 0
    const ranked = !info.fromCheckpoint && !run.unranked && run.score > 0
    this.el.resultsBest.classList.toggle('is-active', ranked && run.score > best)
    const form = this.el.resultsSave
    form.classList.toggle('is-hidden', !ranked || insertScore(this.save.data.leaderboard, this.entry(run)).rank < 0)
    form.classList.remove('is-saved')
    this.el.resultsNote.setAttribute('data-i18n', run.unranked ? 'results.unrankedNote' : 'results.checkpointNote')
    this.el.resultsNote.classList.toggle('is-hidden', !info.fromCheckpoint && !run.unranked)
    this.q<HTMLInputElement>('.results-name').value = this.save.data.playerName
    this.el.resultsRank.textContent = ''
    this.el.retryBoss.classList.toggle('is-hidden', !info.checkpoint)
    this.translate()
    this.show('results')
  }

  private entry(run: RunState) {
    const name = this.q<HTMLInputElement>('.results-name')?.value.trim().slice(0, 16) || this.save.data.playerName
    return { name, score: run.score, seconds: Math.round(run.elapsed), at: Date.now(), grade: run.phase === 'won' ? this.lastGrade : 'D' }
  }

  private saveScore(): void {
    if (!this.lastRun || this.lastRun.unranked || this.savedRank >= 0 || this.checkpointRun) return
    const entry = this.entry(this.lastRun)
    const { board, rank } = insertScore(this.save.data.leaderboard, entry)
    this.save.update({ leaderboard: board, playerName: entry.name })
    this.savedRank = rank
    this.el.resultsSave.classList.add('is-saved')
    this.el.resultsRank.textContent = rank >= 0 ? this.i18n.t('results.rank', { rank: rank + 1 }) : ''
    this.audio.play('uiConfirm')
    requestAnimationFrame(() => this.navItems()[0]?.focus())
  }

  private renderLeaderboard(): void {
    const list = this.el.board
    const board = this.save.data.leaderboard
    if (board.length === 0) {
      list.innerHTML = `<li class="board-empty">${this.i18n.t('leaderboard.empty')}</li>`
      return
    }
    list.innerHTML = board
      .map((e, i) => `<li class="${i === this.savedRank ? 'is-me' : ''}" style="--i:${i}"><b>${i + 1}</b><span class="board-name"></span><i class="grade-chip" data-grade="${e.grade ?? 'D'}">${e.grade ?? '–'}</i><em>${e.score.toLocaleString('en-US')}</em></li>`)
      .join('')
    list.querySelectorAll('.board-name').forEach((el, i) => (el.textContent = board[i].name))
  }

  private renderBest(): void {
    const best = this.save.data.leaderboard[0]?.score ?? 0
    const el = this.el.titleBest
    el.classList.toggle('is-hidden', best <= 0)
    el.textContent = this.i18n.t('menu.best', { score: best.toLocaleString('en-US') })
  }

  // ─── settings ───────────────────────────────────────────────────────────
  refreshSettings(): void {
    const d = this.save.data
    this.q<HTMLInputElement>('[name="musicVolume"]').value = String(d.musicVolume)
    this.q<HTMLInputElement>('[name="sfxVolume"]').value = String(d.sfxVolume)
    this.q<HTMLInputElement>('[name="sensitivity"]').value = String(d.sensitivity)
    for (const t of this.qa<HTMLButtonElement>('.toggle')) {
      const on = d[t.dataset.setting as 'muted' | 'invertY' | 'reducedMotion'] === true
      t.setAttribute('aria-pressed', String(on))
      t.querySelector('span')!.setAttribute('data-i18n', on ? 'settings.on' : 'settings.off')
    }
    for (const b of this.qa<HTMLButtonElement>('.seg button')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === d.quality))
    }
    for (const r of this.qa<HTMLInputElement>('input[type="range"]')) this.paintRange(r)
    this.translate()
  }

  private paintRange(r: HTMLInputElement): void {
    r.style.setProperty('--fill', `${((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`)
    const out = r.parentElement?.querySelector('output')
    if (out) out.textContent = r.name === 'sensitivity' ? `${Number(r.value).toFixed(1)}×` : `${Math.round(Number(r.value) * 100)}`
  }

  // ─── events ─────────────────────────────────────────────────────────────
  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .toggle, .seg button')
    if (!target) return
    this.audio.unlock()
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'invertY' | 'reducedMotion'
      this.actions.settings({ [key]: !this.save.data[key] })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    if (target.matches('.seg button')) {
      const key = target.parentElement!.dataset.setting
      if (key === 'quality') this.actions.settings({ quality: target.dataset.value as Quality })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    const action = target.dataset.action
    if (action && action !== 'pause') this.audio.play('uiConfirm')
    switch (action) {
      case 'play': this.actions.play(); break
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'checkpoint': this.actions.checkpoint(); break
      case 'quit': this.actions.quit(); break
      case 'settings': this.push('settings'); break
      case 'leaderboard': this.push('leaderboard'); break
      case 'back': this.back(); break
      case 'save-score': this.saveScore(); break
      case 'pause': window.dispatchEvent(new CustomEvent('game:pause')); break
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el.type !== 'range') return
    this.paintRange(el)
    this.actions.settings({ [el.name]: Number(el.value) } as Partial<SaveData>)
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.screen === 'title' && e.code === 'Space' && !e.repeat) {
      e.preventDefault()
      this.audio.unlock()
      this.audio.play('uiConfirm')
      this.actions.play()
      return
    }
    const typing = (e.target as HTMLElement).matches?.('input[type="text"]')
    if (typing && e.code === 'Enter') {
      e.preventDefault()
      this.saveScore()
      return
    }
    if ((e.code === 'Escape' || (e.code === 'Backspace' && !typing)) && this.screen !== 'title') {
      if (this.screen !== 'pause' && this.screen !== 'results') {
        e.preventDefault()
        this.input.consume('pause')
        this.back()
      }
      return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault()
      this.moveFocus(e.code === 'ArrowDown' ? 1 : -1)
    }
  }

  /** Per-frame gamepad menu navigation (keyboard uses native focus + onKey). */
  frame(frameSeconds: number): void {
    if (this.input.method !== this.lastMethod) {
      this.lastMethod = this.input.method
      document.body.dataset.input = this.input.method
      this.renderPrompts()
      this.renderHint()
    }
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.input.method !== 'gamepad') {
      this.input.consume('confirm')
      this.input.consume('back')
      return
    }
    const y = this.input.move.y
    const x = this.input.move.x
    this.navRepeat = Math.max(0, this.navRepeat - frameSeconds)
    const active = document.activeElement as HTMLElement | null
    if (Math.abs(y) > 0.6 && this.navRepeat <= 0) {
      this.moveFocus(y < 0 ? 1 : -1)
      this.navRepeat = 0.22
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.matches('input[type="range"]')) {
      const r = active as HTMLInputElement
      r.value = String(Number(r.value) + Math.sign(x) * Number(r.step || 0.1))
      r.dispatchEvent(new Event('input', { bubbles: true }))
      this.navRepeat = 0.12
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && (active?.parentElement?.matches('.seg') || active?.closest('.menu-row'))) {
      const sib = (Math.sign(x) > 0 ? active.nextElementSibling : active.previousElementSibling) as HTMLElement | null
      if (sib && !sib.classList.contains('is-hidden')) sib.focus()
      this.navRepeat = 0.22
    } else if (Math.abs(y) < 0.3 && Math.abs(x) < 0.3) {
      this.navRepeat = 0
    }
    if (this.input.consume('confirm')) active?.click()
    if (this.input.consume('back') && this.screen !== 'title' && this.screen !== 'results') this.back()
  }

  private navItems(): HTMLElement[] {
    const screen = this.q(`[data-screen="${this.screen}"]`)
    return [...screen.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null && !el.closest('.is-hidden'))
  }

  private moveFocus(dir: 1 | -1): void {
    const items = this.navItems()
    if (items.length === 0) return
    const rows: HTMLElement[][] = []
    for (const el of items) {
      const group = el.parentElement?.matches('.seg, .menu-row') ? el.parentElement : null
      const last = rows[rows.length - 1]
      if (group && last && last[0].parentElement === group) last.push(el)
      else rows.push([el])
    }
    const current = rows.findIndex(r => r.includes(document.activeElement as HTMLElement))
    const next = rows[(current + dir + rows.length) % rows.length]
    ;(next.find(el => el.getAttribute('aria-pressed') === 'true') ?? next[0]).focus()
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  private translate(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.i18n.t(el.dataset.i18n!)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.i18n.t(el.dataset.i18nLabel!))
    for (const el of this.root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) el.placeholder = this.i18n.t(el.dataset.i18nPlaceholder!)
    this.el.logo.dataset.text = this.i18n.t('game.title')
    this.renderPrompts()
    this.renderHint()
    this.renderControls()
    if (this.screen === 'title') this.renderBest()
    if (this.screen === 'leaderboard') this.renderLeaderboard()
    this.cache.delete('bossPhase')
    document.title = `${this.i18n.t('game.title')} · ${this.i18n.t('game.subtitle')}`
  }

  private renderControls(): void {
    const k = GLYPH.keyboard
    const p = GLYPH.gamepad
    const t = (key: string) => this.i18n.t(key)
    this.el.controls.innerHTML = `
      <div class="ctl-col"><h4>${t('controls.kbm')}</h4>
        <p>${k.mouse}<span>${t('controls.aim')}</span></p>
        <p>${k.keys}<span>${t('controls.move')}</span></p>
        <p>${k.lmb}${k.j}<span>${t('controls.fire')}</span></p>
        <p>${k.space}${k.k}<span>${t('controls.roll')}</span></p>
        <p><kbd>Esc</kbd><span>${t('controls.pause')}</span></p>
      </div>
      <div class="ctl-col"><h4>${t('controls.pad')}</h4>
        <p>${p.ls}<span>${t('controls.move')}</span></p>
        <p>${p.rs}<span>${t('controls.aim')}</span></p>
        <p>${p.rt}<span>${t('controls.fire')}</span></p>
        <p>${p.lt}<span>${t('controls.roll')}</span></p>
        <p><kbd class="pill">START</kbd><span>${t('controls.pause')}</span></p>
      </div>`
  }

  renderPrompts(): void {
    const g = this.input.method === 'gamepad' ? GLYPH.gamepad : GLYPH.keyboard
    const html = this.input.method === 'touch' ? '' : `<span>${g.select} ${this.i18n.t('prompt.select')}</span><span>${g.back} ${this.i18n.t('prompt.back')}</span>`
    for (const el of this.qa('.prompts')) el.innerHTML = html
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!
  }

  private qa<T extends HTMLElement = HTMLElement>(sel: string): T[] {
    return [...this.root.querySelectorAll<T>(sel)]
  }

  private template(): string {
    const range = (name: string, label: string, min: number, max: number, step: number) =>
      `<label class="row"><span data-i18n="${label}"></span><span class="range"><input data-nav type="range" name="${name}" min="${min}" max="${max}" step="${step}"><output></output></span></label>`
    const toggle = (setting: string, label: string) =>
      `<div class="row"><span data-i18n="${label}"></span><button data-nav class="toggle" data-setting="${setting}" aria-pressed="false"><i></i><span></span></button></div>`
    return /* html */ `
<section class="screen screen-boot is-active" data-screen="boot">
  <div class="boot-mark"><img src="./assets/share/favicon.png" alt="" /></div>
  <div class="boot-logo outlined" data-i18n="game.title"></div>
  <div class="boot-bar" role="progressbar" aria-labelledby="boot-status" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-el="bootBar"></i></div>
  <div id="boot-status" class="boot-label" data-el="bootLabel" data-i18n="boot.loading" aria-live="polite"></div>
  <button type="button" class="btn btn-primary boot-retry" data-el="bootRetry" data-i18n="boot.retry" hidden></button>
</section>

<section class="screen screen-title" data-screen="title">
  <div class="title-vignette"></div>
  <div class="title-best is-hidden" data-el="titleBest"></div>
  <div class="title-block">
    <div class="logo">
      <h1 class="logo-text" data-el="logo" data-i18n="game.title"></h1>
      <div class="logo-sub"><span data-i18n="game.subtitle"></span></div>
    </div>
    <p class="tagline" data-i18n="game.tagline"></p>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="play"><span data-i18n="menu.play"></span></button>
      <button data-nav class="btn" data-action="leaderboard"><span data-i18n="menu.leaderboard"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
    </nav>
    <p class="deploy-prompt"><span data-i18n="menu.deployPrefix"></span><kbd class="wide">Space</kbd><span data-i18n="menu.deployPrompt"></span></p>
  </div>
  <aside class="controls-card"><h3 data-i18n="controls.title"></h3><div class="controls-grid" data-el="controls"></div></aside>
  <footer class="bottom-bar"><div class="prompts"></div><small data-i18n="credits.fonts"></small></footer>
</section>

<section class="screen screen-hud" data-screen="hud">
  <div class="hurt-vignette" data-el="hurt"></div>
  <div class="letterbox" data-el="letterbox"><i></i><i></i></div>
  <div class="warning" data-el="warning">
    <div class="warning-band top"><div class="warning-track"><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span></div></div>
    <div class="warning-band bottom"><div class="warning-track"><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span><span>WARNING</span></div></div>
  </div>
  <div class="reticle" data-el="reticle">
    <div class="reticle-outer" data-el="reticleOuter"><i></i><i></i><i></i><i></i><b></b></div>
    <div class="reticle-inner" data-el="reticleInner"></div>
  </div>
  <div class="popups" data-el="popups"></div>
  <div class="hud-score-block">
    <div class="hud-score-panel"><span class="hud-label" data-i18n="hud.score"></span><b class="hud-score" data-el="score">0</b></div>
    <div class="hud-chain" data-el="chain" data-level="1">
      <b class="hud-mult" data-el="mult">×1</b>
      <div class="hud-chain-info"><span><em data-el="comboCount">0</em> <small data-i18n="hud.chain"></small></span><div class="hud-chain-bar"><i data-el="chainBar"></i></div></div>
    </div>
  </div>
  <div class="boss-bar" data-el="bossBar" data-phase="1">
    <div class="boss-head"><b class="boss-name" data-i18n="boss.name"></b><span class="boss-phase" data-el="bossPhase"></span><span class="boss-pips" data-el="bossPips"><i></i><i></i><i></i></span></div>
    <div class="boss-track"><i class="boss-total" data-el="bossTotal"></i><i class="boss-fill" data-el="bossFill"></i></div>
  </div>
  <div class="hud-top-right">
    <button class="hud-pause" data-action="pause" data-i18n-label="touch.pause">${ICON.pause}</button>
  </div>
  <div class="hud-status" data-el="status">
    <div class="bar-row shield"><span class="hud-label" data-i18n="hud.shield"></span><div class="bar"><i data-el="shieldBar"></i></div><b data-el="shieldN">100</b></div>
    <div class="bar-row hull"><span class="hud-label" data-i18n="hud.hull"></span><div class="bar"><i data-el="hullBar"></i></div><b data-el="hullN">100</b></div>
    <div class="roll-pip" data-el="rollPip"><span data-i18n="hud.roll"></span></div>
    <div class="low-hull" data-i18n="hud.lowHull"></div>
  </div>
  <div class="banner" data-el="banner"><div class="banner-title" data-el="bannerTitle"></div><div class="banner-sub" data-el="bannerSub"></div></div>
  <div class="cue" data-el="cue"></div>
  <div class="hint" data-el="hint"><span></span></div>
  <div class="touch">
    <div class="touch-stick"><i></i></div>
    <button class="touch-btn touch-roll" data-touch="roll"><span data-i18n="touch.roll"></span></button>
    <button class="touch-btn touch-fire" data-touch="fire"><span data-i18n="touch.fire"></span></button>
  </div>
</section>

<section class="screen screen-pause screen-modal" data-screen="pause">
  <div class="modal">
    <h2 class="modal-title" data-i18n="pause.title"></h2>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="menu.continue"></span></button>
      <button data-nav class="btn" data-action="restart"><span data-i18n="menu.restart"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="menu.quit"></span></button>
    </nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-settings screen-modal" data-screen="settings">
  <div class="modal modal-wide">
    <h2 class="modal-title" data-i18n="settings.title"></h2>
    <div class="settings-grid">
      <fieldset><legend data-i18n="settings.audio"></legend>
        ${range('musicVolume', 'settings.music', 0, 1, 0.05)}
        ${range('sfxVolume', 'settings.sfx', 0, 1, 0.05)}
        ${toggle('muted', 'settings.mute')}
      </fieldset>
      <fieldset><legend data-i18n="settings.controls"></legend>
        ${range('sensitivity', 'settings.sensitivity', 0.2, 3, 0.1)}
        ${toggle('invertY', 'settings.invertY')}
      </fieldset>
      <fieldset><legend data-i18n="settings.display"></legend>
        <div class="row"><span data-i18n="settings.quality"></span><div class="seg" data-setting="quality">
          <button data-nav data-value="low" data-i18n="settings.quality.low"></button><button data-nav data-value="medium" data-i18n="settings.quality.medium"></button><button data-nav data-value="high" data-i18n="settings.quality.high"></button>
        </div></div>
        ${toggle('reducedMotion', 'settings.reducedMotion')}
      </fieldset>
    </div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-leaderboard screen-modal" data-screen="leaderboard">
  <div class="modal">
    <h2 class="modal-title" data-i18n="leaderboard.title"></h2>
    <div class="board-head"><b>#</b><span></span><span data-i18n="leaderboard.rank"></span><em data-i18n="leaderboard.score"></em></div>
    <ol class="board" data-el="board"></ol>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-results screen-modal" data-screen="results">
  <div class="modal modal-results">
    <h2 class="results-title modal-title" data-el="resultsTitle"></h2>
    <div class="results-main">
      <div class="grade-badge" data-el="gradeBadge"><small data-i18n="results.grade"></small><b data-el="gradeLetter">S</b></div>
      <dl class="results-table" data-el="resultsTable"></dl>
    </div>
    <div class="results-total"><span data-i18n="results.total"></span><b data-el="resultsTotal">0</b></div>
    <div class="results-best" data-el="resultsBest" data-i18n="results.newBest"></div>
    <div class="results-save" data-el="resultsSave">
      <input data-nav class="results-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" data-i18n-placeholder="results.name">
      <button data-nav class="btn btn-small" data-action="save-score"><span data-i18n="results.save"></span></button>
      <span class="results-saved" data-i18n="results.saved"></span>
      <span class="results-rank" data-el="resultsRank"></span>
    </div>
    <p class="results-note is-hidden" data-el="resultsNote" data-i18n="results.checkpointNote"></p>
    <nav class="menu menu-row">
      <button data-nav class="btn btn-primary" data-action="restart"><span data-i18n="results.retry"></span></button>
      <button data-nav class="btn is-hidden" data-el="retryBoss" data-action="checkpoint"><span data-i18n="menu.checkpoint"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="results.title"></span></button>
    </nav>
  </div>
</section>`
  }
}
