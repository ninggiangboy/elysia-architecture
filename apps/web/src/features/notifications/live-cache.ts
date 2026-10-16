import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { type NotificationsPage, unreadCountQuery, unseenCountQuery } from './queries'

type List = InfiniteData<NotificationsPage, string | undefined>
type Item = NotificationsPage['items'][number]

const LIST_KEY = ['notifications', 'list']

const patchList = (queryClient: QueryClient, patch: (items: Item[]) => Item[]) =>
  queryClient.setQueriesData<List>(
    { queryKey: LIST_KEY },
    (list) =>
      list && { ...list, pages: list.pages.map((page) => ({ ...page, items: patch(page.items) })) },
  )

const refreshCounts = (queryClient: QueryClient) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: unseenCountQuery.queryKey }),
    queryClient.invalidateQueries({ queryKey: unreadCountQuery.queryKey }),
  ])

/**
 * `notification.created` carries the whole notification, so it goes straight into the cached list instead of
 * refetching it: a new one is added on top, a repeat folded into an existing one (same id) replaces it in place.
 * Only the two counts are refetched (a fold does not change them the way an insert does).
 */
export function applyCreated(queryClient: QueryClient, data: Record<string, unknown> | undefined) {
  if (!data || typeof data.id !== 'string') return refreshCounts(queryClient)
  const item = {
    id: data.id,
    kind: String(data.kind),
    title: String(data.title),
    body: String(data.body ?? ''),
    data: (data.data ?? {}) as Item['data'],
    read: false,
    readAt: null,
    count: typeof data.count === 'number' ? data.count : 1,
    createdAt: String(data.createdAt),
  } satisfies Item
  queryClient.setQueriesData<List>({ queryKey: LIST_KEY }, (list) => {
    if (!list) return list
    const exists = list.pages.some((p) => p.items.some((n) => n.id === item.id))
    if (exists)
      return {
        ...list,
        pages: list.pages.map((p) => ({
          ...p,
          items: p.items.map((n) => (n.id === item.id ? { ...n, ...item } : n)),
        })),
      }
    const [first, ...rest] = list.pages
    return first && { ...list, pages: [{ ...first, items: [item, ...first.items] }, ...rest] }
  })
  return refreshCounts(queryClient)
}

/** `notification.read`: `id` is the notification, or `null` for "all of them". */
export function applyRead(queryClient: QueryClient, data: Record<string, unknown> | undefined) {
  const id = typeof data?.id === 'string' ? data.id : null
  const readAt = typeof data?.readAt === 'string' ? data.readAt : new Date().toISOString()
  patchList(queryClient, (items) =>
    items.map((n) => (!n.read && (id === null || n.id === id) ? { ...n, read: true, readAt } : n)),
  )
  return refreshCounts(queryClient)
}

/** `notification.seen`: only the badge is affected. */
export const applySeen = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: unseenCountQuery.queryKey })
