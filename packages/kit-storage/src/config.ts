import { defineSlice } from '@kit/config'
import { z } from 'zod'

export const storageConfig = defineSlice({
  title: 'Object storage (S3-compatible: SeaweedFS in dev)',
  example: {
    S3_ENDPOINT: 'http://localhost:8333',
    S3_PUBLIC_ENDPOINT: 'http://localhost:8333',
    S3_BUCKET: 'avatars',
    S3_ACCESS_KEY_ID: 'app-access-key',
    S3_SECRET_ACCESS_KEY: 'app-secret-key',
  },
  schema: z.object({
    S3_ENDPOINT: z.url().describe('Endpoint the API talks to.'),
    S3_PUBLIC_ENDPOINT: z
      .url()
      .optional()
      .describe('Endpoint browsers use for presigned links, when it differs from S3_ENDPOINT.'),
    S3_REGION: z.string().default('us-east-1').describe('Region.'),
    S3_BUCKET: z.string().min(1).describe('Bucket for avatars, covers and data exports.'),
    S3_ACCESS_KEY_ID: z.string().min(1).describe('Access key id.'),
    S3_SECRET_ACCESS_KEY: z.string().min(1).describe('Secret access key.'),
  }),
})
