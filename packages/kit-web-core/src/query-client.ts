import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api-error'

/** Queries stay fresh for 30 s; a 4xx is the request's fault, so only other failures are retried (twice). */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
