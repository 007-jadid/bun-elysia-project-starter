// ============================================================================
// Composition Root
// ============================================================================
// The single place where all dependencies are wired together. This is the only
// file that knows about BOTH domain interfaces (ports) and infrastructure
// implementations (adapters) — everything else depends on one side only.
//
// Wiring order follows Clean Architecture:
//   Infrastructure -> Gateways (interfaces) -> Repositories -> Use Cases
//
// As you add features, follow the commented pattern below: build the gateway,
// then the repository (passing write/read DB), then the use-case group (passing
// the repository + any gateways), and return the use-case groups so routes and
// consumers can consume them.

import type { FileStorage } from "../domain/interfaces/file-storage.interface";
import type { RedisReadClient, RedisWriteClient } from "./cache/types";
import type { DbClients } from "./db";
// import { createExampleUseCases } from "../domain/example/usecases/factory";
// import { createExampleRepository } from "./repositories";
import { deleteFile, uploadFile } from "./s3";

// ============================================================================
// Types
// ============================================================================

export interface CompositionDependencies {
  db: DbClients;
  redis: {
    read: RedisReadClient;
    write: RedisWriteClient;
  };
}

// ============================================================================
// Compose
// ============================================================================

/**
 * Wire all dependencies together and return everything routes / RMQ consumers
 * need. Starts empty — add use-case groups as you build features.
 */
export const compose = (deps: CompositionDependencies) => {
  // Pull these out as you start wiring repositories / use cases:
  //   const { writeDb, readDb } = deps.db;
  //   const { read: redisRead, write: redisWrite } = deps.redis;
  void deps;

  // 1. Service gateways (implement domain interfaces / ports).
  const fileStorage: FileStorage = { upload: uploadFile, remove: deleteFile };

  // 2. Repositories (data access) — pass write + read DB clients.
  //    const exampleRepository = createExampleRepository(writeDb, readDb);

  // 3. Use cases (wired with the ports / repositories above).
  //    const exampleUseCases = createExampleUseCases({ exampleRepository });

  return {
    // Gateways available to routes that need them. The generic upload route
    // uses infrastructure/s3 directly, so this only demonstrates the wiring
    // point — remove it once you wire real use-case groups.
    fileStorage,

    // exampleUseCases,
  };
};

export type Composed = ReturnType<typeof compose>;
