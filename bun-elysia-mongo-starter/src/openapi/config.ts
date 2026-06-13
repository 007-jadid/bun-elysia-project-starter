import { z } from 'zod'
import { env } from '../config/env'

const envLabels: Record<string, string> = {
  local: 'Local',
  dev: 'Development',
  stage: 'Staging',
  uat: 'UAT',
  production: 'Production',
}

/**
 * OpenAPI documentation configuration
 */
export const openApiConfig = {
  path: '/apidocs',
  mapJsonSchema: {
    zod: (schema: Parameters<typeof z.toJSONSchema>[0]) => {
      // Strip $schema field — it's Draft 2020-12 and not valid in OpenAPI 3.0,
      // which causes Scalar to silently fail rendering the body schema.
      const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
      return rest
    },
  },
  documentation: {
    info: {
      title: 'Service API',
      version: env.SERVICE_VERSION,
      description: 'API documentation for this service',
      contact: {
        name: 'API Support',
        email: 'support@example.com',
      },
    },

    servers: [
      {
        url: env.OPENAPI_SERVER_URL,
        description: envLabels[env.DEPLOY_ENV],
      },
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http' as const,
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token',
        },
      },
    },

    tags: [
      {
        name: 'Health (Public)',
        description: 'Health check endpoints — no authentication required',
      },
      // Add a tag per feature group as you build routes, e.g.:
      // { name: 'Example (Auth)', description: 'Example endpoints — requires auth' },
    ],
  },
}
