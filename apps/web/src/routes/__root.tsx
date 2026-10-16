import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Toaster } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster
        theme="system"
        position="bottom-right"
        richColors
        toastOptions={{ className: 'font-sans' }}
      />
    </>
  ),
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <AuthShell>
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="bg-gradient-to-br from-primary to-fuchsia-500 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          404
        </p>
        <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you are looking for does not exist or has moved.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">
            <ArrowLeft aria-hidden /> Back to home
          </Link>
        </Button>
      </Card>
    </AuthShell>
  )
}
