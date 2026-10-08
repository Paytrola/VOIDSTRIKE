import type { Action, Input } from '../engine/input'

/**
 * On-screen touch controls for the campaign and Free-Flight mode. Campaign steering keeps its
 * original left stick/FIRE/ROLL behavior; the PvP screen gets its own stick plus climb/dive and
 * ability controls. Both modes feed the same normalized Input abstraction.
 */
export class TouchControls {
  private stickId: number | null = null
  private origin = { x: 0, y: 0 }
  private activeStick?: HTMLElement
  private activeKnob?: HTMLElement

  constructor(
    root: HTMLElement,
    private readonly input: Input,
    private readonly active: () => boolean,
    private readonly isPvpActive: () => boolean = () => false,
  ) {
    const radius = 58
    const enable = () => document.body.classList.add('has-touch')
    if (matchMedia('(pointer: coarse)').matches) enable()
    window.addEventListener('touchstart', enable, { once: true, passive: true })
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') this.input.method = 'touch'
    }, { capture: true })

    const canvas = document.querySelector<HTMLCanvasElement>('#game')!
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || !(this.active() || this.isPvpActive())) return
      const selector = this.isPvpActive() ? '.touch-pvp .touch-stick' : '.screen-hud .touch-stick'
      const stick = root.querySelector<HTMLElement>(selector)
      const knob = stick?.querySelector<HTMLElement>('i')
      if (!stick || !knob || e.clientX >= window.innerWidth * 0.55 || this.stickId !== null) return
      this.stickId = e.pointerId
      this.activeStick = stick
      this.activeKnob = knob
      this.origin = { x: e.clientX, y: e.clientY }
      stick.style.left = `${e.clientX}px`
      stick.style.top = `${e.clientY}px`
      stick.classList.add('is-active')
    })
    window.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickId || !this.activeStick || !this.activeKnob) return
      let dx = e.clientX - this.origin.x
      let dy = e.clientY - this.origin.y
      const len = Math.hypot(dx, dy)
      if (len > radius) {
        this.origin.x += (dx / len) * (len - radius)
        this.origin.y += (dy / len) * (len - radius)
        this.activeStick.style.left = `${this.origin.x}px`
        this.activeStick.style.top = `${this.origin.y}px`
        dx = (dx / len) * radius
        dy = (dy / len) * radius
      }
      this.activeKnob.style.transform = `translate(${dx}px, ${dy}px)`
      this.input.setTouchMove(dx / radius, -dy / radius)
    })
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return
      this.stickId = null
      if (this.activeKnob) this.activeKnob.style.transform = ''
      if (this.activeStick) {
        this.activeStick.classList.remove('is-active')
        this.activeStick.style.left = ''
        this.activeStick.style.top = ''
      }
      this.activeStick = undefined
      this.activeKnob = undefined
      this.input.setTouchMove(0, 0)
    }
    window.addEventListener('pointerup', endStick)
    window.addEventListener('pointercancel', endStick)

    for (const btn of root.querySelectorAll<HTMLElement>('[data-touch]')) {
      const action = btn.dataset.touch as Action
      btn.addEventListener('pointerdown', e => {
        e.preventDefault()
        btn.setPointerCapture(e.pointerId)
        btn.classList.add('is-down')
        this.input.setTouchButton(action, true)
      })
      const up = () => {
        btn.classList.remove('is-down')
        this.input.setTouchButton(action, false)
      }
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointercancel', up)
      btn.addEventListener('lostpointercapture', up)
    }

    for (const btn of root.querySelectorAll<HTMLElement>('[data-flight-vertical]')) {
      const value = Math.max(-1, Math.min(1, Number(btn.dataset.flightVertical) || 0))
      btn.addEventListener('pointerdown', e => {
        e.preventDefault()
        btn.setPointerCapture(e.pointerId)
        btn.classList.add('is-down')
        this.input.setTouchFlightVertical(value)
      })
      const up = () => {
        btn.classList.remove('is-down')
        this.input.setTouchFlightVertical(0)
      }
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointercancel', up)
      btn.addEventListener('lostpointercapture', up)
    }
  }
}
