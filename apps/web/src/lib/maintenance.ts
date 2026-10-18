import { apiOrigin, createOutageDetector } from '@kit/web-core'
import { useStore } from '@kit/web-core/react'

/** Whether the app is covered by the blocking dialog (a deploy is running, or the API cannot be reached). */
const outage = createOutageDetector({ healthUrl: () => `${apiOrigin()}/api/health/ready` })

export const maintenanceStore = outage.store
export const { watchResponse, watchNetworkFailure } = outage
export const useMaintenance = () => useStore(outage.store)
