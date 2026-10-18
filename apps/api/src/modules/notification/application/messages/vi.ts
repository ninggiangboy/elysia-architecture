import type { Catalog } from '@app/shared-types'

/** Vietnamese has no plural forms, so one `_other` per plural key is all it needs. */
export const vi = {
  common: {
    minutes_other: '{{count}} phút',
    openLink: 'Hoặc mở liên kết:',
  },
} as const satisfies Catalog
