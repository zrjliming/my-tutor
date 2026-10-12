import { z, type ZodType } from 'zod'

export function toJsonSchema(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>
  delete js.$schema
  return js
}
