// Per-module migration management:  bun scripts/db.ts generate | migrate
import { runDbCli } from '@kit/runtime'
import { MODULE_CATALOG } from '../src/bootstrap/module-catalog'

await runDbCli(MODULE_CATALOG)
