import * as THREE from 'three'

/**
 * Allocation-free object pool. `acquire()` reuses released objects; `forEach`/`release` keep a
 * dense active list so per-step iteration never touches free slots.
 */
export class ObjectPool<T> {
  readonly active: T[] = []
  private readonly free: T[] = []

  constructor(private readonly create: () => T, prewarm = 0, readonly capacity = Infinity) {
    for (let i = 0; i < prewarm; i += 1) this.free.push(create())
  }

  get size(): number {
    return this.active.length
  }

  /** Returns undefined when the pool is at capacity (callers simply skip the spawn). */
  acquire(): T | undefined {
    if (this.active.length >= this.capacity) return undefined
    const item = this.free.pop() ?? this.create()
    this.active.push(item)
    return item
  }

  /** Iterate the active list; return `false` from the callback to release that item. */
  update(fn: (item: T) => boolean | void): void {
    let w = 0
    for (let r = 0; r < this.active.length; r += 1) {
      const item = this.active[r]
      if (fn(item) === false) this.free.push(item)
      else this.active[w++] = item
    }
    this.active.length = w
  }

  releaseAll(): void {
    for (const item of this.active) this.free.push(item)
    this.active.length = 0
  }
}

/**
 * Adds a per-instance `instanceFlash` (0..1) attribute that blends the lit colour towards white.
 * Works with any built-in lit or basic material; returns the same material.
 */
export function withInstanceFlash<M extends THREE.Material>(material: M): M {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceFlash;\nvarying float vFlash;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = instanceFlash;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.6, 1.5, 1.4), vFlash);')
  }
  material.customProgramCacheKey = () => 'instance-flash'
  return material
}

/**
 * One InstancedMesh filled from scratch every frame: `begin()`, `push()` each visible item,
 * `end()`. A single draw call for any number of bullets, enemies or particles up to `capacity`.
 */
export class InstancedBatch {
  readonly mesh: THREE.InstancedMesh
  private n = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private readonly flash?: THREE.InstancedBufferAttribute

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, opts: { colors?: boolean; flash?: boolean } = {}) {
    if (opts.flash) {
      this.flash = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
      this.flash.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('instanceFlash', this.flash)
      withInstanceFlash(material)
    }
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    if (opts.colors) {
      this.mesh.setColorAt(0, this.c.set('#ffffff'))
      this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    }
  }

  get count(): number {
    return this.n
  }

  begin(): void {
    this.n = 0
  }

  /** Push a transform. `rotation` may be a quaternion or Euler; `scale` a number or vector. */
  push(position: THREE.Vector3, rotation?: THREE.Quaternion | THREE.Euler | null, scale: number | THREE.Vector3 = 1, color?: THREE.ColorRepresentation, flash = 0): boolean {
    if (this.n >= this.capacity) return false
    if (rotation instanceof THREE.Euler) this.q.setFromEuler(rotation)
    else if (rotation) this.q.copy(rotation)
    else this.q.identity()
    if (typeof scale === 'number') this.s.setScalar(scale)
    else this.s.copy(scale)
    this.m.compose(position, this.q, this.s)
    this.mesh.setMatrixAt(this.n, this.m)
    if (color !== undefined && this.mesh.instanceColor) this.mesh.setColorAt(this.n, this.c.set(color))
    if (this.flash) this.flash.setX(this.n, flash)
    this.n += 1
    return true
  }

  /** Push a precomposed matrix. */
  pushMatrix(matrix: THREE.Matrix4, color?: THREE.ColorRepresentation, flash = 0): boolean {
    if (this.n >= this.capacity) return false
    this.mesh.setMatrixAt(this.n, matrix)
    if (color !== undefined && this.mesh.instanceColor) this.mesh.setColorAt(this.n, this.c.set(color))
    if (this.flash) this.flash.setX(this.n, flash)
    this.n += 1
    return true
  }

  end(): void {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    if (this.flash) this.flash.needsUpdate = true
  }
}
