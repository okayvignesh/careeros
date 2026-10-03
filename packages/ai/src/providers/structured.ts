import { ZodError, type z } from 'zod';
import { StructuredOutputError } from '../errors';
import type { ChatMessage } from '../provider';

// Shared JSON-schema-output plumbing for adapters whose response shape is
// provider-specific (OpenAI-style choices vs Ollama's native /api/chat). The
// retry contract is identical everywhere: parse+validate, and on a Zod or
// JSON syntax failure re-ask exactly once with the schema error attached.

/** Human-readable message from a Zod or JSON.parse failure. */
export function schemaErrorMessage(err: unknown): string {
  return err instanceof ZodError ? err.message : String((err as Error).message);
}

/** True for the two errors the single retry is designed to recover from. */
export function isSchemaParseFailure(err: unknown): boolean {
  return err instanceof ZodError || err instanceof SyntaxError;
}

/** JSON.parse + Zod validate. Throws the raw error so the caller can retry. */
export function parseStructured<S extends z.ZodTypeAny>(schema: S, raw: string): z.output<S> {
  return schema.parse(JSON.parse(raw)) as z.output<S>;
}

/** The one-shot corrective turn appended after a failed validation. */
export function structuredRetryMessages(
  messages: ChatMessage[],
  raw: string,
  schemaError: string,
): ChatMessage[] {
  return [
    ...messages,
    { role: 'assistant', content: raw },
    {
      role: 'user',
      content: `Previous response failed schema validation. Return valid JSON only. <schema-error>${schemaError}</schema-error>`,
    },
  ];
}

/** Terminal error after the retry also failed to validate. */
export function structuredFailure(err: unknown): StructuredOutputError {
  return new StructuredOutputError(schemaErrorMessage(err));
}
