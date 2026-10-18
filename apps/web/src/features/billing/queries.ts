import type { DocumentKind } from '@app/shared-types/billing'
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

const fetchDocuments = async (kind: DocumentKind | undefined, before?: string) =>
  unwrap(await http.api.billing.documents.get({ query: { kind, before } }))

type DocumentsPage = Awaited<ReturnType<typeof fetchDocuments>>
export type BillingDocument = DocumentsPage['items'][number]

/** Invoices, receipts and credit notes, newest first; `kind` narrows it to one of them. */
export const documentsQuery = (kind?: DocumentKind) =>
  infiniteQueryOptions({
    queryKey: ['billing', 'documents', kind ?? 'all'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchDocuments(kind, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: ['billing', 'document', id],
    queryFn: async () => unwrap(await http.api.billing.documents({ id }).get()),
  })

/** The receipt of a top-up, once it is paid; `null` until then. */
export const receiptOfTopUpQuery = (topUpId: string) =>
  queryOptions({
    queryKey: ['billing', 'receipt-of', topUpId],
    queryFn: async () =>
      unwrap(
        await http.api.billing.documents.get({
          query: { topUpId, kind: 'receipt', limit: 1 },
        }),
      ).items[0] ?? null,
  })

export const topUpQuery = (id: string) =>
  queryOptions({
    queryKey: ['billing', 'topup', id],
    queryFn: async () => unwrap(await http.api.billing.topups({ id }).get()),
  })

/**
 * `idempotencyKey` stands for one intention to pay: sending the request again with it (a double click, a retry after a
 * timeout) returns the same top-up instead of opening a second payment.
 */
export const createTopUp = async (input: {
  currency: string
  amount: number
  idempotencyKey: string
  /** Who the invoice is made out to, when not the account holder. */
  billing?: { name?: string; taxId?: string; address?: string }
}) => {
  const { idempotencyKey, ...body } = input
  return unwrap(
    await http.api.billing.topups.post(body, { headers: { 'idempotency-key': idempotencyKey } }),
  )
}
