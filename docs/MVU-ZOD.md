# MVU Zod 4 authoring contract

This is the repository's new-MVU-card contract, based on pinned MVU, StageDog templates, and registerMvuSchema. Separate runtime behavior, repository conventions, and optional design; a template preference is not a Zod API limitation.

## Separate structure and registration

Src/schema.ts exports Schema and contains no host access, event subscriptions, variable mutation, or registration. A separate script imports it and registers; the framework loader is separate. Bundle custom structure into that script and retain declared pinned framework/adapter URLs.

Use Tavern Helper's global Zod 4 z at runtime, matching the adapter. The pinned adapter inspects ZodObject and builds looseObject(shape). Cross-copy instanceof behavior does not guarantee compatible internal versions; do not bundle a second Zod runtime. Trusted local tests explicitly supply the same Zod 4 instance. Type-only imports do not become runtime imports.

There are no upstream webpack auto-imports or automatic schema.json generation here. JSON Schema is an editor projection, not runtime truth/registration. Never execute arbitrary imported schemas during card check to regenerate it.

## Idempotent parsing

Schema.parse(Schema.parse(input)) must equal the first result. Updates/reads/normalization may parse repeatedly. Transforms may normalize current values or compute derived fields, but must not increment scores, charge money, randomize, or refresh time on every parse. A genuinely needed creation timestamp is initialized only when missing and preserved afterward.

| Need | Preferred structure |
| --- | --- |
| number | z.coerce.number(), with explicit decisions about finite values, empty strings, and null |
| boolean | z.boolean(); coerce.boolean would treat the string false as true |
| fixed heterogeneous fields | z.object |
| required fixed homogeneous keys | z.record(z.enum([...]), ValueSchema) |
| optional fixed homogeneous keys | z.partialRecord(z.enum([...]), ValueSchema) |
| dynamic item/task names | z.record(z.string(), ItemSchema) |
| ordered/repeated sequence | z.array, with deliberate index/delete rules |

Zod 4 record takes key and value schemas. Enum-key records enforce completeness; partialRecord permits missing keys. Arrays are allowed when appropriate; inventory maps are often easier.

## Prefault and required facts

Prefault supplies default input that still goes through validation/transforms. Default supplies an output directly for undefined and can bypass transforms. Optional permits undefined rather than restoring an empty object. Missing required facts should fail rather than becoming invented events.

For a clearable object, both its fields and outer object need valid prefaults:

```ts
export const Schema = z.object({
  scene: z.object({ location: z.string(), phase: z.string() }),
  character: z.object({
    mood: z.string().prefault('calm'),
    trust: z.coerce.number().prefault(0),
  }).prefault({}),
  inventory: z.record(z.string(), z.object({
    description: z.string(), quantity: z.coerce.number(),
  })).prefault({}),
});
```

Scene intentionally remains required; character/inventory can recover defaults. This is an independent example, not a replacement for another card's structure. Extend object schemas before wrapping them in prefault/transform.

Use clamping, rounding, truncation, or record caps only when the card explicitly needs them. A per-round change limit needs previous state and belongs in update events/rules rather than a new-value-only schema. Do not invent affinity/inventory limits.

## Derived values

Recompute a derived field in the object holding its inputs:

```ts
z.object({
  trust: z.coerce.number(),
  _relationship: z.string().prefault('unfamiliar'),
}).transform(data => ({
  ...data,
  _relationship: data.trust >= 60 ? 'familiar' : 'unfamiliar',
}))
```

The threshold is illustrative. The model updates trust, not _relationship. Initialization may provide it or let prefault/transform fill it. Do not maintain the same derived value independently in another script. Cross-state/external-event dependencies instead need VARIABLE_UPDATE_ENDED; persistent event fields must still be declared in Schema.

## Adapter behavior and migration risks

Pinned tavern-resource/util/mvu_zod.ts converts a top-level raw ZodObject into looseObject(shape). Nested ordinary objects still strip unknown keys. A wrapped root may not take that branch; choose and test deliberately. If present, registerVariableSchema also receives { stat_data: Schema }.

The adapter subscribes to initialization, executes each update command, safeParses full state, skips failed commands, clears MVU's original command queue to avoid duplicate application, and cleans deprecated display_data/delta_data afterward. Nested schema changes can delete old fields: compare parsed saved state during migration. Direct UI/helper writes are not automatically equivalent to model patch validation.

Registration must subscribe early enough for initialization, unlike consumers that wait for Mvu before API use. Verify actual host timing. Underscore-prefixed command path segments receive read-only handling, but parent replacement, inserted keys, and direct script writes are not a complete permission boundary. Dollar-prefix fields do not have the same guaranteed protection in this adapter.

## Style versus API facts

Use prefault, numerical coercion, idempotent transforms, records for dynamic objects, useful descriptions only, and separate side effects/registration. Reusable local schemas are allowed when they prevent real duplication. Claims that transform context, strictness, or passthrough features never exist are not complete Zod 4 API facts. Consult [Zod API documentation](https://zod.dev/api) when needed rather than treating template preferences as syntax errors.

## Meaningful verification

Execute only reviewed trusted Schema code. Cover initial values, number conversion/bounds, missing required fields, clearable containers, dynamic insert/remove, unknown-field retention/stripping, repeated parse, and valid intermediate patch states. The repository template tests compile reviewed sources with esbuild, provide locked z, and compare input JSON Schema projections. A vm is not a safe sandbox for untrusted code.

Check the final registration bundle includes Schema and fixed adapter import without another Zod runtime. In the real host, verify new starts, updates, swipe/regeneration, and UI reads. Static checks only parse/compile arbitrary card sources. Pins/hashes are in maintenance/references.lock.json; relevant sources include tavern-resource/util/mvu_zod.ts and mvu/src/function/update_variables.ts.
