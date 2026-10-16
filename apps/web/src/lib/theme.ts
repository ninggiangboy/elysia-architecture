import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'theme'
/** Keep in sync with --background in index.css and the inline script in index.html. */
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f8f8fa', dark: '#09090c' }

const systemDark = matchMedia('(prefers-color-scheme: dark)')

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be blocked (private mode): fall back to following the system.
  }
  return 'system'
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? (systemDark.matches ? 'dark' : 'light') : preference
}

function apply(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

/** Where the switch ripples out from, in viewport pixels. */
export interface ThemeOrigin {
  x: number
  y: number
}

/** Swaps the theme with a circle growing from `origin` where the browser supports view transitions; otherwise it just swaps. */
function applyAnimated(theme: ResolvedTheme, origin: ThemeOrigin) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply(theme)
    return
  }
  const { x, y } = origin
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const transition = document.startViewTransition(() => apply(theme))
  transition.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 450, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    // A skipped transition (e.g. the tab was hidden) rejects; the theme is applied either way.
    .catch(() => {})
}

export interface ThemeState {
  preference: ThemePreference
  resolved: ResolvedTheme
}

function snapshot(preference: ThemePreference): ThemeState {
  return { preference, resolved: resolve(preference) }
}

let state = snapshot(readPreference())
const listeners = new Set<() => void>()

function update(preference: ThemePreference, origin?: ThemeOrigin) {
  const next = snapshot(preference)
  if (next.preference === state.preference && next.resolved === state.resolved) return
  const changesLook = next.resolved !== state.resolved
  state = next
  if (origin && changesLook) applyAnimated(state.resolved, origin)
  else apply(state.resolved)
  for (const l of listeners) l()
}

// Follow the OS while the preference is "system", and follow a change made in another tab.
systemDark.addEventListener('change', () => update(state.preference))
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY || e.key === null) update(readPreference())
})

export const themeStore = {
  get: () => state,
  set(preference: ThemePreference, origin?: ThemeOrigin) {
    try {
      if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, preference)
    } catch {
      // Not persisted, but still applied for this visit.
    }
    update(preference, origin)
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useTheme = () => useSyncExternalStore(themeStore.subscribe, themeStore.get)
