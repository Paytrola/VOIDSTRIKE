import type { Audio } from '../engine/audio'
import type { Song } from '../engine/music'

/** All sound effects are synthesized; nothing is sampled. */
export function defineSounds(a: Audio): void {
  a.define('shoot', au => {
    au.tone({ freq: 1250, to: 380, dur: 0.07, type: 'square', vol: 0.045, filter: 3800 })
    au.noise({ dur: 0.04, vol: 0.05, from: 7000, to: 2500, filterType: 'bandpass' })
  }, 0.045)
  a.define('siegeShot', au => {
    au.tone({ freq: 180, to: 72, dur: 0.18, type: 'sawtooth', vol: 0.16, filter: 950 })
    au.noise({ dur: 0.1, vol: 0.12, from: 1300, to: 260, filterType: 'lowpass' })
  }, 0.12)
  a.define('triadShot', au => {
    au.tone({ freq: 980, to: 570, dur: 0.07, type: 'triangle', vol: 0.055, pan: -0.28 })
    au.tone({ freq: 1080, to: 630, dur: 0.07, type: 'triangle', vol: 0.055 })
    au.tone({ freq: 1180, to: 690, dur: 0.07, type: 'triangle', vol: 0.055, pan: 0.28 })
  }, 0.06)
  a.define('abilityBoost', au => {
    au.noise({ dur: 0.28, vol: 0.15, from: 520, to: 4200, filterType: 'bandpass', q: 1.4 })
    au.tone({ freq: 280, to: 1120, dur: 0.32, type: 'sawtooth', vol: 0.09, filter: 2600 })
  }, 0.28)
  a.define('abilityAegis', au => {
    au.tone({ freq: 190, to: 680, dur: 0.24, type: 'sine', vol: 0.13, echo: 0.3 })
    au.tone({ freq: 380, to: 1220, dur: 0.28, type: 'triangle', vol: 0.09, delay: 0.06 })
  }, 0.24)
  a.define('abilityEMP', au => {
    au.tone({ freq: 115, to: 1450, dur: 0.42, type: 'sawtooth', vol: 0.16, filter: 3000 })
    au.noise({ dur: 0.36, vol: 0.16, from: 300, to: 8200, filterType: 'bandpass', q: 0.9, delay: 0.04 })
  }, 0.4)
  a.define('hit', au => au.tone({ freq: 900 + Math.random() * 200, to: 300, dur: 0.05, type: 'triangle', vol: 0.09 }), 0.03)
  a.define('hitRock', au => au.noise({ dur: 0.06, vol: 0.1, from: 1800, to: 500 }), 0.04)
  a.define('hitBoss', au => {
    au.tone({ freq: 220, to: 120, dur: 0.07, type: 'square', vol: 0.06, filter: 1400 })
    au.noise({ dur: 0.05, vol: 0.06, from: 3200, to: 900, filterType: 'bandpass' })
  }, 0.05)
  a.define('clink', au => au.tone({ freq: 2400 + Math.random() * 600, to: 1800, dur: 0.06, type: 'sine', vol: 0.05 }), 0.06)
  a.define('explode', (au, v) => {
    au.noise({ dur: 0.45, vol: 0.32, from: 2400 - v * 200, to: 90, pan: (Math.random() - 0.5) * 0.6 })
    au.tone({ freq: 140, to: 40, dur: 0.3, type: 'sine', vol: 0.3 })
  }, 0.035)
  a.define('rockBreak', au => {
    au.noise({ dur: 0.35, vol: 0.26, from: 1400, to: 120 })
    au.tone({ freq: 90, to: 45, dur: 0.25, type: 'triangle', vol: 0.2 })
  }, 0.04)
  a.define('explodeBig', au => {
    au.noise({ dur: 0.9, vol: 0.45, from: 1800, to: 60, echo: 0.4 })
    au.tone({ freq: 110, to: 30, dur: 0.7, type: 'sine', vol: 0.45 })
    au.tone({ freq: 60, to: 28, dur: 0.9, type: 'sawtooth', vol: 0.12, filter: 300 })
  }, 0.06)
  a.define('explodeHuge', au => {
    au.noise({ dur: 1.6, vol: 0.55, from: 2600, to: 50, echo: 0.6 })
    au.tone({ freq: 80, to: 22, dur: 1.4, type: 'sine', vol: 0.6 })
    au.tone({ freq: 45, to: 25, dur: 1.6, type: 'sawtooth', vol: 0.16, filter: 240 })
  }, 0.12)
  a.define('enemyShot', au => au.tone({ freq: 520 + Math.random() * 90, to: 260, dur: 0.09, type: 'sawtooth', vol: 0.03, filter: 1800 }), 0.07)
  a.define('roll', au => {
    au.noise({ dur: 0.42, vol: 0.18, from: 600, to: 4200, filterType: 'bandpass', q: 2 })
    au.tone({ freq: 300, to: 900, dur: 0.3, type: 'sine', vol: 0.06 })
  }, 0.2)
  a.define('shieldHit', au => {
    au.tone({ freq: 1600, to: 500, dur: 0.22, type: 'sine', vol: 0.18 })
    au.tone({ freq: 800, to: 1200, dur: 0.2, type: 'triangle', vol: 0.1, delay: 0.02 })
  }, 0.08)
  a.define('hullHit', au => {
    au.noise({ dur: 0.35, vol: 0.4, from: 1600, to: 200 })
    au.tone({ freq: 180, to: 60, dur: 0.35, type: 'square', vol: 0.18, filter: 900 })
  }, 0.1)
  a.define('pickup', au => {
    ;[660, 880, 1320].forEach((f, i) => au.tone({ freq: f, to: f * 1.02, dur: 0.18, type: 'triangle', vol: 0.14, delay: i * 0.06, echo: 0.3 }))
  }, 0.1)
  a.define('graze', au => au.tone({ freq: 2800, to: 3600, dur: 0.04, type: 'sine', vol: 0.035 }), 0.05)
  a.define('combo', (au, v) => {
    const base = 520 * Math.pow(2, Math.min(v, 8) / 12)
    ;[1, 1.25, 1.5].forEach((m, i) => au.tone({ freq: base * m, dur: 0.14, type: 'square', vol: 0.06, filter: 3000, delay: i * 0.045 }))
  }, 0.1)
  a.define('warning', au => {
    for (let i = 0; i < 3; i += 1) {
      au.tone({ freq: 440, to: 440, dur: 0.42, type: 'square', vol: 0.12, filter: 1600, delay: i * 1.1 })
      au.tone({ freq: 330, to: 330, dur: 0.42, type: 'square', vol: 0.12, filter: 1600, delay: i * 1.1 + 0.5 })
    }
  }, 1)
  a.define('charge', au => au.tone({ freq: 120, to: 900, dur: 0.9, type: 'sawtooth', vol: 0.09, filter: 2200 }), 0.3)
  a.define('beamCharge', au => {
    au.tone({ freq: 200, to: 1400, dur: 1.0, type: 'sawtooth', vol: 0.08, filter: 2600 })
    au.tone({ freq: 205, to: 1420, dur: 1.0, type: 'sawtooth', vol: 0.06, filter: 2600 })
  }, 0.4)
  a.define('beamFire', au => {
    au.noise({ dur: 1.8, vol: 0.28, from: 900, to: 400, filterType: 'bandpass', q: 1.5 })
    au.tone({ freq: 70, to: 60, dur: 1.8, type: 'sawtooth', vol: 0.14, filter: 500 })
  }, 0.4)
  a.define('lob', au => au.tone({ freq: 160, to: 70, dur: 0.3, type: 'triangle', vol: 0.2 }), 0.12)
  a.define('slam', au => {
    au.noise({ dur: 1.0, vol: 0.5, from: 900, to: 50, echo: 0.5 })
    au.tone({ freq: 70, to: 25, dur: 0.9, type: 'sine', vol: 0.6 })
  }, 0.3)
  a.define('bossRoar', au => {
    au.tone({ freq: 55, to: 38, dur: 2.0, type: 'sawtooth', vol: 0.22, filter: 420, attack: 0.3 })
    au.tone({ freq: 82, to: 55, dur: 2.0, type: 'square', vol: 0.1, filter: 380, attack: 0.3 })
    au.noise({ dur: 2.0, vol: 0.18, from: 500, to: 200, attack: 0.4 })
  }, 1)
  a.define('drillRev', au => au.tone({ freq: 60, to: 240, dur: 1.2, type: 'sawtooth', vol: 0.16, filter: 900 }), 0.5)
  a.define('bossDeath', au => {
    au.noise({ dur: 3.2, vol: 0.6, from: 3200, to: 40, echo: 0.7 })
    au.tone({ freq: 60, to: 18, dur: 3.0, type: 'sine', vol: 0.7 })
  }, 2)
  a.define('ui', au => au.tone({ freq: 700, to: 760, dur: 0.06, type: 'triangle', vol: 0.12 }), 0.04)
  a.define('uiConfirm', au => {
    au.tone({ freq: 660, to: 990, dur: 0.12, type: 'square', vol: 0.08, filter: 3000 })
    au.tone({ freq: 990, to: 1320, dur: 0.14, type: 'triangle', vol: 0.08, delay: 0.06 })
  }, 0.08)
  a.define('banner', au => {
    au.noise({ dur: 0.5, vol: 0.14, from: 300, to: 5000, filterType: 'bandpass', q: 1.2 })
    au.tone({ freq: 196, dur: 0.6, type: 'sawtooth', vol: 0.08, filter: 1400, echo: 0.4 })
  }, 0.5)
  a.define('win', au => [523, 659, 784, 1047, 1319].forEach((f, i) => au.tone({ freq: f, to: f * 1.01, dur: 0.5, type: 'triangle', vol: 0.18, delay: i * 0.12, echo: 0.4 })), 1)
  a.define('lose', au => [392, 330, 262, 196].forEach((f, i) => au.tone({ freq: f, to: f * 0.97, dur: 0.5, type: 'sine', vol: 0.2, delay: i * 0.18 })), 1)
  a.define('lowHull', au => au.tone({ freq: 880, to: 870, dur: 0.12, type: 'square', vol: 0.05, filter: 2000 }), 0.8)
}

// D minor-ish progressions. Chords are MIDI notes (root, third, fifth, colour tone).
const Dm = [50, 53, 57, 60]
const Bb = [46, 50, 53, 57]
const F = [53, 57, 60, 64]
const C = [48, 52, 55, 59]
const Gm = [55, 58, 62, 65]
const A = [45, 49, 52, 55]
const Em = [52, 55, 59, 62]

export const SOUNDTRACK: Song = {
  bpm: 132,
  sections: {
    title: { chords: [Dm, Bb, F, C], pad: true, arp: '0.1.2.3.2.1.0.2.', arpFilter: 1400, hat: '....x.......x...', gain: { arp: 0.7, hat: 0.5 } },
    cruise: {
      chords: [Dm, Bb, F, C],
      pad: true,
      kick: 'x.......x.......',
      hat: '..x...x...x...x.',
      bass: '0.0.0..00.0.0.r.',
      arp: '0.1.2.3.2.1.0.2.',
      arpFilter: 1800,
    },
    battle: {
      chords: [Dm, Dm, Bb, C, Dm, Dm, Gm, A],
      pad: true,
      kick: 'x...x...x...x..x',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.xo',
      bass: '00.0r.0.00.0r.00',
      arp: '0213021302130213',
      lead: [0, null, null, 3, null, 5, null, 7, null, null, 5, null, 3, null, 2, null],
      arpFilter: 2600,
      gain: { lead: 0.8 },
    },
    storm: {
      chords: [Dm, C, Bb, A],
      kick: 'x.x.x.x.x.x.x.x.',
      snare: '....x.......x.x.',
      hat: 'xxxxxxxxxxxxxxxo',
      bass: '0r0r0r0r0r0r0r0r',
      arp: '3210321032103210',
      arpFilter: 3400,
      pad: true,
    },
    boss: {
      chords: [Dm, Dm, Bb, A, Gm, Gm, Em, A],
      pad: true,
      kick: 'x..xx...x..xx..x',
      snare: '....o.......o..x',
      hat: 'x.xxx.xxx.xxx.xo',
      bass: '0.00r.0.0.00r0r0',
      arp: '0123210301232103',
      lead: [0, null, 1, 3, null, null, 5, null, 7, null, 5, 3, null, 1, null, null],
      arpFilter: 3000,
      gain: { bass: 1.2, lead: 0.9 },
    },
    meltdown: {
      chords: [Em, C, A, [47, 51, 54, 57]],
      pad: true,
      kick: 'x.xxx.x.x.xxx.xx',
      snare: '....o..x....o.xx',
      hat: 'xxxxxxxxxxxxxxxx',
      bass: '0r0r00r00r0r00rr',
      arp: '0321032103210321',
      lead: [7, null, 5, null, 3, null, 5, 7, null, 10, null, 7, 5, null, 3, null],
      arpFilter: 3800,
      gain: { bass: 1.25, lead: 1 },
    },
    victory: { chords: [F, C, Dm, Bb], pad: true, arp: '0.2.1.3.0.2.1.3.', hat: '....x.......x...', kick: 'x.......x.......', arpFilter: 2200 },
    defeat: { chords: [Dm, Bb], pad: true, arp: '0...2...1...0...', arpFilter: 900, gain: { arp: 0.6 } },
  },
}
