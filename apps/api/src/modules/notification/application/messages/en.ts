/**
 * What the notification module itself says, in the source language: the words around any mail. Everything a producer
 * says (`mail.<template>`, `inApp.<template>`) comes from its integration's catalog and is merged in `./index.ts`.
 * A new language is a sibling file with the same keys and `{{placeholders}}` (`messages.test.ts` checks it).
 * Keys must not contain `_` (that is how plural forms are told apart). Messages are plain text.
 */
export const en = {
  common: {
    minutes_one: '{{count}} minute',
    minutes_other: '{{count}} minutes',
    openLink: 'Or open the link:',
  },
} as const
