import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { http, unwrap } from '@/lib/api'

export const unreadCountQuery = queryOptions({
  queryKey: ['notifications', 'unread-count'],
  queryFn: async () => unwrap(await http.api.notifications['unread-count'].get()).count,
})

/** The badge: news since the list was last opened. Not the same as unread — those stay unread until read. */
export const unseenCountQuery = queryOptions({
  queryKey: ['notifications', 'unseen-count'],
  queryFn: async () => unwrap(await http.api.notifications['unseen-count'].get()).count,
})

export const markNotificationsSeen = async () => unwrap(await http.api.notifications.seen.post())

const fetchNotifications = async (before?: string) =>
  unwrap(await http.api.notifications.get({ query: { before } }))

export type NotificationsPage = Awaited<ReturnType<typeof fetchNotifications>>

export const notificationsQuery = infiniteQueryOptions({
  queryKey: ['notifications', 'list'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }) => fetchNotifications(pageParam),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
})

export const markNotificationRead = async (id: string) =>
  unwrap(await http.api.notifications({ id }).read.post())

export const markAllNotificationsRead = async () =>
  unwrap(await http.api.notifications['read-all'].post())
