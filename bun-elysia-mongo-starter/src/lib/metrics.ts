import { heapStats, memoryUsage as jscMemoryUsage } from 'bun:jsc'
import { cpus, freemem, totalmem } from 'node:os'
import { type Counter, type Histogram, type Meter, metrics } from '@opentelemetry/api'
import { env } from '../config/env'

/**
 * OpenTelemetry Metrics instrumentation for this service.
 *
 * Uses lazy initialization to ensure the meter is created AFTER the SDK
 * registers the global MeterProvider (via sdk.start()). Without this,
 * metrics.getMeter() returns a NoopMeter and all data is silently discarded.
 */

// ============================================================================
// Lazy Meter — initialized on first use (after SDK start)
// ============================================================================

let _meter: Meter | null = null

function getMeter(): Meter {
  if (!_meter) {
    _meter = metrics.getMeter(env.SERVICE_NAME, env.SERVICE_VERSION)
  }
  return _meter
}

// ============================================================================
// Lazy Instrument Cache
// ============================================================================

let _dbQueryCounter: Counter | null = null
let _dbQueryDuration: Histogram | null = null
let _dbErrorCounter: Counter | null = null
let _cacheHitCounter: Counter | null = null
let _cacheMissCounter: Counter | null = null
let _cacheOperationDuration: Histogram | null = null
let _rmqPublishCounter: Counter | null = null
let _rmqPublishDuration: Histogram | null = null
let _rmqErrorCounter: Counter | null = null
let _grpcCallCounter: Counter | null = null
let _grpcCallDuration: Histogram | null = null
let _grpcErrorCounter: Counter | null = null
let _httpCallCounter: Counter | null = null
let _httpCallDuration: Histogram | null = null
let _httpErrorCounter: Counter | null = null

// Database
export const dbQueryCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _dbQueryCounter ??= getMeter().createCounter('db_queries_total', {
      description: 'Total number of database queries',
    })
    _dbQueryCounter.add(...args)
  },
}

export const dbQueryDuration = {
  record: (...args: Parameters<Histogram['record']>) => {
    _dbQueryDuration ??= getMeter().createHistogram('db_query_duration_seconds', {
      description: 'Database query duration in seconds',
      unit: 'seconds',
    })
    _dbQueryDuration.record(...args)
  },
}

export const dbErrorCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _dbErrorCounter ??= getMeter().createCounter('db_errors_total', {
      description: 'Total number of database errors',
    })
    _dbErrorCounter.add(...args)
  },
}

// Cache
export const cacheHitCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _cacheHitCounter ??= getMeter().createCounter('cache_hits_total', {
      description: 'Total number of cache hits',
    })
    _cacheHitCounter.add(...args)
  },
}

export const cacheMissCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _cacheMissCounter ??= getMeter().createCounter('cache_misses_total', {
      description: 'Total number of cache misses',
    })
    _cacheMissCounter.add(...args)
  },
}

export const cacheOperationDuration = {
  record: (...args: Parameters<Histogram['record']>) => {
    _cacheOperationDuration ??= getMeter().createHistogram('cache_operation_duration_seconds', {
      description: 'Cache operation duration in seconds',
      unit: 'seconds',
    })
    _cacheOperationDuration.record(...args)
  },
}

// RabbitMQ
export const rmqPublishCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _rmqPublishCounter ??= getMeter().createCounter('rmq_messages_published_total', {
      description: 'Total number of RabbitMQ messages published',
    })
    _rmqPublishCounter.add(...args)
  },
}

export const rmqPublishDuration = {
  record: (...args: Parameters<Histogram['record']>) => {
    _rmqPublishDuration ??= getMeter().createHistogram('rmq_publish_duration_seconds', {
      description: 'RabbitMQ publish duration in seconds',
      unit: 'seconds',
    })
    _rmqPublishDuration.record(...args)
  },
}

export const rmqErrorCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _rmqErrorCounter ??= getMeter().createCounter('rmq_errors_total', {
      description: 'Total number of RabbitMQ errors',
    })
    _rmqErrorCounter.add(...args)
  },
}

// gRPC
export const grpcCallCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _grpcCallCounter ??= getMeter().createCounter('grpc_calls_total', {
      description: 'Total number of gRPC calls',
    })
    _grpcCallCounter.add(...args)
  },
}

export const grpcCallDuration = {
  record: (...args: Parameters<Histogram['record']>) => {
    _grpcCallDuration ??= getMeter().createHistogram('grpc_call_duration_seconds', {
      description: 'gRPC call duration in seconds',
      unit: 'seconds',
    })
    _grpcCallDuration.record(...args)
  },
}

export const grpcErrorCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _grpcErrorCounter ??= getMeter().createCounter('grpc_errors_total', {
      description: 'Total number of gRPC errors',
    })
    _grpcErrorCounter.add(...args)
  },
}

// External HTTP
export const httpCallCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _httpCallCounter ??= getMeter().createCounter('http_outbound_calls_total', {
      description: 'Total number of outbound HTTP calls',
    })
    _httpCallCounter.add(...args)
  },
}

export const httpCallDuration = {
  record: (...args: Parameters<Histogram['record']>) => {
    _httpCallDuration ??= getMeter().createHistogram('http_outbound_call_duration_seconds', {
      description: 'Outbound HTTP call duration in seconds',
      unit: 'seconds',
    })
    _httpCallDuration.record(...args)
  },
}

export const httpErrorCounter = {
  add: (...args: Parameters<Counter['add']>) => {
    _httpErrorCounter ??= getMeter().createCounter('http_outbound_errors_total', {
      description: 'Total number of outbound HTTP errors',
    })
    _httpErrorCounter.add(...args)
  },
}

// ============================================================================
// System Metrics — registered after SDK init
// ============================================================================

let _systemMetricsRegistered = false

/**
 * Call this AFTER the OTEL SDK has started to register system metric observables.
 * Uses Bun-native APIs: bun:jsc (JSC heap/memory), process.cpuUsage(), node:os.
 */
export const registerSystemMetrics = () => {
  if (_systemMetricsRegistered) return
  _systemMetricsRegistered = true

  const meter = getMeter()

  // -- Process memory (RSS) --------------------------------------------------
  const processMemoryRss = meter.createObservableGauge('process.memory.rss', {
    description: 'Resident set size in bytes',
    unit: 'By',
  })

  // -- JSC heap (bun:jsc heapStats) ------------------------------------------
  const jscHeapSize = meter.createObservableGauge('runtime.jsc.heap.size', {
    description: 'JSC heap size in bytes',
    unit: 'By',
  })
  const jscHeapCapacity = meter.createObservableGauge('runtime.jsc.heap.capacity', {
    description: 'JSC heap capacity in bytes',
    unit: 'By',
  })
  const jscExtraMemory = meter.createObservableGauge('runtime.jsc.extra_memory.size', {
    description: 'JSC extra (non-heap) memory in bytes',
    unit: 'By',
  })
  const jscObjectCount = meter.createObservableGauge('runtime.jsc.object.count', {
    description: 'Total live JSC objects',
  })

  // -- JSC memory (bun:jsc memoryUsage) --------------------------------------
  const jscMemoryCurrent = meter.createObservableGauge('runtime.jsc.memory.current', {
    description: 'Current JSC memory usage in bytes',
    unit: 'By',
  })
  const jscMemoryPeak = meter.createObservableGauge('runtime.jsc.memory.peak', {
    description: 'Peak JSC memory usage in bytes',
    unit: 'By',
  })

  // -- CPU -------------------------------------------------------------------
  const processCpuUserTime = meter.createObservableCounter('process.cpu.user', {
    description: 'Total user CPU time in seconds',
    unit: 's',
  })
  const processCpuSystemTime = meter.createObservableCounter('process.cpu.system', {
    description: 'Total system CPU time in seconds',
    unit: 's',
  })
  const systemCpuCount = meter.createObservableGauge('system.cpu.count', {
    description: 'Number of logical CPUs',
  })

  // -- System memory ---------------------------------------------------------
  const systemMemoryTotal = meter.createObservableGauge('system.memory.total', {
    description: 'Total system memory in bytes',
    unit: 'By',
  })
  const systemMemoryFree = meter.createObservableGauge('system.memory.free', {
    description: 'Free system memory in bytes',
    unit: 'By',
  })
  const systemMemoryUsed = meter.createObservableGauge('system.memory.used', {
    description: 'Used system memory in bytes',
    unit: 'By',
  })

  // -- Uptime ----------------------------------------------------------------
  const processUptime = meter.createObservableGauge('process.uptime', {
    description: 'Process uptime in seconds',
    unit: 's',
  })

  meter.addBatchObservableCallback(
    (observer) => {
      // Process RSS
      observer.observe(processMemoryRss, process.memoryUsage().rss)

      // JSC heap (bun:jsc)
      const heap = heapStats()
      observer.observe(jscHeapSize, heap.heapSize)
      observer.observe(jscHeapCapacity, heap.heapCapacity)
      observer.observe(jscExtraMemory, heap.extraMemorySize)
      observer.observe(jscObjectCount, heap.objectCount)

      // JSC memory (bun:jsc)
      const jscMem = jscMemoryUsage()
      observer.observe(jscMemoryCurrent, jscMem.current)
      observer.observe(jscMemoryPeak, jscMem.peak)

      // CPU
      const cpu = process.cpuUsage()
      observer.observe(processCpuUserTime, cpu.user / 1e6)
      observer.observe(processCpuSystemTime, cpu.system / 1e6)
      observer.observe(systemCpuCount, cpus().length)

      // System memory
      const total = totalmem()
      const free = freemem()
      observer.observe(systemMemoryTotal, total)
      observer.observe(systemMemoryFree, free)
      observer.observe(systemMemoryUsed, total - free)

      // Uptime
      observer.observe(processUptime, process.uptime())
    },
    [
      processMemoryRss,
      jscHeapSize,
      jscHeapCapacity,
      jscExtraMemory,
      jscObjectCount,
      jscMemoryCurrent,
      jscMemoryPeak,
      processCpuUserTime,
      processCpuSystemTime,
      systemCpuCount,
      systemMemoryTotal,
      systemMemoryFree,
      systemMemoryUsed,
      processUptime,
    ],
  )
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Record a database query with automatic metric collection
 */
export const recordDbQuery = (params: {
  operation: string
  duration: number
  success: boolean
}) => {
  const { operation, duration, success } = params

  const attributes = {
    operation,
    success: success.toString(),
  }

  dbQueryCounter.add(1, attributes)
  dbQueryDuration.record(duration / 1000, attributes) // Convert ms to seconds

  if (!success) {
    dbErrorCounter.add(1, attributes)
  }
}

/**
 * Record cache operation with automatic metric collection
 */
export const recordCacheOperation = (params: {
  operation: string
  hit?: boolean
  duration: number
}) => {
  const { operation, hit, duration } = params

  const attributes = { operation }

  if (hit !== undefined) {
    if (hit) {
      cacheHitCounter.add(1, attributes)
    } else {
      cacheMissCounter.add(1, attributes)
    }
  }

  cacheOperationDuration.record(duration / 1000, attributes)
}
