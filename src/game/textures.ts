import * as THREE from 'three'

/** Procedurally drawn textures (no image files). Cached per key. */
const cache = new Map<string, THREE.Texture>()

/** Soft radial glow: white core fading to transparent. */
export function glowTexture(): THREE.Texture {
  const hit = cache.get('glow')
  if (hit) return hit
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.28)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set('glow', tex)
  return tex
}

/** Thin ring for shockwaves. */
export function ringTexture(): THREE.Texture {
  const hit = cache.get('ring')
  if (hit) return hit
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  grad.addColorStop(0.9, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  cache.set('ring', tex)
  return tex
}

/** Diagonal hazard stripes (boss armour decals). */
export function hazardTexture(): THREE.Texture {
  const hit = cache.get('hazard')
  if (hit) return hit
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = '#e8b23a'
  g.fillRect(0, 0, size, size)
  g.fillStyle = '#1d1b2c'
  for (let i = -size; i < size * 2; i += 22) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 11, 0)
    g.lineTo(i + 11 - size, size)
    g.lineTo(i - size, size)
    g.closePath()
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  cache.set('hazard', tex)
  return tex
}
