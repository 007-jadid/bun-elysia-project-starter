// ============================================================================
// Composition Root
// ============================================================================
// The single place where all dependencies are wired together. This is the only
// file that knows about BOTH domain interfaces (ports) and infrastructure
// implementations (adapters) — everything else depends on one side only.
//
// Wiring order follows Clean Architecture:
//   Infrastructure -> Gateways (ports) -> Repositories -> Use Cases
//
// The starter wires nothing. As you add features, register a Mongoose schema
// (infrastructure/db/mongoose/schemas), build a repository
// (infrastructure/repositories), then a use-case group (domain/<feature>/
// usecases/factory), and return the use-case groups here so routes/consumers
// can consume them.

import type { MongoConnection } from './db/mongoose/connect'
// import { createExampleRepository } from './repositories'
// import { createExampleUseCases } from '../domain/example/usecases/factory'

// ============================================================================
// Types
// ============================================================================

export interface CompositionDependencies {
  db: MongoConnection
}

// ============================================================================
// Compose
// ============================================================================

/**
 * Wire all dependencies together and return everything routes / RMQ consumers /
 * gRPC handlers need. Starts empty — add use-case groups as you build features.
 */
export const compose = (deps: CompositionDependencies) => {
  const { db } = deps

  if (!db.client) {
    throw new Error('Mongoose client not initialized.')
  }

  // 1. Register Mongoose models (once, here), e.g.:
  //    const exampleModel = db.client.model<TExampleDocument>('Example', exampleSchema)

  // 2. Repositories (data access), e.g.:
  //    const exampleRepository = createExampleRepository(db)

  // 3. Use cases (wired with the ports/repositories above), e.g.:
  //    const exampleUseCases = createExampleUseCases({ exampleRepository })

  return {
    // exampleUseCases,
  }
}

export type Composed = ReturnType<typeof compose>
