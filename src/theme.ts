import { useEffect } from 'react'
import type { AppSettings } from './data/types'

/**
 * Theme application: `settings.theme` drives `data-theme` on <html>, which the
 * Ember override block in index.css keys off. Volt is the default (no attribute
 * → :root Volt tokens apply, zero visual change).
 */
export function applyTheme(theme: AppSettings['theme']): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === 'ember') root.setAttribute('data-theme', 'ember')
  else root.removeAttribute('data-theme')
}

/** Effect binding used by the App shell so the theme is global across screens. */
export function useThemeEffect(theme: AppSettings['theme']): void {
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
}
