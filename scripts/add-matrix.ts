/**
 * Proves that modules can be added to and removed from an app in any order (kit plan T1, T4, T6): starting from the starter, add
 * notification, realtime, billing and privacy one at a time, then the same in reverse, removing each in turn; after every step
 * typecheck, migrate and run the starter's e2e. At the end the starter must be byte for byte what it was. Then generate a new
 * module, check it works out of the box, and take it out again.
 *
 *   bun scripts/add-matrix.ts [--quick]     (--quick: add and remove once, no reverse order, no generated module)
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const ROOT = join(import.meta.dir, '..')
const APP = '@example/starter'
const quick = process.argv.includes('--quick')

async function run(cmd: string[], label = cmd.join(' ')) {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if ((await proc.exited) !== 0) {
    console.error(`\n✗ ${label}\n${out}${err}`)
    process.exit(1)
  }
  return out
}

async function check(step: string) {
  const started = Date.now()
  await run(['bun', 'run', '--filter', APP, 'typecheck'], `${step}: typecheck`)
  await run(['bun', 'run', '--filter', APP, 'db:migrate'], `${step}: db:migrate`)
  await run(['bun', 'run', '--filter', APP, 'test:e2e'], `${step}: starter e2e`)
  console.log(`  ✓ ${step} (${((Date.now() - started) / 1000).toFixed(0)}s)`)
}

/** The generated module's schema and migration history stay in the database after it is removed: clear them, or the next run collides. */
async function dropScratchSchemas(name: string) {
  const env = await Bun.file(join(ROOT, 'examples/starter/.env')).text()
  const url = /^DATABASE_URL="?([^"\n]+)"?$/m.exec(env)?.[1]
  if (!url) throw new Error('DATABASE_URL not found in examples/starter/.env')
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await client.unsafe(`drop schema if exists ${name} cascade`)
    await client.unsafe(`drop schema if exists drizzle_${name} cascade`)
  } finally {
    await client.end()
  }
}

const kit = (...args: string[]) =>
  run(['bun', 'scripts/kit.ts', ...args, '--app', 'examples/starter'], `kit ${args.join(' ')}`)

async function sequence(order: string[]) {
  console.log(`\nadd ${order.join(' → ')}, then remove in reverse`)
  for (const name of order) {
    await kit('add', name)
    await check(`add ${name}`)
  }
  for (const name of order.toReversed()) {
    await kit('remove', name)
    await check(`remove ${name}`)
  }
  await run(['git', 'diff', '--exit-code', '--', 'examples/starter'], 'the starter is as it was')
  console.log('  ✓ the starter is as it was')
}

await check('the starter as it is')
// notification before the producers that ship integrations for it, and after: both directions of the wiring.
await sequence(['notification', 'realtime', 'billing', 'privacy'])
if (!quick) {
  await sequence(['privacy', 'billing', 'realtime', 'notification'])

  console.log('\ngenerate a module')
  const name = 'scratch'
  await dropScratchSchemas(name)
  try {
    await run(['bun', 'scripts/kit.ts', 'gen', name, '--app', 'examples/starter'], 'gen scratch')
    await run(['bun', 'run', '--filter', '@example/starter', 'db:generate'], 'db:generate')
    await run(['bun', 'run', '--filter', `@mod/${name}`, 'typecheck'], 'scratch: typecheck')
    await run(['bun', 'run', '--filter', `@mod/${name}`, 'test'], 'scratch: unit tests')
    await check(`gen ${name}`)
    console.log(`  ✓ ${name} works out of the box`)
  } finally {
    await run(
      ['bun', 'scripts/kit.ts', 'remove', name, '--app', 'examples/starter'],
      'remove scratch',
    ).catch(() => {})
    rmSync(join(ROOT, 'modules', name), { recursive: true, force: true })
    await run(['bun', 'install'])
    await dropScratchSchemas(name)
  }
  await run(
    ['git', 'status', '--porcelain', '--', 'examples/starter', 'modules'],
    'clean tree',
  ).then((out) => {
    if (out.trim()) {
      console.error(`✗ the tree is not as it was:\n${out}`)
      process.exit(1)
    }
  })
  console.log('  ✓ the tree is as it was')
}
console.log('\nadd-matrix: ok')
