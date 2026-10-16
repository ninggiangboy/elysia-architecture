import { createTranslator } from '#/shared/i18n/translator'
import { en } from './en'
import { vi } from './vi'

/** `translate('vi')('mail.welcome.subject')` — keys are checked against the English catalog. */
export const translate = createTranslator(en, { vi })

export type Translator = ReturnType<typeof translate>
