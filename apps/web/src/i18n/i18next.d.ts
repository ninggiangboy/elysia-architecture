import type { en } from './locales/en'

// Typed keys: `t('profile.titel')` is a compile error, and so is a missing `{{placeholder}}` value's key.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
