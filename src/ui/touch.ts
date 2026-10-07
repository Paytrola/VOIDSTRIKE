import type { Action, Input } from '../engine/input'

/**
 * On-screen touch controls for landscape phones: a floating stick anywhere on the left 55% of the
 * screen steers the ship, a large hold-to-fire button and a ROLL button sit under the right thumb.
 * Aim is assisted automatically on touch (see CONFIG.aim.assistTouch). No gyro or other
 * phone-only sensors are used.
 */
export class TouchControls {
  private stickId: number | null = null
  private origin = { x: 0, y: 0 }
  private readonly stick: HTMLElement
  private readonly knob: HTMLElement

  constructor(root: HTMLElement, private readonly input: Input, private readonly active: () => boolean) {
    const layer = root.querySelector<HTMLElement>('.touch')!
    this.stick = layer.querySelector('.touch-stick')!
    this.knob = this.stick.querySelector('i')!
    const radius = 58
    const enable = () => document.body.classList.add('has-touch')
    if (matchMedia('(pointer: coarse)').matches) enable()
    window.addEventListener('touchstart', enable, { once: true, passive: true })
    window.addEventListener(
      'pointerdown',
      e => {
        if (e.pointerType === 'touch') this.input.method = 'touch'
      },
      { capture: true },
    )
    const canvas = document.querySelector<HTMLCanvasElement>('#game')!
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || !this.active()) return
      if (e.clientX < window.innerWidth * 0.55 && this.stickId === null) {
        this.stickId = e.pointerId
        this.origin = { x: e.clientX, y: e.clientY }
        this.stick.style.left = `${e.clientX}px`
        this.stick.style.top = `${e.clientY}px`
        this.stick.classList.add('is-active')
      }
    })
    window.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickId) return
      let dx = e.clientX - this.origin.x
      let dy = e.clientY - this.origin.y
      const len = Math.hypot(dx, dy)
      if (len > radius) {
        // Drag the base along so reversing direction is instant.
        this.origin.x += (dx / len) * (len - radius)
        this.origin.y += (dy / len) * (len - radius)
        this.stick.style.left = `${this.origin.x}px`
        this.stick.style.top = `${this.origin.y}px`
        dx = (dx / len) * radius
        dy = (dy / len) * radius
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`
      this.input.setTouchMove(dx / radius, -dy / radius)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return
      this.stickId = null
      this.knob.style.transform = ''
      this.stick.classList.remove('is-active')
      this.stick.style.left = ''
      this.stick.style.top = ''
      this.input.setTouchMove(0, 0)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    for (const btn of layer.querySelectorAll<HTMLElement>('[data-touch]')) {
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
  }
}
