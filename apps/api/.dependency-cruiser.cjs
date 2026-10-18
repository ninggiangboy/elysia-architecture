/**
 * Architecture rules for the app itself (apps/api/src): the composition root. The kit is checked in
 * .dependency-cruiser.packages.cjs and the modules in .dependency-cruiser.modules.cjs (both at the repo root); here
 * both are black boxes the app wires together. Run with `bun run check:arch`.
 */

const ROOT_FILES = ['app', 'main', 'bootstrap']

/** npm packages the app may not touch directly: they belong to an adapter inside a package. */
const ADAPTERS = {
  'elysia|@elysiajs/[^/]+': ROOT_FILES,
  'drizzle-orm|drizzle-kit|postgres': ['bootstrap'],
  'jose|stripe|web-push|sharp|nodemailer|pino|@simplewebauthn|arctic': [],
}

const adapterRules = Object.entries(ADAPTERS).map(([libs, allowedFrom]) => ({
  name: `no-${libs.split('|')[0].replace(/[^a-z]/g, '')}-in-the-app`,
  comment: `${libs}: ${allowedFrom.length ? `only ${allowedFrom.join(', ')} may import it` : 'the app uses it through a package, never directly'}.`,
  severity: 'error',
  from: { path: '^src/', pathNot: [...allowedFrom.map((p) => `^src/${p}`), '\\.test\\.ts$'] },
  to: { path: `node_modules/(${libs})/` },
}))

module.exports = {
  forbidden: [
    {
      name: 'nothing-imports-the-composition-root',
      comment:
        'app.ts, main.ts and bootstrap/ wire the packages together; nothing else may depend on them.',
      severity: 'error',
      from: { path: '^src/', pathNot: `^src/(${ROOT_FILES.join('|')})` },
      to: { path: `^src/(${ROOT_FILES.join('|')})` },
    },
    ...adapterRules,
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    // The kit and the modules are checked on their own; here they are black boxes.
    doNotFollow: { path: ['node_modules', '^\\.\\./\\.\\./(packages|modules)/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
      conditionNames: ['import', 'require', 'node', 'default'],
      exportsFields: ['exports'],
    },
  },
}
