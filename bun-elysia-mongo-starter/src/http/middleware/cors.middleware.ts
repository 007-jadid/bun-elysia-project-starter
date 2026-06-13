import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'

// Behind API gateway — gateway enforces CORS for public traffic.
// This service uses wildcard to allow Swagger UI "Try it out" in all environments.
export const corsMiddleware = new Elysia({ name: 'cors-middleware' }).use(
  cors({
    origin: '*',
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
)
