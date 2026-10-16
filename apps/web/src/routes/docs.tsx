import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { apiOrigin } from '@/lib/config'

/** The spec is served by the API only when NODE_ENV=development, so this page exists only in dev builds. */
export const Route = createFileRoute('/docs')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: DocsPage,
})

function DocsPage() {
  return (
    <ApiReferenceReact
      configuration={{
        url: `${apiOrigin()}/api/openapi/json`,
        // Call the same-origin API directly (Vite proxy), so Scalar's proxy is not needed.
        hideClientButton: true,
        showDeveloperTools: 'never',
        telemetry: false,
        mcp: { disabled: true },
      }}
    />
  )
}
