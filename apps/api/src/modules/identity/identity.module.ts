import type { Clock, IdGenerator } from '#/shared/application/ports'
import type { Config } from '#/shared/infrastructure/config'
import type { Database } from '#/shared/infrastructure/db/database'
import { DrizzleOutboxWriter } from '#/shared/infrastructure/outbox/drizzle-outbox-writer'
import type { OutboxSource } from '#/shared/infrastructure/outbox/outbox-relay'
import { PasskeyAssertions } from './application/passkey-assertions'
import type { OAuthGateway, WebAuthnService } from './application/ports'
import { IdentityApiImpl } from './application/queries/identity-api-impl'
import { SessionIssuer } from './application/session-issuer'
import { SessionStarter } from './application/session-starter'
import { StepUpPolicy } from './application/step-up-policy'
import { ConfirmEmailChange } from './application/use-cases/confirm-email-change'
import { Logout } from './application/use-cases/logout'
import { ListPasskeys, RemovePasskey } from './application/use-cases/manage-passkeys'
import {
  ListSessions,
  RevokeOtherSessions,
  RevokeSession,
} from './application/use-cases/manage-sessions'
import {
  BeginOAuth,
  CompleteOAuth,
  ListOAuthAccounts,
  ListOAuthProviders,
  UnlinkOAuthAccount,
} from './application/use-cases/oauth'
import { BeginPasskeyLogin, FinishPasskeyLogin } from './application/use-cases/passkey-login'
import {
  BeginPasskeyRegistration,
  FinishPasskeyRegistration,
} from './application/use-cases/passkey-registration'
import { RefreshSession } from './application/use-cases/refresh-session'
import { RequestEmailChange } from './application/use-cases/request-email-change'
import { RequestMagicLink } from './application/use-cases/request-magic-link'
import {
  BeginStepUpPasskey,
  FinishStepUpPasskey,
  RequestStepUpCode,
  VerifyStepUpCode,
} from './application/use-cases/step-up'
import { VerifyMagicLink } from './application/use-cases/verify-magic-link'
import type { AccessTokenVerifier } from './contracts/access-token-verifier'
import type { IdentityApi } from './contracts/identity-api'
import { DrizzleMagicLinkThrottle } from './infrastructure/drizzle-magic-link-throttle'
import { JwtTokenService } from './infrastructure/jwt-token-service'
import { ArcticOAuthGateway } from './infrastructure/oauth-gateway'
import {
  DrizzleEmailChangeRequestRepository,
  DrizzleMagicLinkRepository,
  DrizzleRefreshTokenRepository,
  DrizzleUserRepository,
} from './infrastructure/persistence/drizzle-repositories'
import {
  DrizzleOAuthAccountRepository,
  DrizzleOAuthStateRepository,
  DrizzlePasskeyRepository,
  DrizzleStepUpCodeRepository,
  DrizzleWebAuthnChallengeRepository,
} from './infrastructure/persistence/drizzle-security-repositories'
import { outbox } from './infrastructure/persistence/schema'
import { SimpleWebAuthnService } from './infrastructure/simplewebauthn-service'
import { identityRoutes } from './presentation/routes'

export interface IdentityModuleDeps {
  database: Database
  config: Config
  clock: Clock
  ids: IdGenerator
  /** Replace the real WebAuthn / OAuth adapters (tests: a software authenticator, a fake provider). */
  webauthn?: WebAuthnService
  oauth?: OAuthGateway
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
  const passkeys = new DrizzlePasskeyRepository(database)
  const challenges = new DrizzleWebAuthnChallengeRepository(database)
  const oauthAccounts = new DrizzleOAuthAccountRepository(database)
  const oauthStates = new DrizzleOAuthStateRepository(database)
  const stepUpCodes = new DrizzleStepUpCodeRepository(database)
  const webauthn =
    deps.webauthn ??
    new SimpleWebAuthnService({
      rpId: config.WEBAUTHN_RP_ID,
      rpName: config.WEBAUTHN_RP_NAME,
      origins: config.WEBAUTHN_ORIGINS,
    })
  const oauth =
    deps.oauth ??
    new ArcticOAuthGateway({
      redirectUri: `${config.WEB_APP_URL.replace(/\/$/, '')}/auth/oauth/callback`,
      google:
        config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
          ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET }
          : undefined,
      github:
        config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET
          ? { clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET }
          : undefined,
    })
  const stepUp = new StepUpPolicy(clock, config.STEP_UP_TTL)
  const starter = new SessionStarter(sessions, outboxWriter, clock)
  const assertions = new PasskeyAssertions(challenges, passkeys, webauthn, clock)

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
        stepUp,
      ),
      confirmEmailChange: new ConfirmEmailChange(
        users,
        emailChanges,
        tokenService,
        outboxWriter,
        database,
        clock,
      ),
      listOAuthProviders: new ListOAuthProviders(oauth),
      beginOAuth: new BeginOAuth(oauth, oauthStates, tokenService, stepUp, ids, clock),
      completeOAuth: new CompleteOAuth(
        oauth,
        oauthStates,
        oauthAccounts,
        users,
        starter,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      listOAuthAccounts: new ListOAuthAccounts(oauthAccounts),
      unlinkOAuthAccount: new UnlinkOAuthAccount(
        oauthAccounts,
        stepUp,
        outboxWriter,
        database,
        clock,
      ),
      beginPasskeyLogin: new BeginPasskeyLogin(challenges, webauthn, ids, clock),
      finishPasskeyLogin: new FinishPasskeyLogin(assertions, users, starter, database),
      beginPasskeyRegistration: new BeginPasskeyRegistration(
        users,
        passkeys,
        challenges,
        webauthn,
        stepUp,
        ids,
        clock,
      ),
      finishPasskeyRegistration: new FinishPasskeyRegistration(
        passkeys,
        challenges,
        webauthn,
        stepUp,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      listPasskeys: new ListPasskeys(passkeys),
      removePasskey: new RemovePasskey(passkeys, stepUp, outboxWriter, database, clock),
      requestStepUpCode: new RequestStepUpCode(
        users,
        stepUpCodes,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      verifyStepUpCode: new VerifyStepUpCode(stepUpCodes, tokenService, clock),
      beginStepUpPasskey: new BeginStepUpPasskey(passkeys, challenges, webauthn, ids, clock),
      finishStepUpPasskey: new FinishStepUpPasskey(assertions, tokenService, clock),
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
