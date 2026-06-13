import { Value } from "@sinclair/typebox/value";
import type { Static } from "elysia";
import { t } from "elysia";

// Base schema - infrastructure variables are always required
const envSchema = t.Object({
  // App
  NODE_ENV: t.UnionEnum(["development", "test", "production"], {
    default: "development",
  }),
  DEPLOY_ENV: t.UnionEnum(["local", "dev", "stage", "uat", "prod"], {
    default: "local",
  }),
  PORT: t.Numeric({ minimum: 1, maximum: 65535, default: 4444 }),
  HOST: t.String({ default: "0.0.0.0" }),
  SERVICE_NAME: t.String({ minLength: 1, default: "app-service" }),
  SERVICE_VERSION: t.String({ default: "1.0.0" }),
  OPENAPI_SERVER_URL: t.Optional(t.String()), // defaults to http://localhost:{PORT} when not set

  // Write Database - always required
  WRITE_DB_HOST: t.String({ minLength: 1 }),
  WRITE_DB_PORT: t.Numeric({ minimum: 1, maximum: 65535, default: 5432 }),
  WRITE_DB_NAME: t.String({ minLength: 1 }),
  WRITE_DB_USER: t.String({ minLength: 1 }),
  WRITE_DB_PASS: t.String({ minLength: 1 }),
  WRITE_DB_IDLE_TIMEOUT: t.Numeric({ minimum: 1, default: 30 }),
  WRITE_DB_ENABLE_SSL_MODE: t.BooleanString({ default: false }),
  WRITE_DB_POOL_MAX: t.Numeric({ minimum: 1, maximum: 100, default: 10 }),

  // Read Database - always required
  READ_DB_HOST: t.String({ minLength: 1 }),
  READ_DB_PORT: t.Numeric({ minimum: 1, maximum: 65535, default: 5432 }),
  READ_DB_NAME: t.String({ minLength: 1 }),
  READ_DB_USER: t.String({ minLength: 1 }),
  READ_DB_PASS: t.String({ minLength: 1 }),
  READ_DB_IDLE_TIMEOUT: t.Numeric({ minimum: 1, default: 30 }),
  READ_DB_ENABLE_SSL_MODE: t.BooleanString({ default: false }),
  READ_DB_POOL_MAX: t.Numeric({ minimum: 1, maximum: 100, default: 10 }),

  // Write Redis - always required
  WRITE_REDIS_URL: t.String({
    format: "uri",
    error: "WRITE_REDIS_URL must be a valid URL",
  }),

  // Read Redis - always required
  READ_REDIS_URL: t.String({
    format: "uri",
    error: "READ_REDIS_URL must be a valid URL",
  }),

  // RabbitMQ - always required
  RABBITMQ_URL: t.String({
    format: "uri",
    error: "RABBITMQ_URL must be a valid URL",
  }),

  // gRPC clients (this service runs NO gRPC server by default).
  // Optional until you wire a client; flip to required in the same change that
  // adds the client (required = used). Rename to match your own client.
  GRPC_CLIENT_URL: t.Optional(t.String({ minLength: 1 })), // e.g., 'localhost:50052'

  // S3 (image/file uploads via Bun's native S3 client)
  S3_BUCKET: t.String({ minLength: 1 }),
  S3_REGION: t.String({ minLength: 1 }),
  S3_ACCESS_KEY_ID: t.String({ minLength: 1 }),
  S3_SECRET_ACCESS_KEY: t.String({ minLength: 1 }),
  S3_ENDPOINT: t.Optional(t.String({ minLength: 1 })), // non-AWS providers only
  S3_SERVICE_FOLDER: t.String({ default: "uploads" }),
  // Public base for composing image URLs in API responses (DB stores keys).
  S3_PUBLIC_BASE_URL: t.String({ default: "https://cdn.example.com" }),

  // Auth - always required
  JWT_SECRET: t.String({
    minLength: 32,
    error: "JWT_SECRET must be at least 32 characters",
  }),
  JWT_ISSUER: t.String({ default: "https://api.example.com" }),
  JWT_AUDIENCE: t.String({ default: "app" }),

  // Security (HSTS, rate limiting, request limits handled upstream by your gateway / reverse proxy)
  // Two-tier body limit: MAX_SIZE is the app-layer cap for ordinary (JSON)
  // requests, enforced by bodyLimitMiddleware via Content-Length. UPLOAD_MAX
  // applies to multipart/form-data (file uploads) and is ALSO the Bun-level
  // hard cap (maxRequestBodySize in main.ts) — the runtime memory backstop
  // for chunked requests that carry no Content-Length.
  REQUEST_BODY_MAX_SIZE: t.Numeric({ minimum: 1, default: 1048576 }), // 1MB default for APIs
  // Must stay above the 5MB s3 uploadFile limit plus multipart framing.
  REQUEST_BODY_UPLOAD_MAX_SIZE: t.Numeric({ minimum: 1, default: 6291456 }), // 6MB for uploads

  // OpenTelemetry
  OTEL_ENABLED: t.BooleanString({ default: false }),
  OTEL_EXPORTER_OTLP_ENDPOINT: t.String({
    format: "uri",
    default: "http://localhost:4318",
  }),
  OTEL_EXPORTER_OTLP_PROTOCOL: t.UnionEnum(["http/protobuf", "grpc"], {
    default: "http/protobuf",
  }),
  OTEL_EXPORTER_OTLP_HEADERS: t.Optional(t.String()),
  // Head-sampling ratio for traces that START here (parent decisions are
  // always respected). 1 = trace everything; tune down under load on this
  // public-facing service without redeploying.
  OTEL_TRACES_SAMPLE_RATE: t.Numeric({ minimum: 0, maximum: 1, default: 1 }),

  // Logging
  LOG_LEVEL: t.UnionEnum(["trace", "debug", "info", "warn", "error", "fatal"], {
    default: "info",
  }),

  // OpenAPI Docs
  ENABLE_OPENAPI: t.BooleanString({ default: true }),
});

export type Env = Static<typeof envSchema>;

/**
 * Validates raw input against the schema and collects ALL errors instead of
 * throwing on the first one. Runs the full pipeline in order:
 * Convert (coerce string->number/boolean) -> Default -> Check -> Decode (transforms).
 */
export const parseEnv = (
  input: unknown,
): { success: true; data: Env } | { success: false; error: string } => {
  // Convert mutates a clone: coerces numeric/boolean strings to their target types.
  const converted = Value.Convert(envSchema, Value.Clone(input));
  // Fill in defaults for any missing keys.
  const withDefaults = Value.Default(envSchema, converted);

  if (!Value.Check(envSchema, withDefaults)) {
    const error = [...Value.Errors(envSchema, withDefaults)]
      .map((e) => `  • ${e.path || "(root)"}: ${e.message}`)
      .join("\n");
    return { success: false, error };
  }

  // Decode applies transforms (e.g. BooleanString string -> boolean). It can
  // still throw: range constraints on t.Numeric are checked on the DECODED
  // value, which Value.Check (pre-transform) does not see — e.g. PORT=70000
  // passes Check and only fails here. Convert that into the same structured
  // error instead of crashing boot with a raw TypeBox stack trace.
  try {
    return {
      success: true,
      data: Value.Decode(envSchema, withDefaults) as Env,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `  • ${message}` };
  }
};

/**
 * Validates environment variables using the TypeBox schema.
 * Exits the process with detailed error messages if validation fails.
 * Infrastructure variables (WRITE_DB_*, READ_DB_*, WRITE_REDIS_URL, READ_REDIS_URL,
 * RABBITMQ_URL, JWT_SECRET) are always required.
 */
export const checkEnv = (): Env => {
  const parsed = parseEnv(Bun.env);

  if (!parsed.success) {
    console.error("\n❌ Invalid environment variables:\n");
    console.error(parsed.error);
    console.error("");
    process.exit(1);
  }

  const config = parsed.data;
  const isProduction = config.NODE_ENV === "production";
  const warnings: string[] = [];

  // Production requirements
  if (isProduction) {
    // OpenAPI docs should be disabled in production
    if (config.ENABLE_OPENAPI) {
      warnings.push(
        'ENABLE_OPENAPI is "true" in production. Set ENABLE_OPENAPI=false to hide Swagger UI',
      );
    }

    // OTEL headers recommended in production when enabled
    if (config.OTEL_ENABLED && !config.OTEL_EXPORTER_OTLP_HEADERS) {
      warnings.push(
        "OTEL_EXPORTER_OTLP_HEADERS is not set while OTEL is enabled. Auth may fail against production collectors",
      );
    }
  }

  // Body size limit warnings (applies to all environments)
  if (config.REQUEST_BODY_UPLOAD_MAX_SIZE > 10485760) {
    warnings.push(
      `REQUEST_BODY_UPLOAD_MAX_SIZE is ${(config.REQUEST_BODY_UPLOAD_MAX_SIZE / 1048576).toFixed(1)}MB. Large limits may expose the service to DoS attacks`,
    );
  }
  if (config.REQUEST_BODY_UPLOAD_MAX_SIZE < config.REQUEST_BODY_MAX_SIZE) {
    warnings.push(
      "REQUEST_BODY_UPLOAD_MAX_SIZE is below REQUEST_BODY_MAX_SIZE — the upload tier would be stricter than ordinary requests; check both values",
    );
  }

  // Print warnings
  if (warnings.length > 0) {
    console.warn("\n⚠️  Security warnings:\n");
    for (const warning of warnings) {
      console.warn(`   • ${warning}`);
    }
    console.warn("");
  }

  return config;
};

// Validate immediately on import
export const env = checkEnv();

export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/**
 * Prints current environment configuration (redacts sensitive values)
 */
export const printEnvConfig = () => {
  const redact = (value: string | undefined) => (value ? "****" : "not set");

  console.log("\n📋 Environment Configuration:");
  console.log(`   NODE_ENV:        ${env.NODE_ENV}`);
  console.log(`   DEPLOY_ENV:      ${env.DEPLOY_ENV}`);
  console.log(`   PORT:            ${env.PORT}`);
  console.log(`   HOST:            ${env.HOST}`);
  console.log(`   SERVICE_NAME:    ${env.SERVICE_NAME}`);
  console.log(`   WRITE_DB_HOST:   ${env.WRITE_DB_HOST}`);
  console.log(`   WRITE_DB_PORT:   ${env.WRITE_DB_PORT}`);
  console.log(`   WRITE_DB_NAME:   ${env.WRITE_DB_NAME}`);
  console.log(`   WRITE_DB_USER:   ${env.WRITE_DB_USER}`);
  console.log(`   WRITE_DB_PASS:   ${redact(env.WRITE_DB_PASS)}`);
  console.log(`   WRITE_DB_POOL:   ${env.WRITE_DB_POOL_MAX}`);
  console.log(`   WRITE_DB_IDLE:   ${env.WRITE_DB_IDLE_TIMEOUT}s`);
  console.log(`   WRITE_DB_SSL:    ${env.WRITE_DB_ENABLE_SSL_MODE}`);
  console.log(`   READ_DB_HOST:    ${env.READ_DB_HOST}`);
  console.log(`   READ_DB_PORT:    ${env.READ_DB_PORT}`);
  console.log(`   READ_DB_NAME:    ${env.READ_DB_NAME}`);
  console.log(`   READ_DB_USER:    ${env.READ_DB_USER}`);
  console.log(`   READ_DB_PASS:    ${redact(env.READ_DB_PASS)}`);
  console.log(`   READ_DB_POOL:    ${env.READ_DB_POOL_MAX}`);
  console.log(`   READ_DB_IDLE:    ${env.READ_DB_IDLE_TIMEOUT}s`);
  console.log(`   READ_DB_SSL:     ${env.READ_DB_ENABLE_SSL_MODE}`);
  console.log(`   WRITE_REDIS:     ${redact(env.WRITE_REDIS_URL)}`);
  console.log(`   READ_REDIS:      ${redact(env.READ_REDIS_URL)}`);
  console.log(
    `   RABBITMQ_URL:    ${env.RABBITMQ_URL ? redact(env.RABBITMQ_URL) : "not set"}`,
  );
  console.log(`   GRPC_CLIENT_URL: ${env.GRPC_CLIENT_URL || "not set"}`);
  console.log(`   S3_BUCKET:       ${env.S3_BUCKET}`);
  console.log(`   S3_REGION:       ${env.S3_REGION}`);
  console.log(`   S3_ACCESS_KEY:   ${redact(env.S3_ACCESS_KEY_ID)}`);
  console.log(`   S3_SECRET_KEY:   ${redact(env.S3_SECRET_ACCESS_KEY)}`);
  console.log(`   S3_ENDPOINT:     ${env.S3_ENDPOINT || "AWS default"}`);
  console.log(`   S3_FOLDER:       ${env.S3_SERVICE_FOLDER}`);
  console.log(`   JWT_SECRET:      ${redact(env.JWT_SECRET)}`);
  console.log(`   JWT_ISSUER:      ${env.JWT_ISSUER}`);
  console.log(`   JWT_AUDIENCE:    ${env.JWT_AUDIENCE}`);
  console.log(`   BODY_MAX_SIZE:   ${env.REQUEST_BODY_MAX_SIZE} bytes`);
  console.log(`   BODY_UPLOAD_MAX: ${env.REQUEST_BODY_UPLOAD_MAX_SIZE} bytes`);
  console.log(`   OTEL_ENABLED:    ${env.OTEL_ENABLED}`);
  console.log(`   OTEL_ENDPOINT:   ${env.OTEL_EXPORTER_OTLP_ENDPOINT}`);
  console.log(`   OTEL_PROTOCOL:   ${env.OTEL_EXPORTER_OTLP_PROTOCOL}`);
  console.log(`   OTEL_SAMPLE:     ${env.OTEL_TRACES_SAMPLE_RATE}`);
  console.log(
    `   OTEL_HEADERS:    ${env.OTEL_EXPORTER_OTLP_HEADERS ? "set" : "not set"}`,
  );
  console.log(`   LOG_LEVEL:       ${env.LOG_LEVEL}`);
  console.log(`   ENABLE_OPENAPI:  ${env.ENABLE_OPENAPI}`);
  console.log("");
};
