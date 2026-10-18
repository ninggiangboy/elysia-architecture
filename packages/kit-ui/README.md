# @kit/ui

## Purpose

The design tokens (light and dark), the Tailwind theme and the small component set of the web app: Avatar, Badge, Button, Card, Dialog, Dropdown, Input, Label, Popover, Skeleton and `cn`.

## Install

```bash
bun add @kit/ui
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

No ports. React, Radix, Tailwind and lucide are peer dependencies.

## Configuration

<!-- config:start -->
None: this package reads no environment variables.
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
/* src/index.css */
@import "tailwindcss";
@import "@kit/ui/styles.css";
@source "../../../packages/kit-ui/src"; /* Tailwind only scans your own folder: without this the package's classes are purged */

import { Button, Card } from '@kit/ui'
```

## Guarantees

Components take their text as props: nothing here knows about a translation library.

## Limits

Tailwind v4 only.

## Related

—
