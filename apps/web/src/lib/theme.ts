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

/** Share of the mask's radius that is fully opaque; the rest is the soft edge of the reveal. */
const SOLID = 0.55
const REVEAL_MS = 650
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** Swaps the theme with a soft-edged, blurred circle growing from `origin` where the browser supports view transitions; otherwise it just swaps. */
function applyAnimated(theme: ResolvedTheme, origin: ThemeOrigin) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply(theme)
    return
  }
  const { x, y } = origin
  // The mask must be big enough that its opaque core reaches the farthest corner of the viewport.
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const size = (2 * reach) / SOLID
  const mask = `radial-gradient(circle closest-side, #000 ${SOLID * 100}%, transparent 100%)`
  const transition = document.startViewTransition(() => apply(theme))
  transition.ready
    .then(() => {
      const root = document.documentElement
      root.animate(
        {
          maskImage: [mask, mask],
          maskRepeat: ['no-repeat', 'no-repeat'],
          maskSize: ['0px 0px', `${size}px ${size}px`],
          maskPosition: [`${x}px ${y}px`, `${x - size / 2}px ${y - size / 2}px`],
          filter: ['blur(14px)', 'blur(0px)'],
        },
        { duration: REVEAL_MS, easing: EASING, pseudoElement: '::view-transition-new(root)' },
      )
      // The old theme softens as it is covered, so the two blur into each other.
      root.animate(
        { filter: ['blur(0px)', 'blur(8px)'] },
        { duration: REVEAL_MS, easing: EASING, pseudoElement: '::view-transition-old(root)' },
      )
    })
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
