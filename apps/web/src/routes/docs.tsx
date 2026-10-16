import { createFileRoute, notFound } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'

const ApiReference = lazy(() => import('@/features/docs/api-reference'))

/** The spec is served by the API only when NODE_ENV=development, so this page exists only in dev builds. */
export const Route = createFileRoute('/docs')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: () => (
    <Suspense>
      <ApiReference />
    </Suspense>
  ),
})
