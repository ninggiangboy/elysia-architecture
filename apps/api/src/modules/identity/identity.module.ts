import type { Clock, IdGenerator } from '#/shared/application/ports'
import type { Config } from '#/shared/infrastructure/config'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import { IdentityApiImpl } from './application/queries/identity-api-impl'
import { SessionIssuer } from './application/session-issuer'
import { ConfirmEmailChange } from './application/use-cases/confirm-email-change'
import { Logout } from './application/use-cases/logout'
import {
  ListSessions,
  RevokeOtherSessions,
  RevokeSession,
} from './application/use-cases/manage-sessions'
import { RefreshSession } from './application/use-cases/refresh-session'
import { RequestEmailChange } from './application/use-cases/request-email-change'
import { RequestMagicLink } from './application/use-cases/request-magic-link'
import { VerifyMagicLink } from './application/use-cases/verify-magic-link'
import type { AccessTokenVerifier } from './contracts/access-token-verifier'
import type { IdentityApi } from './contracts/identity-api'
import { DrizzleMagicLinkThrottle } from './infrastructure/drizzle-magic-link-throttle'
import { JwtTokenService } from './infrastructure/jwt-token-service'
import {
  DrizzleEmailChangeRequestRepository,
  DrizzleMagicLinkRepository,
  DrizzleRefreshTokenRepository,
  DrizzleUserRepository,
} from './infrastructure/persistence/drizzle-repositories'
import { outbox } from './infrastructure/persistence/schema'
import { identityRoutes } from './presentation/routes'

export interface IdentityModuleDeps {
  database: Database
  config: Config
  clock: Clock
  ids: IdGenerator
}

export interface IdentityModule {
  name: 'identity'
  routes: ReturnType<typeof identityRoutes>
  api: IdentityApi
  verifier: AccessTokenVerifier
  outbox: OutboxSource
}

export async function createIdentityModule(deps: IdentityModuleDeps): Promise<IdentityModule> {
  const { database, config, clock, ids } = deps

  const tokenService = await JwtTokenService.create(
    {
      privateKeyPem: config.JWT_PRIVATE_KEY,
      publicKeyPem: config.JWT_PUBLIC_KEY,
      kid: config.JWT_KID,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      accessTtlSeconds: config.ACCESS_TOKEN_TTL,
    },
    ids,
  )

  const users = new DrizzleUserRepository(database)
  const magicLinks = new DrizzleMagicLinkRepository(database)
  const emailChanges = new DrizzleEmailChangeRequestRepository(database)
  const refreshTokens = new DrizzleRefreshTokenRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const throttle = new DrizzleMagicLinkThrottle(database, {
    perEmail: config.MAGIC_LINK_MAX_PER_EMAIL,
    perIp: config.MAGIC_LINK_MAX_PER_IP,
  })
  const sessions = new SessionIssuer(
    refreshTokens,
    tokenService,
    ids,
    clock,
    config.REFRESH_TOKEN_TTL,
  )

  const routes = identityRoutes({
    verifier: tokenService,
    jwks: () => tokenService.jwks,
    secureCookies: config.WEB_APP_URL.startsWith('https://'),
    useCases: {
      requestMagicLink: new RequestMagicLink(
        magicLinks,
        throttle,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      verifyMagicLink: new VerifyMagicLink(
        magicLinks,
        users,
        sessions,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      refreshSession: new RefreshSession(
        refreshTokens,
        users,
        sessions,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      logout: new Logout(refreshTokens, outboxWriter, database, clock),
      listSessions: new ListSessions(refreshTokens, clock),
      revokeSession: new RevokeSession(refreshTokens, outboxWriter, database, clock),
      revokeOtherSessions: new RevokeOtherSessions(refreshTokens, outboxWriter, database, clock),
      requestEmailChange: new RequestEmailChange(
        users,
        emailChanges,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      confirmEmailChange: new ConfirmEmailChange(
        users,
        emailChanges,
        tokenService,
        outboxWriter,
        database,
        clock,
      ),
    },
  })

  return {
    name: 'identity',
    routes,
    api: new IdentityApiImpl(users),
    verifier: tokenService,
    outbox: { name: 'identity', table: outbox },
  }
}
