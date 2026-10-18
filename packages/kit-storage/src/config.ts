import { defineSlice } from '@kit/config'
import { z } from 'zod'

const required = (
  env: Record<string, unknown>,
  ctx: z.RefinementCtx,
  names: string[],
  when: string,
) => {
  for (const name of names)
    if (!env[name])
      ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required when ${when}` })
}

export const storageConfig = defineSlice({
  title: 'Object storage (S3-compatible: SeaweedFS in dev) or the local disk',
  notes:
    'STORAGE_DRIVER=local keeps files on disk and serves them from the API itself, so a project can start without an S3 service.',
  example: {
    S3_ENDPOINT: 'http://localhost:8333',
    S3_PUBLIC_ENDPOINT: 'http://localhost:8333',
    S3_BUCKET: 'avatars',
    S3_ACCESS_KEY_ID: 'app-access-key',
    S3_SECRET_ACCESS_KEY: 'app-secret-key',
  },
  schema: z
    .object({
      STORAGE_DRIVER: z
        .enum(['s3', 'local'])
        .default('s3')
        .describe(
          'Where files live: `s3` (any S3-compatible service) or `local` (the disk of the API server).',
        ),
      S3_ENDPOINT: z.url().optional().describe('s3: endpoint the API talks to.'),
      S3_PUBLIC_ENDPOINT: z
        .url()
        .optional()
        .describe(
          's3: endpoint browsers use for presigned links, when it differs from S3_ENDPOINT.',
        ),
      S3_REGION: z.string().default('us-east-1').describe('s3: region.'),
      S3_BUCKET: z
        .string()
        .min(1)
        .optional()
        .describe('s3: bucket for avatars, covers and data exports.'),
      S3_ACCESS_KEY_ID: z.string().min(1).optional().describe('s3: access key id.'),
      S3_SECRET_ACCESS_KEY: z.string().min(1).optional().describe('s3: secret access key.'),
      STORAGE_LOCAL_DIR: z
        .string()
        .default('./.data/storage')
        .describe('local: folder the files are written to.'),
      STORAGE_LOCAL_SECRET: z
        .string()
        .min(32)
        .optional()
        .describe(
          'local: key that signs upload and download links (32+ chars). Changing it invalidates links already handed out.',
        ),
      STORAGE_LOCAL_PUBLIC_URL: z
        .url()
        .default('http://localhost:3000/api')
        .describe(
          'local: where browsers reach the API (links look like `<this>/storage/local/<key>?…`).',
        ),
    })
    .superRefine((env, ctx) => {
      if (env.STORAGE_DRIVER === 's3')
        required(
          env,
          ctx,
          ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
          'STORAGE_DRIVER=s3',
        )
      else required(env, ctx, ['STORAGE_LOCAL_SECRET'], 'STORAGE_DRIVER=local')
    }),
})

export type StorageConfig = z.infer<typeof storageConfig.schema>
