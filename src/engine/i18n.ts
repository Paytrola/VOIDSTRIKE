import en from '../i18n/en.json'
import type { Locale } from './save'

export type Dictionary = Record<string, string>

/** This remix intentionally ships one player-facing locale: English. */
export function detectLocale(_languages: readonly string[] | undefined): Locale {
  return 'en'
}

export function resolveLocale(_saved: Locale | '', _languages: readonly string[] | undefined): Locale {
  return 'en'
}

export class I18n {
  locale: Locale = 'en'
  private listeners = new Set<(locale: Locale) => void>()

  constructor(_locale: Locale = 'en') {
    document.documentElement.lang = 'en'
  }

  /** Look up `key`, replacing `{name}` placeholders. Missing keys render the key so gaps are visible. */
  t(key: string, vars: Record<string, string | number> = {}): string {
    const text = (en as Dictionary)[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
  }

  set(_locale: Locale): void {
    // English is the only exposed locale in VOIDSTRIKE.
  }

  onChange(fn: (locale: Locale) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const DICTIONARY_KEYS = { en: Object.keys(en) }
