/**
 * Architecture rules for modules/*: layers inside a module, what a module may see of another, and which npm packages only
 * an adapter may import. Run with `bun run check:arch`. Paths: modules/<name>/src/<layer>/…
 */

/** The kit packages (workspace folders) as the cruiser sees them. */
const KIT = '^packages/kit-'

/** npm packages that only an adapter may import, and where from (relative to modules/<name>/src). */
const ADAPTERS = {
  'elysia|@elysiajs/[^/]+': ['presentation', '[^/]+\\.module\\.ts', 'testing\\.ts'],
  'drizzle-orm|postgres': ['infrastructure', '[^/]+\\.module\\.ts', 'manifest\\.ts', 'config\\.ts'],
  jose: ['infrastructure'],
  stripe: ['infrastructure'],
  'web-push': ['infrastructure'],
  sharp: ['infrastructure'],
  '@simplewebauthn|arctic': ['infrastructure'],
}

const adapterRules = Object.entries(ADAPTERS).map(([libs, allowedFrom]) => ({
  name: `no-${libs.split('|')[0].replace(/[^a-z]/g, '')}-outside-adapters`,
  comment: `${libs} is a framework/driver: only adapters (${allowedFrom.join(', ')}) may import it.`,
  severity: 'error',
  from: {
    path: '^modules/[^/]+/src/',
    pathNot: [...allowedFrom.map((p) => `^modules/[^/]+/src/${p}`), '\\.test\\.ts$'],
  },
  to: { path: `node_modules/(${libs})/` },
}))

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'domain depends only on domain and @kit/core; it knows nothing of application/infrastructure/presentation or any framework.',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/domain/' },
      to: {
        path: [
          '^modules/[^/]+/src/(application|infrastructure|presentation)/',
          `${KIT}(?!core/|i18n/)`,
        ],
      },
    },
    {
      name: 'application-no-infrastructure',
      comment:
        'application talks to the outside world through ports; it does not import infrastructure/presentation or the plumbing in the kit (http, db, runtime…); the ports of @kit/mail and @kit/storage are fine.',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/application/' },
      to: {
        path: [
          '^modules/[^/]+/src/(infrastructure|presentation)/',
          `${KIT}(http|db|telemetry|runtime|config)/`,
        ],
      },
    },
    {
      name: 'modules-talk-only-through-their-exports',
      comment:
        'Module A may only import what module B exports (its contracts, integrations, config, schema, manifest, factory) — never B internals, so modules can be split into services later.',
      severity: 'error',
      from: { path: '^modules/([^/]+)/' },
      to: {
        path: '^modules/[^/]+/src/',
        pathNot: [
          '^modules/$1/',
          '^modules/[^/]+/src/(contracts/|integrations/|config\\.ts|manifest\\.ts|index\\.ts|[^/]+\\.module\\.ts|infrastructure/persistence/schema\\.ts|public\\.ts|testing\\.ts)',
        ],
      },
    },
    {
      name: 'contracts-are-self-contained',
      comment:
        'contracts are plain DTOs/interfaces: they import nothing from inside the module or from the kit (except the privacy participation protocol, which privacy re-exports, and the i18n types).',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/contracts/' },
      to: {
        path: ['^modules/[^/]+/src/(domain|application|infrastructure|presentation)/', KIT],
        pathNot: `${KIT}(privacy-participant|i18n)/`,
      },
    },
    {
      name: 'participants-do-not-know-privacy',
      comment:
        'A module that takes part in the privacy jobs speaks the protocol in @kit/privacy-participant; it does not import the privacy module, so privacy can be left out. Only integrations/ (the glue the app installs) may read privacy events.',
      severity: 'error',
      from: { path: '^modules/(?!privacy/)', pathNot: '/src/integrations/' },
      to: { path: '^modules/privacy/' },
    },
    {
      name: 'generic-modules-are-leaves',
      comment:
        'notification and realtime deliver for every module, so their core must not know any module. What they say about a producer lives in the producer (integrations/).',
      severity: 'error',
      from: { path: '^modules/(notification|realtime)/', pathNot: '\\.test\\.ts$' },
      to: { path: '^modules/', pathNot: '^modules/(notification|realtime)/' },
    },
    {
      name: 'integrations-use-contracts-only',
      comment:
        'An integrations/ folder sees its own contracts, the consumer contracts (notification, realtime) and the kit; nothing else.',
      severity: 'error',
      from: { path: '^modules/([^/]+)/src/integrations/' },
      to: {
        path: '^modules/',
        pathNot: [
          '^modules/$1/src/(contracts|integrations)/',
          '^modules/(notification|realtime)/src/contracts/',
        ],
      },
    },
    {
      name: 'module-core-does-not-load-its-integrations',
      comment:
        'Only the composition root installs integrations; otherwise the consumer stops being optional.',
      severity: 'error',
      from: { path: '^modules/([^/]+)/src/', pathNot: ['/src/integrations/', '\\.test\\.ts$'] },
      to: { path: '^modules/[^/]+/src/integrations/' },
    },
    {
      name: 'modules-do-not-import-apps',
      comment: 'A module knows nothing of the app that hosts it (and cannot use its `#/` alias).',
      severity: 'error',
      from: { path: '^modules/' },
      to: { path: '^apps/' },
    },
    {
      name: 'modules-import-only-what-they-can-resolve',
      comment:
        'A module that imports a package or another module it does not declare in its package.json cannot resolve it.',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/', pathNot: '\\.test\\.ts$' },
      to: { couldNotResolve: true, pathNot: '^bun(:|$)' },
    },
    ...adapterRules,
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    // The kit is checked on its own (.dependency-cruiser.packages.cjs); here it is a black box.
    doNotFollow: { path: ['node_modules', '^packages/'] },
    tsPreCompilationDeps: true,
    exclude: { path: '\\.test\\.ts$' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
      conditionNames: ['bun', 'import', 'require', 'node', 'default'],
      exportsFields: ['exports'],
    },
  },
}
