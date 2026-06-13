import { extname } from 'node:path'
import { env } from '../../config/env'
import { logger } from '../../lib'
import { s3Client } from './client'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export interface UploadResult {
  key: string
}

export const uploadFile = async (file: File): Promise<UploadResult> => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(
      `File type '${file.type}' not supported. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File too large. Maximum allowed: 5MB, received: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
    )
  }

  const ext = extname(file.name) || '.jpg'
  const sanitizedName = file.name
    .replace(ext, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
  const uniqueName = `${Bun.randomUUIDv7().replaceAll('-', '')}-${sanitizedName}${ext}`
  const key = `${env.S3_SERVICE_FOLDER}/${uniqueName}`

  const s3file = s3Client.file(key)
  await s3file.write(file, {
    type: file.type,
    acl: 'public-read',
  })

  logger.info(
    { caller: 'uploadFile', key, size: file.size, type: file.type },
    'File uploaded to S3',
  )

  return { key }
}
