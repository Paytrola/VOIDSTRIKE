import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Procedural low-poly model kit. Every model is built from primitives, flat-shaded and baked into
 * vertex colours, then merged into one geometry per material ("body" is lit, "glow" is emissive
 * and feeds the bloom). Nothing is loaded from disk and every design is original.
 */
export type ModelParts = { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }

type Xf = { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number }

export class Kit {
  private readonly body: THREE.BufferGeometry[] = []
  private readonly glow: THREE.BufferGeometry[] = []
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly v = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()

  add(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, xf: Xf = {}, glow = false, jitter = 0): this {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    geometry.dispose()
    g.deleteAttribute('uv')
    if (jitter > 0) jitterVertices(g, jitter)
    this.e.set(...(xf.r ?? [0, 0, 0]))
    this.q.setFromEuler(this.e)
    const s = xf.s ?? 1
    this.sc.set(...(typeof s === 'number' ? ([s, s, s] as [number, number, number]) : s))
    this.m.compose(this.v.set(...(xf.p ?? [0, 0, 0])), this.q, this.sc)
    g.applyMatrix4(this.m)
    g.computeVertexNormals()
    const c = new THREE.Color(color)
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i += 1) {
      // Tiny per-face value variation keeps big flat areas from looking plastic.
      const f = 1 - (Math.floor(i / 3) % 3) * 0.035
      colors[i * 3] = c.r * f
      colors[i * 3 + 1] = c.g * f
      colors[i * 3 + 2] = c.b * f
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    ;(glow ? this.glow : this.body).push(g)
    return this
  }

  /** Mirror-add across X (for symmetric wings, arms). */
  pair(make: () => THREE.BufferGeometry, color: THREE.ColorRepresentation, xf: Xf, glow = false): this {
    const p = xf.p ?? [0, 0, 0]
    const r = xf.r ?? [0, 0, 0]
    this.add(make(), color, { ...xf, p: [p[0], p[1], p[2]], r }, glow)
    this.add(make(), color, { ...xf, p: [-p[0], p[1], p[2]], r: [r[0], -r[1], -r[2]] }, glow)
    return this
  }

  build(): ModelParts {
    const empty = () => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3))
      return g
    }
    const body = this.body.length ? mergeGeometries(this.body) : empty()
    const glow = this.glow.length ? mergeGeometries(this.glow) : empty()
    body.computeBoundingSphere()
    glow.computeBoundingSphere()
    return { body, glow }
  }
}

function jitterVertices(g: THREE.BufferGeometry, amount: number): void {
  // Move shared positions consistently (hash by rounded position) so faces stay closed.
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const offsets = new Map<string, [number, number, number]>()
  for (let i = 0; i < pos.count; i += 1) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
    let o = offsets.get(key)
    if (!o) {
      o = [(Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount]
      offsets.set(key, o)
    }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2])
  }
}

export const PALETTE = {
  ivory: '#ece6d6',
  ivoryShade: '#bdb6a6',
  sunset: '#ff7a2f',
  ember: '#ff4f3a',
  graphite: '#2c2f45',
  steel: '#555a78',
  glass: '#3fd0ff',
  cyanGlow: '#7ff6ff',
  mining: '#e8b23a',
  rust: '#9a4b2c',
  hull: '#3b3656',
  magenta: '#ff3d8e',
  toxic: '#9dff5c',
}

// Primitive shortcuts: all low segment counts on purpose.
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z)
const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg)
const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg)
const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d)
const oct = (r: number) => new THREE.OctahedronGeometry(r, 0)
const tet = (r: number) => new THREE.TetrahedronGeometry(r, 0)
const HALF = Math.PI / 2

/**
 * HELIOSPUR interceptor: a lance-shaped fuselage threaded through a broken halo wing, with two
 * forward-swept spur blades. Nose points to -Z.
 */
export function buildHeliospur(): ModelParts {
  const k = new Kit()
  const P = PALETTE
  // Lance fuselage.
  k.add(cone(0.36, 2.3, 6), P.ivory, { p: [0, 0, -1.55], r: [-HALF, 0, 0] })
  k.add(cyl(0.36, 0.5, 1.3, 6), P.ivory, { p: [0, 0, 0.25], r: [HALF, 0, 0] })
  k.add(cyl(0.5, 0.34, 0.6, 6), P.graphite, { p: [0, 0, 1.15], r: [HALF, 0, 0] })
  // Keel and spine accents.
  k.add(box(0.12, 0.5, 1.9), P.sunset, { p: [0, -0.34, -0.2] })
  k.add(box(0.1, 0.26, 1.2), P.sunset, { p: [0, 0.44, 0.35] })
  // Canopy: faceted glass shard.
  k.add(oct(0.3), P.glass, { p: [0, 0.3, -0.55], s: [0.75, 0.6, 2.1] })
  // Broken halo wing (open at the bottom) around the rear fuselage.
  k.add(new THREE.TorusGeometry(1.35, 0.13, 4, 12, Math.PI * 1.55), P.ivoryShade, { p: [0, 0.05, 0.45], r: [0, 0, -Math.PI * 0.275] })
  k.add(new THREE.TorusGeometry(1.35, 0.05, 3, 12, Math.PI * 1.55), P.sunset, { p: [0, 0.05, 0.62], r: [0, 0, -Math.PI * 0.275] })
  // Struts from fuselage to halo.
  k.pair(() => box(1.0, 0.08, 0.3), P.graphite, { p: [0.72, 0.28, 0.45], r: [0, 0, 0.42] })
  // Forward-swept spur blades.
  k.pair(() => box(1.75, 0.07, 0.5), P.ivory, { p: [1.8, -0.35, -0.2], r: [0, 0.55, -0.12] })
  k.pair(() => box(0.62, 0.08, 0.3), P.sunset, { p: [2.5, -0.44, -0.75], r: [0, 0.55, -0.12] })
  // Wingtip lights.
  k.pair(() => oct(0.1), P.cyanGlow, { p: [2.72, -0.46, -0.95] }, true)
  // Twin engine pods.
  k.pair(() => cyl(0.22, 0.28, 0.95, 6), P.graphite, { p: [0.55, -0.18, 0.95], r: [HALF, 0, 0] })
  k.pair(() => cyl(0.2, 0.2, 0.08, 6), P.cyanGlow, { p: [0.55, -0.18, 1.45], r: [HALF, 0, 0] }, true)
  k.add(cyl(0.22, 0.22, 0.08, 6), P.cyanGlow, { p: [0, 0, 1.47], r: [HALF, 0, 0] }, true)
  // Gun tips.
  k.pair(() => box(0.08, 0.08, 0.7), P.graphite, { p: [0.95, -0.3, -0.7] })
  return k.build()
}

/** MITE: a scout drone — dark core, three mining-yellow cutter legs, a single hot eye. */
export function buildMite(): ModelParts {
  const k = new Kit()
  const P = PALETTE
  k.add(ico(0.55, 0), P.hull, { s: [1, 1, 1.25] })
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + HALF
    k.add(tet(0.45), P.mining, { p: [Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0.15], r: [0.3, 0, a], s: [0.6, 1.9, 0.35] })
  }
  k.add(box(0.22, 0.22, 0.22), P.steel, { p: [0, 0, 0.62] })
  k.add(oct(0.2), P.magenta, { p: [0, 0, -0.62] }, true)
  return k.build()
}

/** CHISEL: a wedge-bodied cutter with a stubby drill nose and twin furnace intakes. */
export function buildChisel(): ModelParts {
  const k = new Kit()
  const P = PALETTE
  k.add(box(1.6, 0.55, 2.0), P.hull, { p: [0, 0, 0.2] })
  k.add(box(2.6, 0.18, 1.1), P.steel, { p: [0, -0.05, 0.55] })
  k.add(cone(0.42, 1.3, 6), P.mining, { p: [0, 0, -1.3], r: [-HALF, 0, 0] })
  k.add(cyl(0.45, 0.45, 0.3, 6), P.graphite, { p: [0, 0, -0.65], r: [HALF, 0, 0] })
  k.pair(() => box(0.3, 0.9, 1.2), P.mining, { p: [1.35, 0.25, 0.6], r: [0, 0, -0.3] })
  k.pair(() => cyl(0.18, 0.18, 0.1, 6), P.sunset, { p: [0.45, 0.02, 1.22], r: [HALF, 0, 0] }, true)
  k.add(box(0.7, 0.12, 0.2), P.ember, { p: [0, 0.3, -0.35] }, true)
  return k.build()
}

/** LANTERN: a hexagonal ore-furnace pod. Six armour petals ring a molten core. */
export function buildLantern(): ModelParts {
  const k = new Kit()
  const P = PALETTE
  k.add(cyl(1.25, 1.25, 1.3, 6), P.hull, { r: [HALF, 0, 0] })
  k.add(cyl(0.9, 1.25, 0.5, 6), P.steel, { p: [0, 0, 0.9], r: [HALF, 0, 0] })
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2
    k.add(box(0.8, 0.3, 1.9), P.mining, { p: [Math.cos(a) * 1.55, Math.sin(a) * 1.55, -0.2], r: [0, 0, a + HALF] })
  }
  k.add(ico(0.75, 0), P.sunset, { p: [0, 0, -0.75] }, true)
  k.add(cyl(0.3, 0.3, 0.2, 6), P.cyanGlow, { p: [0, 0, 1.2], r: [HALF, 0, 0] }, true)
  return k.build()
}

/** Floating proximity mine: spiked octahedron with a blinking eye (the eye pulses in the shader via flash). */
export function buildMine(): ModelParts {
  const k = new Kit()
  const P = PALETTE
  k.add(oct(0.7), P.graphite)
  const dirs: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (const d of dirs) {
    const r: [number, number, number] = d[1] !== 0 ? [d[1] > 0 ? 0 : Math.PI, 0, 0] : d[0] !== 0 ? [0, 0, d[0] > 0 ? -HALF : HALF] : [d[2] > 0 ? HALF : -HALF, 0, 0]
    k.add(cone(0.16, 0.6, 4), P.mining, { p: [d[0] * 0.75, d[1] * 0.75, d[2] * 0.75], r })
  }
  k.add(oct(0.32), P.ember, { p: [0, 0, -0.35] }, true)
  return k.build()
}

/** Asteroid variants: jittered icosahedra in dusty violet-brown. */
export function buildRock(seed: number, detail = 1, tint: THREE.ColorRepresentation = '#6d5a6e'): THREE.BufferGeometry {
  const k = new Kit()
  const g = ico(1, detail)
  const c = new THREE.Color(tint).offsetHSL((seed % 3) * 0.02 - 0.02, 0, (seed % 4) * 0.02 - 0.03)
  k.add(g, c, { s: [1 + (seed % 3) * 0.12, 0.85 + (seed % 2) * 0.2, 1.05] }, false, 0.32)
  return k.build().body
}

/** Ore chunk hurled by the boss: rock with glowing veins. */
export function buildOreChunk(): ModelParts {
  const k = new Kit()
  k.add(ico(1, 0), '#5a4250', {}, false, 0.35)
  k.add(oct(0.55), PALETTE.sunset, { p: [0.3, 0.2, -0.55], s: [1.2, 0.5, 0.5] }, true)
  k.add(oct(0.45), PALETTE.sunset, { p: [-0.35, -0.25, 0.5], s: [0.5, 1.2, 0.5] }, true)
  return k.build()
}

/** Repair cell pickup. */
export function buildCell(): ModelParts {
  const k = new Kit()
  k.add(oct(0.55), '#e9fff4', { s: [0.8, 1.3, 0.8] })
  k.add(box(0.95, 0.22, 0.22), PALETTE.toxic, {}, true)
  k.add(box(0.22, 0.95, 0.22), PALETTE.toxic, {}, true)
  return k.build()
}

export { box, cone, cyl, ico, oct, tet, HALF }
