import { ApiReferenceReact } from '@scalar/api-reference-react'
// Scalar's stylesheet styles `body` and `:root` globally, so it must only load together with this page.
import '@scalar/api-reference-react/style.css'
import { apiOrigin } from '@/lib/config'

export default function ApiReference() {
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
