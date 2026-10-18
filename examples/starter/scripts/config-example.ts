// Writes (or with --check, verifies) .env.example from the config slices.
import { renderEnvExample } from '@kit/config'
import { CONFIG_SLICES, ENV_EXAMPLE } from '../src/bootstrap/config'

const path = new URL('../.env.example', import.meta.url).pathname
const expected = renderEnvExample(CONFIG_SLICES, {
  set: ENV_EXAMPLE,
  command: 'bun run config:example',
})

if (process.argv.includes('--check')) {
  if ((await Bun.file(path).text()) !== expected) {
    console.error('.env.example is out of date: run `bun run config:example`')
    process.exit(1)
  }
} else {
  await Bun.write(path, expected)
  console.log(`Wrote ${path}`)
}
