import type { Catalog } from '@kit/i18n'

/** Vietnamese has no plural forms, so one `_other` per plural key is all it needs. */
export const vi = {
  common: {
    minutes_other: '{{count}} phút',
    openLink: 'Hoặc mở liên kết:',
  },
} as const satisfies Catalog
