import { describe, expect, it } from 'vitest'
import en from '../src/i18n/en.json'
import { detectLocale, resolveLocale } from '../src/engine/i18n'

describe('i18n', () => {
  it('pins the game to English regardless of browser language', () => {
    expect(detectLocale(['zh-CN', 'en'])).toBe('en')
    expect(detectLocale(['zh-TW'])).toBe('en')
    expect(detectLocale(['ZH'])).toBe('en')
    expect(detectLocale(['en-US', 'zh-CN'])).toBe('en')
    expect(detectLocale([])).toBe('en')
    expect(detectLocale(undefined)).toBe('en')
  })

  it('lets a saved choice win over detection', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveLocale('', ['zh-CN'])).toBe('en')
  })

  it('provides recoverable boot-status copy', () => {
    expect(en['boot.slow']).toContain('initializing')
    expect(en['boot.stalled']).toContain('retry')
    expect(en['boot.retry']).toBe('Retry')
  })

  it('includes the game title and a clear deployment instruction', () => {
    expect(en['game.title']).toBe('VOIDSTRIKE')
    expect(en['menu.deployPrefix']).toBe('PRESS')
    expect(en['menu.deployPrompt']).toBe('TO DEPLOY')
  })
})
