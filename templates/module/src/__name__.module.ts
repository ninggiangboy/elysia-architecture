import type { TokenVerifier } from '@kit/auth'
import type { Clock, IdGenerator } from '@kit/core'
import type { Database } from '@kit/db'
import type { IntegrationEventHandler, OutboxSource } from '@kit/messaging'
import type { AppModule } from '@kit/runtime'
import { Ping } from './application/use-cases/ping'
import type { __Name__Config } from './config'
import { outbox } from './infrastructure/persistence/schema'
import { __name__Routes } from './presentation/routes'

export interface __Name__ModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  verifier: TokenVerifier
  config: __Name__Config
}

export interface __Name__Module extends AppModule<'__name__', ReturnType<typeof __name__Routes>> {
  routes: ReturnType<typeof __name__Routes>
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
}

export function create__Name__Module(deps: __Name__ModuleDeps): __Name__Module {
  return {
    name: '__name__',
    docs: [{ name: '__name__', description: 'The __name__ module.' }],
    routes: __name__Routes({
      verifier: deps.verifier,
      useCases: { ping: new Ping(deps.clock, deps.config.__NAME___REPLY) },
    }),
    handlers: [],
    outbox: { name: '__name__', table: outbox },
  }
}
