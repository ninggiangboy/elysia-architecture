import type { Locale } from '@app/shared-types/locales'
import { mergeCatalogs } from '@kit/i18n'
import { FEATURES } from '@/features'
import { en as coreEn } from './locales/en'
import { vi as coreVi } from './locales/vi'

const core = { en: coreEn, vi: coreVi }
/** The shell's messages plus the branches every feature owns. */
export const catalog = (locale: Locale) =>
  mergeCatalogs(core[locale], ...FEATURES.map((feature) => feature.i18n[locale]))
