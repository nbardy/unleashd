import { z } from 'zod';

/** Preserve discriminated variants under an object root instead of flattening them. */
export function mcpObjectInput(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return mcpObjectInput(schema.innerType());
  return schema instanceof z.ZodDiscriminatedUnion
    ? z.object({ command: schema }).strict()
    : schema;
}

export function mcpOperationInput(schema: z.ZodTypeAny, input: unknown): unknown {
  if (schema instanceof z.ZodEffects) return mcpOperationInput(schema.innerType(), input);
  return schema instanceof z.ZodDiscriminatedUnion
    ? z.object({ command: schema }).strict().parse(input).command
    : input;
}

/** Frozen compatibility projection for pre-resource clients. New catalogs never use it. */
export function legacyMcpObjectInput(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodEffects) return legacyMcpObjectInput(schema.innerType());
  if (!(schema instanceof z.ZodDiscriminatedUnion)) return schema;
  const variants = schema.options as z.AnyZodObject[];
  const shape: z.ZodRawShape = {};
  for (const key of new Set(variants.flatMap((variant) => Object.keys(variant.shape)))) {
    const fields = variants.flatMap((variant) =>
      variant.shape[key] ? [variant.shape[key] as z.ZodTypeAny] : []
    );
    const required =
      fields.length === variants.length && fields.every((field) => !field.isOptional());
    const plain = fields.map((field) => {
      let inner = field;
      while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault)
        inner = inner._def.innerType;
      return inner;
    });
    const combined =
      plain.length === 1
        ? plain[0]
        : z.union(plain as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    shape[key] = required ? combined : combined.optional();
  }
  return z.object(shape).strict();
}
