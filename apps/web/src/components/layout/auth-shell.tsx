import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Logo } from './logo'
import { ThemeToggle } from './theme-toggle'

/** Full-screen centred layout for the screens outside the app: sign-in, link callbacks, 404. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="bg-grid absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="absolute top-[-12rem] left-1/2 -z-10 h-[24rem] w-[44rem] max-w-[140vw] -translate-x-1/2 rounded-full bg-gradient-to-r from-primary/25 via-fuchsia-500/15 to-sky-400/20 blur-3xl"
      />
      <ThemeToggle className="absolute top-3 right-3 sm:top-4 sm:right-4" />
      <header className="flex justify-center px-4 pt-10 sm:pt-16">
        <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Logo className="size-8" />
          Elysia Architecture
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-10 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  )
}
