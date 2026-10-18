/**
 * Builds one package for publishing: JavaScript with `bun build` (dependencies stay external) and declarations with tsc,
 * both into dist/. Inside the repo nothing needs dist: the `bun` export condition points at src. Run from the package folder
 * (`bun run build`), in dependency order across the repo (`bun run build:packages`).
 */
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.cwd()
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
  exports: Record<string, string | { bun?: string }>
}

const entries = Object.values(pkg.exports)
  .map((value) => (typeof value === 'string' ? undefined : value.bun))
  .filter((path): path is string => !!path && /\.tsx?$/.test(path))

async function run(cmd: string[]) {
  const proc = Bun.spawn(cmd, { cwd: dir, stdout: 'inherit', stderr: 'inherit' })
  if ((await proc.exited) !== 0) process.exit(1)
}

rmSync(join(dir, 'dist'), { recursive: true, force: true })
await run([
  'bun',
  'build',
  ...entries,
  '--outdir',
  'dist',
  '--root',
  'src',
  '--target',
  'bun',
  '--packages',
  'external',
])
await run(['bunx', 'tsc', '-p', 'tsconfig.build.json'])
