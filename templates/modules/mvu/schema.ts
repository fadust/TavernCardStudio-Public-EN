import type { z as zod } from 'zod';

// Source schema. Use Tavern Helper's built-in global z at runtime,
// the same instance used by registerMvuSchema's instanceof / looseObject checks. It must exist at import time.
// Import only types here; do not import a separate runtime Zod instance.
declare const z: typeof zod;

const clampTrust = (value: number) => Math.min(100, Math.max(0, value));

// Export a side-effect-free schema: parsing its output again produces the same result.
export const Schema = z
  .object({
    scene: z
      .object({
        location: z.string().prefault('Opening scene'),
        phase: z.string().prefault('Opening'),
      })
      .prefault({}),
    character: z
      .object({
        mood: z.string().prefault('Calm'),
        trust: z.coerce.number().transform(clampTrust).meta({ minimum: 0, maximum: 100 }).prefault(0),
      })
      .prefault({}),
  })
  .meta({
    title: 'MVU variable schema (schema.json is its projection)',
    description: 'This file is the source schema, registered at runtime through registerMvuSchema; src/variables/schema.json is its z.toJSONSchema(Schema, { io: "input" }) projection for readers and editors.',
  });

export type Schema = zod.output<typeof Schema>;
