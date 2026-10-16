/** Luật ranh giới kiến trúc — chạy bằng `bun run check:arch`. */
const FRAMEWORKS =
  'node_modules/(elysia|@elysiajs|drizzle-orm|drizzle-kit|postgres|nodemailer|jose|pino)/'
const ROOT = '^src/(app|main|bootstrap)'

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'domain chỉ phụ thuộc domain; không biết application/infrastructure/presentation hay framework.',
      severity: 'error',
      from: { path: ['^src/modules/[^/]+/domain/', '^src/shared/domain/'] },
      to: {
        path: [
          '^src/modules/[^/]+/(application|infrastructure|presentation)/',
          '^src/shared/(application|infrastructure|presentation|http|messaging)/',
          ROOT,
          FRAMEWORKS,
        ],
      },
    },
    {
      name: 'application-no-infrastructure',
      comment:
        'application nói chuyện với bên ngoài qua port; không import infrastructure/presentation/framework.',
      severity: 'error',
      from: { path: ['^src/modules/[^/]+/application/', '^src/shared/application/'] },
      to: {
        path: [
          '^src/modules/[^/]+/(infrastructure|presentation)/',
          '^src/shared/(infrastructure|presentation|http)/',
          ROOT,
          FRAMEWORKS,
        ],
      },
    },
    {
      name: 'modules-talk-only-through-contracts',
      comment:
        'Module A chỉ được import modules/B/contracts — không chạm nội bộ của B (để tách service sau này).',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/contracts/'],
      },
    },
    {
      name: 'contracts-are-self-contained',
      comment: 'contracts là DTO/interface thuần: không import gì từ bên trong module hay shared.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/contracts/' },
      to: {
        path: [
          '^src/modules/[^/]+/(domain|application|infrastructure|presentation)/',
          '^src/shared/',
          ROOT,
        ],
      },
    },
    {
      name: 'shared-knows-no-module',
      comment: 'shared là building block, không phụ thuộc module nghiệp vụ.',
      severity: 'error',
      from: { path: '^src/shared/', pathNot: '^src/shared/testing/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'only-composition-root-wires-modules',
      comment: 'Chỉ app.ts/main.ts/bootstrap được import *.module.ts và cài đặt cụ thể.',
      severity: 'error',
      from: { path: '^src/(modules|shared)/' },
      to: { path: ROOT },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.test\\.ts$' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      mainFields: ['module', 'main'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
