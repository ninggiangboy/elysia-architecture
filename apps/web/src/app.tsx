import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { MaintenanceDialog } from '@/components/layout/maintenance-dialog'
import { queryClient } from '@/lib/query-client'
import { router } from './router'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <MaintenanceDialog />
    </QueryClientProvider>
  )
}
