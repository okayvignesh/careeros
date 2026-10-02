import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  CareerGoalsSchema,
  CreateAccountSchema,
  JobPreferencesInputSchema,
  SignInSchema,
} from '@careeros/shared';
import { z } from 'zod';

// AGENTS.md §6 / plan/phase-0-install.md: OpenAPI JSON at /api/openapi.json,
// Swagger UI at /api/docs. `zod-to-openapi` reads the SAME Zod objects the
// Nest `ZodValidationPipe` validates with, so request/response schemas are
// never re-declared as DTO classes.
//
// `extendZodWithOpenApi` patches the Zod prototypes with `.openapi()`. Call it
// exactly once, before any schema is registered. The mutation only attaches
// documentation metadata; `schema.parse()` is unaffected.
extendZodWithOpenApi(z);

/** Path passed to `SwaggerModule.setup` (no leading slash). */
export const SWAGGER_UI_PATH = 'api/docs';
/** Path for the raw OpenAPI 3 document (no leading slash). */
export const OPENAPI_JSON_PATH = 'api/openapi.json';
/** Express mount points, one leading slash so `app.use` / `httpAdapter.get` match. */
export const SWAGGER_UI_ROUTE = `/${SWAGGER_UI_PATH}`;
export const OPENAPI_JSON_ROUTE = `/${OPENAPI_JSON_PATH}`;

// Public prefix the reverse proxy maps onto the API service; this is the URL
// contract in AGENTS.md §6, so it is what docs consumers should call.
const PUBLIC_PREFIX = '/api';

// Session/CSRF cookie names track session.service.ts: the `__Host-` prefix is
// production-only (Secure + Path=/ required by the browser).
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = IS_PROD ? '__Host-careeros_session' : 'careeros_session';
const CSRF_COOKIE = IS_PROD ? '__Host-careeros_csrf' : 'careeros_csrf';

// Reusable response shapes that are NOT already Zod schemas in
// packages/shared (controller return types / inline bodies). Documented here
// once so multiple operations can reference the same component.
const AuthUserSchema = z.object({ id: z.string(), email: z.string() });
const SessionProbeSchema = z.union([
  z.object({ userId: z.string(), expiresAt: z.number() }),
  z.null(),
]);
const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});
const HealthCheckSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  error: z.string().optional(),
  detail: z.string().optional(),
});
const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptimeS: z.number(),
  checks: z.record(HealthCheckSchema),
});

function json(schema: z.ZodTypeAny) {
  return { content: { 'application/json': { schema } } };
}

/**
 * Build the OpenAPI 3 document from the shared Zod schemas.
 *
 * Exported (not just assembled in main.ts) so a unit test can assert the
 * generated paths/components without booting the whole Nest app.
 */
export function buildOpenApiDocument(): OpenAPIObject {
  const registry = new OpenAPIRegistry();

  // ---- Components (single source: packages/shared) ----
  // `register` returns a ref-tagged clone; use the returned object everywhere
  // it is referenced so paths emit `$ref` instead of inlining the schema.
  const CreateAccount = registry.register('CreateAccount', CreateAccountSchema);
  const SignIn = registry.register('SignIn', SignInSchema);
  const CareerGoals = registry.register('CareerGoals', CareerGoalsSchema);
  const JobPreferences = registry.register('JobPreferences', JobPreferencesInputSchema);
  const AuthUser = registry.register('AuthUser', AuthUserSchema);
  const SessionProbe = registry.register('SessionProbe', SessionProbeSchema);
  const HealthResponse = registry.register('HealthResponse', HealthResponseSchema);

  // ---- Auth scheme ----
  // Session cookie is httpOnly; the double-submit CSRF token is readable by
  // the SPA and echoed in `x-csrf-token` on every mutation (security.md item 2).
  registry.registerComponent('securitySchemes', 'sessionCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: SESSION_COOKIE,
    description:
      'Sealed iron-session cookie. In production the `__Host-` prefix is used (Secure, Path=/).',
  });
  registry.registerComponent('securitySchemes', 'csrfToken', {
    type: 'apiKey',
    in: 'header',
    name: 'x-csrf-token',
    description: `Double-submit token minted alongside the session cookie (${CSRF_COOKIE}). Required on every authenticated non-GET request.`,
  });

  // Session cookie AND CSRF token (multiple schemes in one object = AND).
  const authed = [{ sessionCookie: [], csrfToken: [] }];

  // ---- Auth ----
  registry.registerPath({
    method: 'post',
    path: '/auth/sign-up',
    tags: ['auth'],
    summary: 'Create the first account',
    description:
      'Single-user setup path. Returns a sealed session cookie; subsequent mutations must echo the CSRF cookie in `x-csrf-token`.',
    security: [],
    request: { body: json(CreateAccount) },
    responses: {
      201: { description: 'Account created', ...json(AuthUser) },
      409: { description: 'Account already exists' },
      429: { description: 'Rate limited (Retry-After header set)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/sign-in',
    tags: ['auth'],
    summary: 'Sign in with email + password',
    security: [],
    request: { body: json(SignIn) },
    responses: {
      200: { description: 'Signed in', ...json(AuthUser) },
      401: { description: 'Invalid credentials' },
      429: { description: 'Locked out (Retry-After header set)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/sign-out',
    tags: ['auth'],
    summary: 'Clear the session cookies',
    security: authed,
    responses: { 204: { description: 'Signed out' } },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/me',
    tags: ['auth'],
    summary: 'Read the current session, if any',
    security: authed,
    responses: { 200: { description: 'Session or null', ...json(SessionProbe) } },
  });

  registry.registerPath({
    method: 'post',
    path: '/auth/change-password',
    tags: ['auth'],
    summary: 'Change the password and revoke all sessions',
    security: authed,
    request: { body: json(ChangePasswordSchema) },
    responses: {
      204: { description: 'Password changed; all sessions revoked' },
      401: { description: 'Not signed in' },
    },
  });

  // ---- Setup ----
  registry.registerPath({
    method: 'post',
    path: '/setup/account',
    tags: ['setup'],
    summary: 'Create the first account via the setup wizard',
    security: [],
    request: { body: json(CreateAccount) },
    responses: {
      201: { description: 'Account created', ...json(AuthUser) },
      403: { description: 'Setup already completed' },
      429: { description: 'Rate limited (Retry-After header set)' },
    },
  });

  // ---- Goals / preferences (representative authenticated writes) ----
  registry.registerPath({
    method: 'post',
    path: '/goals',
    tags: ['goals'],
    summary: 'Save career goals',
    security: authed,
    request: { body: json(CareerGoals) },
    responses: {
      201: { description: 'Goals saved' },
      400: { description: 'Invalid input (Zod issues)' },
      401: { description: 'Not signed in' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/me/job-preferences',
    tags: ['preferences'],
    summary: 'Upsert job-search preferences',
    security: authed,
    request: { body: json(JobPreferences) },
    responses: {
      200: { description: 'Preferences saved' },
      400: { description: 'Invalid input (Zod issues)' },
      401: { description: 'Not signed in' },
    },
  });

  // ---- Observability (deliberately unauthenticated) ----
  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['observability'],
    summary: 'Dependency health (5s cache)',
    security: [],
    responses: { 200: { description: 'Health snapshot', ...json(HealthResponse) } },
  });

  registry.registerPath({
    method: 'get',
    path: '/metrics',
    tags: ['observability'],
    summary: 'Prometheus scrape endpoint',
    description:
      'Unauthenticated by design: Prometheus scrapes anonymously and network ACLs gate it. Throttled to 10 req/min.',
    security: [],
    request: { query: z.object({ format: z.enum(['json']).optional() }) },
    responses: {
      200: {
        description: 'Prometheus text exposition, or a JSON dump with `?format=json`',
        content: {
          'text/plain': { schema: z.string() },
          'application/json': { schema: z.array(z.unknown()) },
        },
      },
      429: { description: 'Rate limited' },
    },
  });

  // zod-to-openapi emits its own openapi3-ts OpenAPIObject; Nest types the
  // same shape with `exactOptionalPropertyTypes`, so bridge at the boundary.
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Career OS API',
      version: process.env.APP_VERSION ?? '0.0.1',
      description:
        'NestJS API. Authenticated mutating requests need both the session cookie and the `x-csrf-token` header (double-submit). Schemas are generated from the shared Zod definitions in `@careeros/shared`.',
    },
    servers: [{ url: PUBLIC_PREFIX, description: 'Public prefix (reverse proxy → api service)' }],
    tags: [
      { name: 'auth', description: 'Session + password endpoints' },
      { name: 'setup', description: 'First-run setup wizard' },
      { name: 'goals', description: 'Career goals' },
      { name: 'preferences', description: 'Job-search preferences' },
      { name: 'observability', description: 'Health + Prometheus metrics' },
    ],
  }) as unknown as OpenAPIObject;
}
