import path from 'node:path'

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

import { env } from '../../config/env'
import { logger } from '../../lib'

// Proto files are read from disk at runtime (not bundled). The build copies the
// protos/ folder next to the compiled server — see the Dockerfile.
const PROTO_PATH = path.join(import.meta.dir, 'protos', 'health.proto')

// ============================================================================
// Auth
// ============================================================================

const AUTH_METADATA_KEY = 'x-api-key'

/**
 * Returns true when the caller's metadata includes the shared secret.
 * If GRPC_SHARED_SECRET is unset (local dev), auth is skipped. Set it in
 * production so callers must send it via the `x-api-key` metadata key.
 */
const isAuthorized = (metadata: grpc.Metadata): boolean => {
  const expected = env.GRPC_SHARED_SECRET
  if (!expected) return true

  const raw = metadata.get(AUTH_METADATA_KEY)
  if (raw.length === 0) return false

  const provided = typeof raw[0] === 'string' ? raw[0] : raw[0]?.toString('utf8')
  return provided === expected
}

const unauthenticated: grpc.ServiceError = {
  name: 'Error',
  message: 'Unauthenticated',
  code: grpc.status.UNAUTHENTICATED,
  details: 'Missing or invalid x-api-key metadata',
  metadata: new grpc.Metadata(),
}

// ============================================================================
// Server
// ============================================================================

/**
 * Build the gRPC server with the generic Health service. Add your own services
 * by loading their proto, pulling `protoDescriptor.<package>.<Service>.service`,
 * and registering handlers via `server.addService(...)`. Wire in dependencies
 * (use cases from the composition root) by passing them into this factory.
 */
export const createGrpcServer = async (): Promise<grpc.Server> => {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  // Untyped descriptor: the starter ships no generated stubs. Generate typed
  // stubs (e.g. with proto-loader-gen-types) and cast this for full type-safety.
  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
  const healthService = protoDescriptor.healthPackage.Health.service

  const server = new grpc.Server()

  server.addService(healthService, {
    check(call: grpc.ServerUnaryCall<unknown, unknown>, callback: grpc.sendUnaryData<unknown>) {
      if (!isAuthorized(call.metadata)) {
        callback(unauthenticated, null)
        return
      }
      logger.debug({ caller: 'grpc.health.check' }, 'gRPC health check called')
      callback(null, { ok: true, message: 'Service is live' })
    },
  })

  return server
}

// ============================================================================
// Lifecycle
// ============================================================================

let grpcServerRunning = false

export const startGrpcServer = (server: grpc.Server): Promise<void> => {
  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${env.GRPC_PORT}`,
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) {
          grpcServerRunning = false
          reject(err)
          return
        }
        grpcServerRunning = true
        logger.info({ caller: 'startGrpcServer', port }, 'gRPC server started')
        resolve()
      },
    )
  })
}

export const isGrpcServerRunning = (): boolean => grpcServerRunning

export const stopGrpcServer = (server: grpc.Server): Promise<void> => {
  return new Promise((resolve) => {
    server.tryShutdown((err) => {
      grpcServerRunning = false
      if (err) {
        logger.error(
          { caller: 'stopGrpcServer', err: err.message },
          'Error shutting down gRPC server',
        )
      }
      resolve()
    })
  })
}
