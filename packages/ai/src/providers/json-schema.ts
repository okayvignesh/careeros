import type { z } from 'zod';

// Minimal Zod → JSON-Schema converter for the object/primitive subset our
// prompt schemas use. Returns null (never throws) when it meets a construct it
// cannot represent faithfully, so callers degrade to `response_format:
// json_object` instead of shipping a wrong schema upstream.

interface ZodDef {
  typeName?: string;
  shape?: () => Record<string, z.ZodTypeAny>;
  type?: z.ZodTypeAny;
  values?: string[];
  value?: unknown;
  innerType?: z.ZodTypeAny;
  options?: z.ZodTypeAny[];
  valueType?: z.ZodTypeAny;
  checks?: Array<{ kind: string; value?: number }>;
  schema?: z.ZodTypeAny;
}

function defOf(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const t = defOf(schema).typeName;
  return t === 'ZodOptional' || t === 'ZodDefault';
}

function required(schema: z.ZodTypeAny | undefined): z.ZodTypeAny {
  if (!schema) throw new Error('zod node has no inner type');
  return schema;
}

function convert(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = defOf(schema);
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const requiredKeys: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!isOptional(value)) requiredKeys.push(key);
      }
      return { type: 'object', properties, required: requiredKeys, additionalProperties: false };
    }
    case 'ZodArray':
      return { type: 'array', items: convert(required(def.type)) };
    case 'ZodString': {
      const out: Record<string, unknown> = { type: 'string' };
      for (const check of def.checks ?? []) {
        if (check.kind === 'min' && typeof check.value === 'number') out['minLength'] = check.value;
        if (check.kind === 'max' && typeof check.value === 'number') out['maxLength'] = check.value;
      }
      return out;
    }
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values ?? [] };
    case 'ZodLiteral':
      return { const: def.value };
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodEffects':
    case 'ZodBranded':
    case 'ZodCatch':
      return convert(required(def.innerType ?? def.schema));
    case 'ZodUnion':
      return { anyOf: (def.options ?? []).map(convert) };
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: def.valueType ? convert(def.valueType) : true,
      };
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    case 'ZodDate':
      return { type: 'string', format: 'date-time' };
    default:
      throw new Error(`unsupported zod type ${def.typeName ?? 'unknown'}`);
  }
}

/**
 * Convert a Zod schema to a JSON-Schema object suitable for a provider's
 * structured-output mode. `null` means "not faithfully representable → use
 * bare JSON mode + Zod validation + retry".
 */
export function zodToJsonSchemaObject(schema: z.ZodTypeAny): Record<string, unknown> | null {
  try {
    return convert(schema);
  } catch {
    return null;
  }
}
