/**
 * Rules for packages/kit-*: the graph between packages and which npm packages each may use. Run with `bun run check:arch`.
 * A package is liftable into its own repository exactly when none of these rules needs bending.
 */

/** package -> the other kit packages it may import (a deliberate, acyclic graph). */
const KIT_GRAPH = {
  core: [],
  config: [],
  context: [],
  i18n: [],
  telemetry: ['context', 'config'],
  db: ['core', 'config'],
  http: ['core', 'context', 'telemetry'],
  auth: ['core', 'context', 'http'],
  messaging: ['core', 'config', 'context', 'db', 'telemetry'],
  mail: ['config', 'messaging'],
  storage: ['config'],
  'privacy-participant': ['core', 'messaging', 'storage'],
  runtime: ['config', 'db', 'messaging', 'privacy-participant', 'telemetry'],
  // Fakes for tests: may use whatever a test wants to fake.
  testing: ['core', 'messaging', 'storage'],
}

/** npm packages that only some kit packages may import: the frameworks and drivers a package is an adapter for. */
const ADAPTERS = {
  'elysia|@elysiajs/[^/]+': ['http', 'auth', 'runtime'],
  nodemailer: ['mail'],
  'drizzle-orm|postgres': ['db', 'messaging', 'runtime'],
  pino: ['telemetry'],
  '@opentelemetry/[^/]+': ['telemetry', 'http', 'context'],
}

const graphRules = Object.entries(KIT_GRAPH).map(([name, allowed]) => ({
  name: `kit-${name}-imports-only-its-allowed-packages`,
  comment: `@kit/${name} may import: ${allowed.map((a) => `@kit/${a}`).join(', ') || 'no other kit package'}.`,
  severity: 'error',
  from: { path: `^packages/kit-${name}/`, pathNot: '\\.test\\.ts$' },
  to: {
    path: '^packages/kit-',
    pathNot: [`^packages/kit-(${[name, ...allowed].join('|')})/`],
  },
}))

const adapterRules = Object.entries(ADAPTERS).map(([libs, allowed]) => ({
  name: `no-${libs.split('|')[0].replace(/[^a-z]/g, '')}-outside-its-adapters`,
  comment: `${libs} is a framework/driver: only ${allowed.map((a) => `@kit/${a}`).join(', ')} may import it.`,
  severity: 'error',
  from: {
    path: '^packages/',
    pathNot: [...allowed.map((a) => `^packages/kit-${a}/`), '\\.test\\.ts$'],
  },
  to: { path: `node_modules/(${libs})/` },
}))

module.exports = {
  forbidden: [
    {
      name: 'packages-do-not-import-apps',
      comment:
        'A package knows nothing of the apps that use it (and cannot use the apps/api `#/` alias).',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'packages-import-only-what-they-can-resolve',
      comment:
        'A kit package that imports another one (or an npm package) it does not declare in its package.json cannot resolve it: that is the graph being bent.',
      severity: 'error',
      from: { path: '^packages/kit-[^/]+/src/', pathNot: '\\.test\\.ts$' },
      to: { couldNotResolve: true, pathNot: '^bun(:|$)' },
    },
    {
      name: 'packages-declare-what-they-import',
      comment: 'Every npm package a kit package imports is in its own package.json.',
      severity: 'error',
      from: { path: '^packages/kit-[^/]+/src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    ...graphRules,
    ...adapterRules,
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    exclude: { path: '\\.test\\.ts$' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
      conditionNames: ['import', 'require', 'node', 'default'],
      exportsFields: ['exports'],
    },
  },
}
