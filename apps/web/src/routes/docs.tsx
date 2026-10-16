import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { apiOrigin } from '@/lib/config'

/** Spec chỉ được API phục vụ khi NODE_ENV=development, nên trang này cũng chỉ có ở bản dev. */
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
        // Gọi thẳng API cùng origin (Vite proxy) nên không cần proxy của Scalar.
        hideClientButton: true,
        showDeveloperTools: 'never',
        telemetry: false,
        mcp: { disabled: true },
      }}
    />
  )
}
