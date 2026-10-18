import type { Clock } from '@kit/core'
import type { DataExporter, ExportedPart } from '@kit/privacy-participant'
import type {
  OAuthAccountRepository,
  PasskeyRepository,
  RecoveryCodeRepository,
  RefreshTokenRepository,
  TotpCredentialRepository,
  UserRepository,
} from '../domain/repositories'

/**
 * What identity holds about a user, for a data export. Secrets are left out on purpose — passkey public keys, token
 * hashes — they are not "data about the person", and a leaked archive must not become a way in.
 */
export class IdentityDataExporter implements DataExporter {
  constructor(
    private users: UserRepository,
    private passkeys: PasskeyRepository,
    private oauthAccounts: OAuthAccountRepository,
    private refreshTokens: RefreshTokenRepository,
    private totp: TotpCredentialRepository,
    private recoveryCodes: RecoveryCodeRepository,
    private clock: Clock,
    /** Whether authenticator apps are on: the stored secret cannot be read without the key. */
    private twoFactor: boolean,
  ) {}

  async collect(userId: string): Promise<ExportedPart> {
    const user = await this.users.findById(userId)
    const [passkeys, connected, devices, authenticator, recoveryCodesLeft] = await Promise.all([
      this.passkeys.listByUser(userId),
      this.oauthAccounts.listByUser(userId),
      this.refreshTokens.listActiveSessions(userId, this.clock.now()),
      this.twoFactor ? this.totp.find(userId) : null,
      this.twoFactor ? this.recoveryCodes.remaining(userId) : 0,
    ])
    return {
      data: {
        account: user && {
          id: user.id,
          email: user.email.value,
          createdAt: user.createdAt.toISOString(),
          hasPassword: user.hasPassword,
          passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
          termsVersion: user.termsVersion,
          termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
        },
        twoFactor: {
          authenticatorApp: authenticator?.confirmed ?? false,
          recoveryCodesLeft,
        },
        passkeys: passkeys.map((p) => ({
          name: p.name,
          deviceType: p.deviceType,
          backedUp: p.backedUp,
          createdAt: p.createdAt.toISOString(),
          lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
        })),
        connectedAccounts: connected.map((a) => ({
          provider: a.provider,
          email: a.email,
          connectedAt: a.createdAt.toISOString(),
        })),
        signedInDevices: devices.map((d) => ({
          userAgent: d.userAgent,
          ip: d.ip,
          signedInAt: d.startedAt.toISOString(),
          lastActiveAt: d.lastActiveAt.toISOString(),
        })),
      },
    }
  }
}
