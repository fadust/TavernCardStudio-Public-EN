import type { z as zod } from 'zod';

// Source schema. Use Tavern Helper's built-in global z at runtime,
// the same instance used by registerMvuSchema's instanceof / looseObject checks. It must exist at import time.
// Import only types here; do not import a separate runtime Zod instance.
declare const z: typeof zod;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const clues = z.object({
  status: z.enum(['Pending', 'Verified', 'RuledOut']).prefault('Pending'),
  description: z.string().prefault(''),
});

const people = z.object({
  stance: z.enum(['Partner', 'Cooperative', 'Neutral', 'Evasive', 'Hostile', 'Unknown']).prefault('Unknown'),
  trust: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(0),
  notes: z.string().prefault(''),
});

const evidence = z.object({
  description: z.string().prefault(''),
  quantity: z.coerce.number().int().nonnegative().prefault(1),
});

// _progress is derived on every parse from current clues; the model must not write update rules for it.
function summarizeProgress(clues: Record<string, { status?: string }>) {
  const list = Object.values(clues ?? {});
  if (list.length === 0) return 'No records yet';
  const Verified = list.filter(item => item?.status === 'Verified').length;
  const RuledOut = list.filter(item => item?.status === 'RuledOut').length;
  return `Pending ${list.length - Verified - RuledOut} · Verified ${Verified} · RuledOut ${RuledOut}`;
}

export const Schema = z
  .object({
    fogharbor: z
      .object({
        timeOfDay: z.string().prefault('Evening'),
        weather: z.string().prefault('Dense fog'),
        fogDensity: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(45),
      })
      .prefault({}),
    bureau: z
      .object({
        caseFile: z
          .object({
            id: z.string().prefault('Unassigned'),
            name: z.string().prefault('No active case'),
            phase: z.enum(['Standby', 'Intake', 'Inspection', 'Verification', 'Closed']).prefault('Standby'),
          })
          .prefault({}),
        clues: z.record(z.string().describe('Clue name'), clues).prefault({}),
        people: z.record(z.string().describe('Person name'), people).prefault({}),
        evidence: z.record(z.string().describe('Evidence name'), evidence).prefault({}),
        _progress: z.string().prefault('No records yet'),
      })
      .transform(data => ({ ...data, _progress: summarizeProgress(data.clues) }))
      .prefault({}),
    investigator: z
      .object({
        energy: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(80),
        clearance: z.enum(['Trainee', 'Officer', 'Special']).prefault('Trainee'),
        renown: z.coerce.number().transform(clampPercent).meta({ minimum: 0, maximum: 100 }).prefault(20),
      })
      .prefault({}),
  })
  .meta({
    title: 'Fogharbor Bureau variable schema (schema.json is its projection)',
    description:
      'This file is the source schema registered through registerMvuSchema; src/variables/schema.json is a reference projection for readers and editors, not runtime validation.',
  });

export type Schema = zod.output<typeof Schema>;
