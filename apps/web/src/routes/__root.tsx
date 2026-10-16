import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import { AuthShell } from '@/components/layout/auth-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useTheme } from '@/lib/theme'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: NotFound,
})

function RootLayout() {
  const { resolved } = useTheme()
  return (
    <>
      <Outlet />
      <Toaster
        theme={resolved}
        position="bottom-right"
        // Above the tab bar on phones.
        mobileOffset={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))', left: 16, right: 16 }}
        richColors
        toastOptions={{ className: 'font-sans' }}
      />
    </>
  )
}

function NotFound() {
  const { t } = useTranslation()
  return (
    <AuthShell>
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="bg-gradient-to-br from-primary to-fuchsia-500 bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          404
        </p>
        <h1 className="text-lg font-semibold tracking-tight">{t('notFound.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('notFound.text')}</p>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">
            <ArrowLeft aria-hidden /> {t('common.backToHome')}
          </Link>
        </Button>
      </Card>
    </AuthShell>
  )
}
