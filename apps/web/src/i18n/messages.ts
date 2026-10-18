import type { FEATURES } from '@/features'
import type { en as coreEn } from './locales/en'

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never

/** Every message of the app as a type: the shell's own plus each feature's branches, so `t('billing.title')` is checked. */
export type Messages = typeof coreEn &
  UnionToIntersection<
    (typeof FEATURES)[number] extends infer F
      ? F extends { i18n: { en: infer E } }
        ? E
        : never
      : never
  >
