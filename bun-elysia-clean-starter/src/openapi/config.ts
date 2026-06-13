import { env } from "../config/env";

type ServerEntry = { url: string; description: string };

// Server URLs per deployment environment. Replace these with your own hosts.
const DEPLOY_SERVERS = {
  local: { url: `http://localhost:${env.PORT}`, description: "Local" },
  dev: { url: "https://dev-api.example.com", description: "Development" },
  stage: { url: "https://stage-api.example.com", description: "Staging" },
  uat: { url: "https://uat-api.example.com", description: "UAT" },
  prod: { url: "https://api.example.com", description: "Production" },
} satisfies Record<string, ServerEntry>;

// Active server: prefer explicit OPENAPI_SERVER_URL, else fall back by
// DEPLOY_ENV (and finally to the local URL if the env is somehow unmapped).
const activeServer = env.OPENAPI_SERVER_URL
  ? { url: env.OPENAPI_SERVER_URL, description: "API Server" }
  : (DEPLOY_SERVERS[env.DEPLOY_ENV] ?? DEPLOY_SERVERS.local);

const allServers = env.OPENAPI_SERVER_URL
  ? [activeServer]
  : [
      activeServer,
      ...Object.values(DEPLOY_SERVERS).filter(
        (s) => s.url !== activeServer.url,
      ),
    ];

/** OpenAPI documentation configuration (served behind ENABLE_OPENAPI). */
export const openApiConfig = {
  path: "/apidocs",
  documentation: {
    info: {
      title: "Service API",
      version: env.SERVICE_VERSION,
      description: "API documentation for this service",
      contact: { name: "API Support", email: "support@example.com" },
    },
    servers: allServers,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http" as const,
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT authentication token",
        },
      },
    },
    tags: [{ name: "health", description: "Health check endpoints" }],
  },
};
