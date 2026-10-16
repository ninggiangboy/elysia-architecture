import { http, unwrap } from '@/lib/api'

export const sendTestEvent = async (message: string) =>
  unwrap(await http.api.realtime.test.post({ message }))
