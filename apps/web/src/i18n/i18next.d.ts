import type { Messages } from './messages'

// Typed keys: `t('profile.titel')` is a compile error, and so is a missing `{{placeholder}}` value's key.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Messages }
  }
}
