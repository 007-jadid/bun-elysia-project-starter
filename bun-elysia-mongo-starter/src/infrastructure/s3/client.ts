import { S3Client } from 'bun'
import { env } from '../../config/env'

export const s3Client = new S3Client({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
})
