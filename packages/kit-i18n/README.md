# @kit/i18n

## Purpose

Language-agnostic message handling shared by the API and the web app: `defineLocales`, the catalog format and its diff, a tiny translator (same `{{placeholders}}` and plural keys as i18next), catalog merging with overrides, and money and day formatting.

## Install

```bash
bun add @kit/i18n
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

No ports.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { defineLocales } from '@kit/i18n'

export const { LOCALES, DEFAULT_LOCALE, isLocale, negotiateLocale } = defineLocales(['en', 'vi'], {
  default: 'en',
  names: { en: 'English', vi: 'Tiếng Việt' },
})
```

## Guarantees

`diffCatalogs` reports missing keys and placeholders that differ; `mergeCatalogs` makes a duplicate key an error and `overrideCatalog` rejects a key that does not exist.

## Limits

Keys must not contain `_` (that is how plural forms are told apart).

## Related

[Store templates, not text](../../docs/patterns/store-templates-not-text-i18n.md)
