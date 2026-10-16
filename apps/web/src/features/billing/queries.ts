import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { http, unwrap } from '@/lib/api'

const fetchConfig = async () => unwrap(await http.api.billing.config.get())

// Rarely changes (it is the server's configuration): fetched once per visit.
export const billingConfigQuery = queryOptions({
  queryKey: ['billing', 'config'],
  queryFn: fetchConfig,
  staleTime: 5 * 60_000,
})

export const walletQuery = queryOptions({
  queryKey: ['billing', 'wallet'],
  queryFn: async () => unwrap(await http.api.billing.wallet.get()).balances,
})

const fetchTransactions = async (before?: string) =>
  unwrap(await http.api.billing.transactions.get({ query: { before } }))

type TransactionsPage = Awaited<ReturnType<typeof fetchTransactions>>
export type Transaction = TransactionsPage['items'][number]

export const transactionsQuery = infiniteQueryOptions({
  queryKey: ['billing', 'transactions'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }) => fetchTransactions(pageParam),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
})

export const topUpQuery = (id: string) =>
  queryOptions({
    queryKey: ['billing', 'topup', id],
    queryFn: async () => unwrap(await http.api.billing.topups({ id }).get()),
  })

export const createTopUp = async (input: { currency: string; amount: number }) =>
  unwrap(await http.api.billing.topups.post(input))
