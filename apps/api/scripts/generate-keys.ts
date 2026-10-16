// Generates an ES256 key pair for dev and writes it to the monorepo root .env.
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'

const envPath = new URL('../../../.env', import.meta.url).pathname
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
const oneLine = (pem: string) => pem.trim().replace(/\n/g, '\\n')

const entries = {
  JWT_PRIVATE_KEY: oneLine(await exportPKCS8(privateKey)),
  JWT_PUBLIC_KEY: oneLine(await exportSPKI(publicKey)),
}

let content = (await Bun.file(envPath).exists()) ? await Bun.file(envPath).text() : ''
for (const [key, value] of Object.entries(entries)) {
  const line = `${key}="${value}"`
  const re = new RegExp(`^${key}=.*$`, 'm')
  content = re.test(content) ? content.replace(re, () => line) : `${content.trimEnd()}\n${line}\n`
}
await Bun.write(envPath, content)
console.log(`JWT keys written to ${envPath}`)
