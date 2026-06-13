import { z } from 'zod'

// Base schema - infrastructure variables are always required
const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEPLOY_ENV: z.enum(['local', 'dev', 'stage', 'uat', 'production']).default('local'),
  PORT: z.coerce.number().min(1).max(65535).default(4445),
  HOST: z.string().default('0.0.0.0'),
  SERVICE_NAME: z.string().min(1).default('app-service'),
  SERVICE_VERSION: z.string().default('1.0.0'),

  // MongoDB
  MONGO_URI: z.string().min(1, { message: 'MONGO_URI is required' }),

  // Write Redis - always required
  WRITE_REDIS_URL: z.url({ message: 'WRITE_REDIS_URL must be a valid URL' }),

  // Read Redis - always required
  READ_REDIS_URL: z.url({ message: 'READ_REDIS_URL must be a valid URL' }),

  // RabbitMQ - always required
  RABBITMQ_URL: z.url({ message: 'RABBITMQ_URL must be a valid URL' }),

  // gRPC server (this service runs a gRPC server)
  GRPC_PORT: z.coerce.number().min(1).max(65535).default(50051),
  // Shared secret enforced by the gRPC server interceptor on every inbound call.
  // Callers must send it via metadata key `x-api-key` (case-insensitive in gRPC).
  // Leave empty/unset in local dev (auth is skipped when empty).
  GRPC_SHARED_SECRET: z.string().optional(),

  // Auth - always required
  JWT_SECRET: z.string().min(32, { message: 'JWT_SECRET must be at least 32 characters' }),
  JWT_ISSUER: z.string().default('https://api.example.com'),
  JWT_AUDIENCE: z.string().default('app'),

  // S3 (Bun built-in S3 client reads S3_* / AWS_* env vars automatically)
  S3_BUCKET: z.string().min(1, { message: 'S3_BUCKET is required' }),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1, { message: 'S3_ACCESS_KEY_ID is required' }),
  S3_SECRET_ACCESS_KEY: z.string().min(1, { message: 'S3_SECRET_ACCESS_KEY is required' }),
  S3_ENDPOINT: z.string().optional(),
  S3_SERVICE_FOLDER: z.string().default('uploads'),

  // Security (HSTS, rate limiting, request limits handled upstream by your
  // gateway / reverse proxy; CORS handled by corsMiddleware)
  REQUEST_BODY_MAX_SIZE: z.coerce.number().min(1).default(1048576), // 1MB default for APIs
  MAX_UPLOAD_SIZE: z.coerce.number().min(1).default(52428800), // 50MB max for file uploads

  // OpenTelemetry
  OTEL_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default('http://localhost:4318'),
  OTEL_EXPORTER_OTLP_PROTOCOL: z.enum(['grpc', 'http/protobuf']).default('http/protobuf'),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_METRICS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  OTEL_METRICS_EXPORT_INTERVAL_MS: z.coerce.number().min(1000).default(10000),

  // Loki
  LOKI_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  LOKI_HOST: z.string().optional(),
  LOKI_BASIC_AUTH: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // OpenAPI - explicitly control docs visibility per environment
  ENABLE_OPENAPI: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  OPENAPI_SERVER_URL: z.string().default('http://localhost:4445'),
})

export type Env = z.infer<typeof envSchema>

/**
 * Validates environment variables using Zod schema.
 * Exits the process with detailed error messages if validation fails.
 * Infrastructure variables (MONGO_URI, WRITE_REDIS_URL, READ_REDIS_URL, RABBITMQ_URL, JWT_SECRET) are always required.
 */
export const checkEnv = (): Env => {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    console.error('\n❌ Invalid environment variables:\n')
    console.error(z.prettifyError(parsed.error))
    console.error('')
    process.exit(1)
  }

  const config = parsed.data
  const isProduction = config.NODE_ENV === 'production'
  const warnings: string[] = []

  // Production requirements
  if (isProduction) {
    if (config.OTEL_ENABLED && !config.OTEL_EXPORTER_OTLP_HEADERS) {
      console.error(
        '\n❌ OTEL_EXPORTER_OTLP_HEADERS is required when OTEL is enabled in production\n',
      )
      process.exit(1)
    }
  }

  // Body size limit warnings (applies to all environments)
  if (config.REQUEST_BODY_MAX_SIZE > 10485760) {
    warnings.push(
      `REQUEST_BODY_MAX_SIZE is ${(config.REQUEST_BODY_MAX_SIZE / 1048576).toFixed(1)}MB. Large limits may expose the service to DoS attacks`,
    )
  }

  if (config.MAX_UPLOAD_SIZE > 104857600) {
    warnings.push(
      `MAX_UPLOAD_SIZE is ${(config.MAX_UPLOAD_SIZE / 1048576).toFixed(1)}MB. Consider lower limits unless large file uploads are required`,
    )
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Security warnings:\n')
    for (const warning of warnings) {
      console.warn(`   • ${warning}`)
    }
    console.warn('')
  }

  return config
}

// Validate immediately on import
export const env = checkEnv()

export const isDev = env.NODE_ENV === 'development'
export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

/**
 * Prints current environment configuration (redacts sensitive values)
 */
export const printEnvConfig = () => {
  const redact = (value: string | undefined) => (value ? '****' : 'not set')

  console.log('\n📋 Environment Configuration:')
  console.log(`   NODE_ENV:        ${env.NODE_ENV}`)
  console.log(`   DEPLOY_ENV:      ${env.DEPLOY_ENV}`)
  console.log(`   PORT:            ${env.PORT}`)
  console.log(`   HOST:            ${env.HOST}`)
  console.log(`   SERVICE_NAME:    ${env.SERVICE_NAME}`)
  console.log(`   MONGO_URI:       ${redact(env.MONGO_URI)}`)
  console.log(`   WRITE_REDIS:     ${redact(env.WRITE_REDIS_URL)}`)
  console.log(`   READ_REDIS:      ${redact(env.READ_REDIS_URL)}`)
  console.log(`   RABBITMQ_URL:    ${env.RABBITMQ_URL ? redact(env.RABBITMQ_URL) : 'not set'}`)
  console.log(`   GRPC_PORT:       ${env.GRPC_PORT}`)
  console.log(`   JWT_SECRET:      ${redact(env.JWT_SECRET)}`)
  console.log(`   JWT_ISSUER:      ${env.JWT_ISSUER}`)
  console.log(`   JWT_AUDIENCE:    ${env.JWT_AUDIENCE}`)
  console.log(`   S3_BUCKET:       ${env.S3_BUCKET}`)
  console.log(`   S3_REGION:       ${env.S3_REGION}`)
  console.log(`   S3_ACCESS_KEY:   ${redact(env.S3_ACCESS_KEY_ID)}`)
  console.log(`   S3_SECRET_KEY:   ${redact(env.S3_SECRET_ACCESS_KEY)}`)
  console.log(`   S3_ENDPOINT:     ${env.S3_ENDPOINT || 'default (AWS)'}`)
  console.log(`   S3_FOLDER:       ${env.S3_SERVICE_FOLDER}`)
  console.log(`   BODY_MAX_SIZE:   ${env.REQUEST_BODY_MAX_SIZE} bytes`)
  console.log(`   MAX_UPLOAD:      ${env.MAX_UPLOAD_SIZE} bytes`)
  console.log(`   OTEL_ENABLED:    ${env.OTEL_ENABLED}`)
  console.log(`   LOKI_ENABLED:    ${env.LOKI_ENABLED}`)
  console.log(`   LOG_LEVEL:       ${env.LOG_LEVEL}`)
  console.log(`   ENABLE_OPENAPI:  ${env.ENABLE_OPENAPI}`)
  console.log('')
}
