/**
 * Storage port for uploaded assets — keeps usecases free of any S3/Bun
 * dependency (implemented by infrastructure/s3). Keys, not URLs, cross this
 * boundary; URL composition is an HTTP-layer concern.
 */
export interface FileStorage {
  upload(file: File): Promise<{ key: string }>;
  /** Best-effort — implementations must not throw on missing objects. */
  remove(key: string): Promise<void>;
}
