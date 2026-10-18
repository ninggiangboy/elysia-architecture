// Generates the signing keys and secrets into .env: JWT ES256 pair, the step-up code secret, the local storage secret.
// Existing values are kept, so running it twice never signs everybody out.
import { randomBytes } from 'node:crypto'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'

const envPath = new URL('../.env', import.meta.url).pathname
const existing = (await Bun.file(envPath).exists()) ? await Bun.file(envPath).text() : ''
const has = (key: string) => new RegExp(`^${key}=.+$`, 'm').test(existing)
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n')

const entries: Record<string, string> = {}
if (!has('JWT_PRIVATE_KEY') || !has('JWT_PUBLIC_KEY')) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  entries.JWT_PRIVATE_KEY = oneLine(await exportPKCS8(privateKey))
  entries.JWT_PUBLIC_KEY = oneLine(await exportSPKI(publicKey))
}
if (!has('STEP_UP_CODE_SECRET')) entries.STEP_UP_CODE_SECRET = randomBytes(32).toString('hex')
if (!has('STORAGE_LOCAL_SECRET')) entries.STORAGE_LOCAL_SECRET = randomBytes(32).toString('hex')

let content = existing
for (const [key, value] of Object.entries(entries)) {
  const line = `${key}="${value}"`
  const re = new RegExp(`^${key}=.*$`, 'm')
  content = re.test(content) ? content.replace(re, () => line) : `${content.trimEnd()}\n${line}\n`
}
await Bun.write(envPath, content)
console.log(`Keys written to ${envPath}`)
