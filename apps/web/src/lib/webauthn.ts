import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { i18n } from '@/i18n'

export { browserSupportsWebAuthn } from '@simplewebauthn/browser'

/** The user dismissed the browser's passkey prompt (or it timed out) — not worth an error message. */
export const passkeyCancelled = (err: unknown) =>
  err instanceof WebAuthnError
    ? err.code === 'ERROR_CEREMONY_ABORTED'
    : err instanceof DOMException && err.name === 'NotAllowedError'

/** Explains the failures a person can act on; the rest keep their own message. */
export function passkeyErrorMessage(err: unknown): string {
  if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return i18n.t('passkeys.alreadyRegistered')
  }
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return i18n.t('passkeys.dismissed')
  }
  return err instanceof Error ? err.message : i18n.t('common.unknownError')
}

// The server returns the options as opaque JSON; the browser library knows their shape.
export const createPasskey = (options: unknown) =>
  startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON })

export const getPasskey = (options: unknown) =>
  startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON })
