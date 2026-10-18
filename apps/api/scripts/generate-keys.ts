// Generates the dev keys (JWT ES256 pair + Web Push VAPID pair + step-up code secret + TOTP encryption key) and writes them to the monorepo root .env.

import { randomBytes } from 'node:crypto'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
import webpush from 'web-push'

const envPath = new URL('../../../.env', import.meta.url).pathname
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n')

const vapid = webpush.generateVAPIDKeys()

const entries: Record<string, string> = {
  JWT_PRIVATE_KEY: oneLine(await exportPKCS8(privateKey)),
  JWT_PUBLIC_KEY: oneLine(await exportSPKI(publicKey)),
}
// A VAPID pair is the Web Push identity of the deployment: regenerating it invalidates every browser subscription.
// Keep an existing pair, so re-running this script never silently unsubscribes everyone.
const existing = (await Bun.file(envPath).exists()) ? await Bun.file(envPath).text() : ''
if (!/^VAPID_PRIVATE_KEY=.+$/m.test(existing)) {
  entries.VAPID_PUBLIC_KEY = vapid.publicKey
  entries.VAPID_PRIVATE_KEY = vapid.privateKey
  entries.VAPID_SUBJECT = 'mailto:dev@example.test'
}

// The secret behind the hashed step-up codes: keep an existing one (changing it voids the codes in flight).
if (!/^STEP_UP_CODE_SECRET=.+$/m.test(existing))
  entries.STEP_UP_CODE_SECRET = randomBytes(32).toString('hex')

// The key behind the stored authenticator secrets: keep an existing one (changing it locks enrolled accounts out).
if (!/^TOTP_ENCRYPTION_KEY=.+$/m.test(existing))
  entries.TOTP_ENCRYPTION_KEY = randomBytes(32).toString('hex')

let content = (await Bun.file(envPath).exists()) ? await Bun.file(envPath).text() : ''
for (const [key, value] of Object.entries(entries)) {
  const line = `${key}="${value}"`
  const re = new RegExp(`^${key}=.*$`, 'm')
  content = re.test(content) ? content.replace(re, () => line) : `${content.trimEnd()}\n${line}\n`
}
await Bun.write(envPath, content)
console.log(`Keys written to ${envPath}`)
