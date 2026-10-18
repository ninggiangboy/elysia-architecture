import { useSyncExternalStore } from 'react'
import type { Store } from './store'

/** Subscribes a component to a store. */
export const useStore = <T>(store: Pick<Store<T>, 'get' | 'subscribe'>): T =>
  useSyncExternalStore(store.subscribe, store.get)
