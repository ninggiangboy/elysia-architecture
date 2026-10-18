import { StepUpPolicy } from '@kit/auth'
import type { Clock, IdGenerator } from '@kit/core'
import type { Database } from '@kit/db'
import type { IntegrationEventHandler, OutboxSource } from '@kit/messaging'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '@kit/messaging'
import { privacyParticipation } from '@kit/privacy-participant'
import type { AppModule } from '@kit/runtime'
import type { ObjectStorage } from '@kit/storage'
import { AccountRegistrar } from './application/account-registrar'
import { AuthPolicy } from './application/auth-policy'
import { IdentityDataExporter } from './application/identity-data-exporter'
import { PasskeyAssertions } from './application/passkey-assertions'
import type { OAuthGateway, PasswordHasher, WebAuthnService } from './application/ports'
import { IdentityApiImpl } from './application/queries/identity-api-impl'
import { SessionIssuer } from './application/session-issuer'
import { SessionRevocation } from './application/session-revocation'
import { SessionStarter } from './application/session-starter'
import { SignInCompleter } from './application/sign-in-completer'
import { SignInGuard } from './application/sign-in-guard'
import { SignInMethodGuard } from './application/sign-in-method-guard'
import { GetAuthOptions, GetSecuritySummary } from './application/use-cases/auth-options'
import { ChangeLocale } from './application/use-cases/change-locale'
import { ConfirmEmailChange } from './application/use-cases/confirm-email-change'
import {
  ListInvitations,
  RevokeInvitation,
  SendInvitation,
} from './application/use-cases/invitations'
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
import {
  LoginWithPassword,
  RemovePassword,
  RequestPasswordReset,
  ResetPassword,
  SetPassword,
} from './application/use-cases/password'
import { RefreshSession } from './application/use-cases/refresh-session'
import { RequestEmailChange } from './application/use-cases/request-email-change'
import { RequestMagicLink } from './application/use-cases/request-magic-link'
import { CompleteSignup, RegisterWithPassword, VerifySignup } from './application/use-cases/signup'
import {
  BeginStepUpPasskey,
  FinishStepUpPasskey,
  RequestStepUpCode,
  VerifyStepUpCode,
  VerifyStepUpPassword,
  VerifyStepUpTotp,
} from './application/use-cases/step-up'
import {
  BeginTwoFactorSetup,
  DisableTwoFactor,
  EnableTwoFactor,
  GetTwoFactorStatus,
  RegenerateRecoveryCodes,
  VerifyMfaLogin,
} from './application/use-cases/two-factor'
import { VerifyMagicLink } from './application/use-cases/verify-magic-link'
import type { IdentityConfig, SignInMethod } from './config'
import type { AccessTokenVerifier } from './contracts/access-token-verifier'
import { IdentityEvents } from './contracts/events'
import type { IdentityApi } from './contracts/identity-api'
import { RegistrationPolicy } from './domain/registration-policy'
import { DrizzleMagicLinkThrottle } from './infrastructure/drizzle-magic-link-throttle'
import { JwtTokenService } from './infrastructure/jwt-token-service'
import { ArcticOAuthGateway } from './infrastructure/oauth-gateway'
import { BunPasswordHasher } from './infrastructure/password-hasher'
import { DrizzleIdentityDataEraser } from './infrastructure/persistence/drizzle-data-eraser'
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
import {
  DrizzleInvitationRepository,
  DrizzleMfaChallengeRepository,
  DrizzlePasswordResetRepository,
  DrizzleRecoveryCodeRepository,
  DrizzleSignInFailureRepository,
  DrizzleSignupRepository,
  DrizzleTotpCredentialRepository,
} from './infrastructure/persistence/drizzle-sign-in-repositories'
import { inbox, outbox } from './infrastructure/persistence/schema'
import { SecretBox } from './infrastructure/secret-box'
import { SimpleWebAuthnService } from './infrastructure/simplewebauthn-service'
import { identityRoutes } from './presentation/routes'

export interface IdentityModuleDeps {
  database: Database
  config: IdentityConfig
  clock: Clock
  ids: IdGenerator
  /** Where the data export is written. */
  storage: ObjectStorage
  /** Replace the real WebAuthn / OAuth adapters (tests: a software authenticator, a fake provider). */
  webauthn?: WebAuthnService
  oauth?: OAuthGateway
  /** Replace argon2id (tests that sign in many times). */
  hasher?: PasswordHasher
}

export interface IdentityModule extends AppModule<'identity', ReturnType<typeof identityRoutes>> {
  routes: ReturnType<typeof identityRoutes>
  api: IdentityApi
  /** How recently someone must have signed in for a sensitive action; the same window every module that asks for it uses. */
  stepUp: StepUpPolicy
  verifier: AccessTokenVerifier
  /** Takes part in the privacy data export and account erasure. */
  handlers: IntegrationEventHandler[]
  outbox: OutboxSource
}

export async function createIdentityModule(deps: IdentityModuleDeps): Promise<IdentityModule> {
  const { database, config, clock, ids, storage } = deps

  const tokenService = await JwtTokenService.create(
    {
      privateKeyPem: config.JWT_PRIVATE_KEY,
      publicKeyPem: config.JWT_PUBLIC_KEY,
      kid: config.JWT_KID,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      accessTtlSeconds: config.ACCESS_TOKEN_TTL,
      hashSecret: config.STEP_UP_CODE_SECRET,
    },
    ids,
  )

  const webApp = new URL(config.WEB_APP_URL)
  const users = new DrizzleUserRepository(database)
  const magicLinks = new DrizzleMagicLinkRepository(database)
  const emailChanges = new DrizzleEmailChangeRequestRepository(database)
  const refreshTokens = new DrizzleRefreshTokenRepository(database)
  const outboxWriter = new DrizzleOutboxWriter(database, outbox, () => ids.next())
  const inboxGuard = new DrizzleInboxGuard(database, inbox)
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
  const signups = new DrizzleSignupRepository(database)
  const passwordResets = new DrizzlePasswordResetRepository(database)
  const signInFailures = new DrizzleSignInFailureRepository(database)
  const invitations = new DrizzleInvitationRepository(database)
  const mfaChallenges = new DrizzleMfaChallengeRepository(database)
  const recoveryCodes = new DrizzleRecoveryCodeRepository(database, () => ids.next())
  // Without TOTP_ENCRYPTION_KEY two-factor is off and nothing reads this box.
  const totp = new DrizzleTotpCredentialRepository(
    database,
    new SecretBox(config.TOTP_ENCRYPTION_KEY ?? 'two-factor-is-off'),
  )
  const hasher = deps.hasher ?? new BunPasswordHasher()
  const policy = new AuthPolicy(
    new Set<SignInMethod>(config.SIGN_IN_METHODS),
    new RegistrationPolicy(
      config.REGISTRATION_MODE,
      config.REGISTRATION_EMAIL_DOMAINS,
      config.TERMS_VERSION,
      config.REGISTRATION_ALLOWED_EMAILS,
    ),
    config.PASSWORD_MIN_LENGTH,
    config.TOTP_ENCRYPTION_KEY !== undefined,
    config.TERMS_URL,
  )
  const webauthn =
    deps.webauthn ??
    new SimpleWebAuthnService({
      rpId: config.WEBAUTHN_RP_ID ?? webApp.hostname,
      rpName: config.WEBAUTHN_RP_NAME,
      origins: config.WEBAUTHN_ORIGINS ?? [webApp.origin],
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
      microsoft:
        config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET
          ? {
              clientId: config.MICROSOFT_CLIENT_ID,
              clientSecret: config.MICROSOFT_CLIENT_SECRET,
              tenant: config.MICROSOFT_TENANT,
            }
          : undefined,
      discord:
        config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET
          ? { clientId: config.DISCORD_CLIENT_ID, clientSecret: config.DISCORD_CLIENT_SECRET }
          : undefined,
      oidc: config.OIDC_PROVIDERS,
    })
  const stepUp = new StepUpPolicy(clock, config.STEP_UP_TTL)
  const starter = new SessionStarter(sessions, outboxWriter, clock)
  const assertions = new PasskeyAssertions(challenges, passkeys, webauthn, clock)
  const completer = new SignInCompleter(
    starter,
    totp,
    mfaChallenges,
    tokenService,
    policy,
    ids,
    clock,
  )
  const registrar = new AccountRegistrar(
    users,
    oauthAccounts,
    invitations,
    signups,
    starter,
    policy,
    tokenService,
    outboxWriter,
    ids,
    clock,
  )
  const guard = new SignInGuard(signInFailures, ids, clock)
  const methods = new SignInMethodGuard(users, passkeys, oauthAccounts, policy)
  const revocation = new SessionRevocation(refreshTokens, outboxWriter, clock)
  const totpIssuer = config.TOTP_ISSUER ?? config.WEBAUTHN_RP_NAME
  const twoFactorStatus = new GetTwoFactorStatus(totp, recoveryCodes, policy)

  const routes = identityRoutes({
    verifier: tokenService,
    jwks: () => tokenService.jwks,
    secureCookies: config.WEB_APP_URL.startsWith('https://'),
    useCases: {
      getAuthOptions: new GetAuthOptions(policy, oauth),
      getSecuritySummary: new GetSecuritySummary(users, twoFactorStatus, policy),
      requestMagicLink: new RequestMagicLink(
        magicLinks,
        users,
        invitations,
        throttle,
        tokenService,
        policy,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      verifyMagicLink: new VerifyMagicLink(
        magicLinks,
        users,
        completer,
        registrar,
        guard,
        tokenService,
        database,
        clock,
      ),
      loginWithPassword: new LoginWithPassword(users, hasher, guard, completer, policy, database),
      registerWithPassword: new RegisterWithPassword(
        users,
        signups,
        registrar,
        hasher,
        tokenService,
        policy,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      verifySignup: new VerifySignup(signups, registrar, guard, tokenService, database, clock),
      completeSignup: new CompleteSignup(signups, registrar, tokenService, database, clock),
      requestPasswordReset: new RequestPasswordReset(
        users,
        passwordResets,
        tokenService,
        policy,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      resetPassword: new ResetPassword(
        users,
        passwordResets,
        hasher,
        tokenService,
        revocation,
        policy,
        outboxWriter,
        database,
        clock,
      ),
      setPassword: new SetPassword(
        users,
        hasher,
        revocation,
        policy,
        stepUp,
        outboxWriter,
        database,
        clock,
      ),
      removePassword: new RemovePassword(users, methods, stepUp, outboxWriter, database, clock),
      getTwoFactorStatus: twoFactorStatus,
      beginTwoFactorSetup: new BeginTwoFactorSetup(users, totp, policy, stepUp, totpIssuer, clock),
      enableTwoFactor: new EnableTwoFactor(
        totp,
        recoveryCodes,
        tokenService,
        policy,
        outboxWriter,
        database,
        clock,
      ),
      regenerateRecoveryCodes: new RegenerateRecoveryCodes(
        totp,
        recoveryCodes,
        tokenService,
        policy,
        stepUp,
        database,
        clock,
      ),
      disableTwoFactor: new DisableTwoFactor(
        totp,
        recoveryCodes,
        stepUp,
        outboxWriter,
        database,
        clock,
      ),
      verifyMfaLogin: new VerifyMfaLogin(
        mfaChallenges,
        totp,
        recoveryCodes,
        users,
        starter,
        guard,
        tokenService,
        database,
        clock,
      ),
      sendInvitation: new SendInvitation(
        users,
        invitations,
        policy,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      listInvitations: new ListInvitations(invitations, clock),
      revokeInvitation: new RevokeInvitation(invitations, clock),
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
      changeLocale: new ChangeLocale(users, clock),
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
        completer,
        registrar,
        tokenService,
        outboxWriter,
        database,
        ids,
        clock,
      ),
      listOAuthAccounts: new ListOAuthAccounts(oauthAccounts),
      unlinkOAuthAccount: new UnlinkOAuthAccount(
        oauthAccounts,
        methods,
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
      removePasskey: new RemovePasskey(passkeys, methods, stepUp, outboxWriter, database, clock),
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
      verifyStepUpTotp: new VerifyStepUpTotp(users, totp, guard, tokenService, clock),
      verifyStepUpPassword: new VerifyStepUpPassword(users, hasher, guard, tokenService, clock),
    },
  })

  const participation = privacyParticipation({
    module: 'identity',
    storage,
    outbox: outboxWriter,
    inbox: inboxGuard,
    clock,
    export: {
      exporter: new IdentityDataExporter(
        users,
        passkeys,
        oauthAccounts,
        refreshTokens,
        totp,
        recoveryCodes,
        clock,
        policy.twoFactor,
      ),
      answerType: IdentityEvents.DataExported,
    },
    erase: {
      eraser: new DrizzleIdentityDataEraser(database),
      answerType: IdentityEvents.UserDataErased,
    },
  })

  return {
    name: 'identity',
    docs: [
      {
        name: 'auth',
        description:
          'Sign-in and sign-up (email link or code, password, passkey, OAuth/OIDC providers), two-factor, sessions and JWKS',
      },
      {
        name: 'account',
        description:
          "Operations on the current user's account. Sensitive ones answer `403 step_up_required` until the user confirms again (`/account/step-up/*`).",
      },
    ],
    routes,
    api: new IdentityApiImpl(users),
    stepUp,
    verifier: tokenService,
    handlers: participation.handlers,
    privacy: participation.privacy,
    outbox: { name: 'identity', table: outbox },
  }
}
