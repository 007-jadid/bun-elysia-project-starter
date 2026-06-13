import { extname } from "node:path";
import { env } from "../../config/env";
import { AppError, childLogger } from "../../lib";
import { s3Client } from "./client";

const log = childLogger("s3");

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — default tier
/** Photo-upload tier: 1MB per file (CMS bulk photo upload). */
export const MAX_PHOTO_SIZE = 1 * 1024 * 1024; // 1MB

export interface UploadResult {
  key: string;
}

/**
 * Upload an image to S3 under the service folder and return its key (the DB
 * stores keys, not URLs — the public URL is composed at the response layer).
 * `maxSize` is the per-file byte cap (defaults to 5MB; the photo
 * endpoint passes MAX_PHOTO_SIZE). Validation failures are INVALID_INPUT so
 * the error middleware maps them to a 400 rather than a 500.
 */
export const uploadFile = async (
  file: File,
  maxSize: number = MAX_FILE_SIZE,
): Promise<UploadResult> => {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new AppError(
      "INVALID_INPUT",
      `File type '${file.type}' not supported. Allowed: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
    );
  }

  if (file.size > maxSize) {
    throw new AppError(
      "INVALID_INPUT",
      `File too large. Maximum allowed: ${(maxSize / 1024 / 1024).toFixed(1)}MB, received: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
    );
  }

  const ext = extname(file.name) || ".jpg";
  const sanitizedName = file.name
    .replace(ext, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/-+/g, "-");
  const uniqueName = `${Bun.randomUUIDv7().replaceAll("-", "")}-${sanitizedName}${ext}`;
  const key = `${env.S3_SERVICE_FOLDER}/${uniqueName}`;

  const s3file = s3Client.file(key);
  await s3file.write(file, {
    type: file.type,
    acl: "public-read",
  });

  log.info({ key, size: file.size, type: file.type }, "File uploaded to S3");

  return { key };
};

/**
 * Best-effort delete — used to clean up replaced/orphaned images. A missing
 * object or transient S3 error must never fail the calling DB operation, so
 * failures are logged and swallowed.
 */
export const deleteFile = async (key: string): Promise<void> => {
  try {
    await s3Client.file(key).delete();
    log.info({ key }, "File deleted from S3");
  } catch (err) {
    log.warn(
      { key, err: err instanceof Error ? err.message : err },
      "Failed to delete S3 file (continuing)",
    );
  }
};
