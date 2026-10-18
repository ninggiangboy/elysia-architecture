// Writes (or with --check, verifies) the monorepo's .env.example from the config slices.
import { CONFIG_SLICES } from '#/bootstrap/config'
import { renderEnvExample } from '#/shared/config'

const path = new URL('../../../.env.example', import.meta.url).pathname
const expected = renderEnvExample(CONFIG_SLICES)

if (process.argv.includes('--check')) {
  if ((await Bun.file(path).text()) !== expected) {
    console.error('.env.example is out of date: run `bun run --filter @app/api config:example`')
    process.exit(1)
  }
} else {
  await Bun.write(path, expected)
  console.log(`Wrote ${path}`)
}
