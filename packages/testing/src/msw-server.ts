// Shared MSW setup. Individual tests override handlers per-case; this file
// only provides the boilerplate + a default set covering the upstreams the
// app actually talks to, so the common "OK response so nothing 500s" case
// is one import.
//
// Usage:
//   import { createMswServer, defaultHandlers } from '@careeros/testing';
//   const server = createMswServer([...defaultHandlers, http.get('/x', ...)]);
//   beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
//   afterEach(() => server.resetHandlers());
//   afterAll(() => server.close());
import { setupServer } from 'msw/node';
import { http, HttpResponse, type RequestHandler } from 'msw';

export type MswServer = ReturnType<typeof setupServer>;

export function createMswServer(handlers: RequestHandler[] = []): MswServer {
  return setupServer(...handlers);
}

// ponytail: placeholder responses. Any test that cares about the shape of an
// upstream must supply its own handler; these keep the "any hit = 200" cases
// from erroring on onUnhandledRequest: 'error'.
export const defaultHandlers: RequestHandler[] = [
  // GitHub — the two calls the sync worker makes most.
  http.get('https://api.github.com/user', () =>
    HttpResponse.json({ login: 'test-user', id: 1 }),
  ),
  http.get('https://api.github.com/user/repos', () => HttpResponse.json([])),

  // GitLab — public.
  http.get('https://gitlab.com/api/v4/user', () =>
    HttpResponse.json({ id: 1, username: 'test-user' }),
  ),
  http.get('https://gitlab.com/api/v4/personal_access_tokens/self', () =>
    HttpResponse.json({
      scopes: ['read_api', 'read_user', 'read_repository'],
      active: true,
      revoked: false,
      expires_at: null,
    }),
  ),

  // DeepSeek — chat completions stub returning empty content so
  // schema-validated callers hit their zod-error retry path deterministically.
  http.post('https://api.deepseek.com/v1/chat/completions', () =>
    HttpResponse.json({
      id: 'test',
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    }),
  ),

  // OpenAI + Anthropic + OpenRouter — same empty-JSON pattern.
  http.post('https://api.openai.com/v1/chat/completions', () =>
    HttpResponse.json({
      id: 'test',
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    }),
  ),
  http.post('https://api.anthropic.com/v1/messages', () =>
    HttpResponse.json({
      id: 'test',
      content: [{ type: 'text', text: '{}' }],
    }),
  ),
  http.post('https://openrouter.ai/api/v1/chat/completions', () =>
    HttpResponse.json({
      id: 'test',
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    }),
  ),
];
