import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi';

// Loose view of the generated document: the typed `PathsObject` union makes
// deep property access awkward, and this test only needs to assert structure.
interface LooseDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<
    string,
    {
      post?: { requestBody?: { content: Record<string, { schema: { $ref?: string } }> } };
      get?: unknown;
    }
  >;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
}

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument() as unknown as LooseDoc;

  it('is an OpenAPI 3 document with info + servers metadata', () => {
    expect(doc.openapi).toMatch(/^3\.0/);
    expect(doc.info.title).toBe('Career OS API');
    expect(doc.info.version).toBeTruthy();
  });

  it('exposes the key paths', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/auth/sign-up',
        '/auth/sign-in',
        '/auth/sign-out',
        '/auth/change-password',
        '/setup/account',
        '/goals',
        '/me/job-preferences',
        '/health',
        '/metrics',
      ]),
    );
  });

  it('registers the shared Zod schemas as components (single source)', () => {
    expect(doc.components.schemas.CreateAccount).toBeDefined();
    expect(doc.components.schemas.SignIn).toBeDefined();
    expect(doc.components.schemas.CareerGoals).toBeDefined();
    expect(doc.components.schemas.JobPreferences).toBeDefined();
    expect(doc.components.schemas.HealthResponse).toBeDefined();
  });

  it('references the shared schema from the sign-in request body', () => {
    const ref =
      doc.paths['/auth/sign-in']?.post?.requestBody?.content['application/json']?.schema.$ref;
    expect(ref).toBe('#/components/schemas/SignIn');
  });

  it('documents the cookie + CSRF auth schemes', () => {
    expect(doc.components.securitySchemes.sessionCookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
    });
    expect(doc.components.securitySchemes.csrfToken).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'x-csrf-token',
    });
  });
});
