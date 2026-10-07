import { CONFIG } from './config'

type ControlSpec = {
  id: string
  section: keyof typeof CONFIG
  key: string
  category: string
  label: string
  description: string
  unit: string
  min: number
  max: number
  step: number
}
type Control = ControlSpec & {
  type: 'number'
  default: number
  applyMode: 'NEXT_RUN'
  integrity: 'GAMEPLAY'
}
type Boundary = 'run'

const sections = CONFIG as unknown as Record<string, Record<string, number>>
const specs: ControlSpec[] = [
  { id: 'ship.speed', section: 'ship', key: 'speed', category: 'Flight Systems', label: 'Ship speed', description: 'Applies when the next mission starts.', unit: 'units/s', min: 8, max: 24, step: 1 },
  { id: 'weapon.rate', section: 'weapon', key: 'rate', category: 'Weapons', label: 'Fire rate', description: 'Applies when the next mission starts.', unit: 'shots/s', min: 6, max: 20, step: 1 },
  { id: 'weapon.damage', section: 'weapon', key: 'damage', category: 'Weapons', label: 'Shot damage', description: 'Applies when the next mission starts.', unit: 'damage/shot', min: 1, max: 3, step: 1 },
]
const defaults = Object.fromEntries(specs.map(s => [s.id, sections[s.section][s.key]]))
const controls: readonly Control[] = Object.freeze(specs.map(s => Object.freeze({
  ...s,
  type: 'number' as const,
  default: defaults[s.id],
  applyMode: 'NEXT_RUN' as const,
  integrity: 'GAMEPLAY' as const,
})))
let requested: Record<string, number> = { ...defaults }
let unranked = false

const valueOf = (s: ControlSpec) => sections[s.section][s.key]
const changed = () => specs.some(s => valueOf(s) !== defaults[s.id])

export const tuning = {
  get unranked(): boolean { return unranked },
  controls,
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(specs.map(s => [s.id, valueOf(s)])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > controls.length) throw new Error('Invalid patch')
    const candidate = { ...requested }
    for (const [id, value] of entries) {
      const control = controls.find(c => c.id === id)
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
      candidate[id] = value
    }
    requested = candidate
  },
  activate(boundary: Boundary): void {
    if (boundary !== 'run') return
    for (const spec of specs) sections[spec.section][spec.key] = requested[spec.id]
    // Tweak changes intentionally remove score eligibility for the affected mission.
    unranked = changed()
  },
}
