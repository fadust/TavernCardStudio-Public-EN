# MVU template evidence

Internal maintenance notes; this file is not packaged into cards. Source and artifacts were compared read-only on 2026-09-18 UTC. No remote card script, third-party script, or built artifact was executed.

## Pinned dependencies

- MVU framework: `https://cdn.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate@3377b494cd7277230f3056230062124fe117f93f/artifact/bundle.js`.
- Official registration helper: `https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@69abb272d46bed4057a0dfb31758f6164cb7ecef/dist/util/mvu_zod.js`. SHA-256: `78c40f52d81022d9d769a923a49e673b8babb562656051a7d0410b6b19f45184`.

At the comparison date, the helper matched the floating URL and tag v0.3.451. Its source is `util/mvu_zod.ts`, outside `src/`. Cards use only commit-pinned URLs; equivalence with a floating URL is not a continuing guarantee.

## Registration timing

The upstream template and official skill call `$(() => registerMvuSchema(Schema))` immediately after import. The template follows that pattern.

The helper subscribes synchronously when called and immediately invokes `registerVariableSchema`. MVU initializes variables on load, `GENERATION_STARTED`, and `MESSAGE_SENT`; first-message initialization emits `mag_variable_initialized`.

Do not wait for `waitGlobalInitialized('Mvu')` before registering: waiting can miss the first initialization event. That wait belongs in scripts and interfaces that read state. The schema evaluates on import, requiring the host's global `z` to exist then; evaluation has no side effects.

## Host Zod instance

The helper's chain is `registerMvuSchema(input)` → evaluate input if needed → `input instanceof z.ZodObject ? z.looseObject(input.shape) : input` → `registerVariableSchema(z.object({ stat_data: schema }), { type: 'message' })`.

It also handles commands on `mag_command_parsed_for_zod` and clears its command array on `mag_command_parsed_ended_for_zod`. Path segments beginning with `_` are discarded.

The helper uses global `z` rather than importing Zod. `src/schema.ts` imports types only and declares that global. The repository's development dependency supplies the locked Zod version to trusted template tests.

Local comparisons of Zod 4.4.3 and 4.6.5 found that cross-copy `instanceof` can succeed while cross-version schema parsing still fails. Passing a 4.6.5 shape to 4.4.3 `z.looseObject(shape)` produced invalid types and undefined defaults; the reverse worked. Sharing the host instance reduces this risk. Tests inject the version locked with the Tavern Helper mirror, 4.4.3.

## Output protocol

Evidence from MVU commit `3377b494cd7277230f3056230062124fe117f93f`:

- `src/util.ts:48-62`: an empty patch array is valid. Otherwise every operation must be a plain object with a string `op` and either a string `path`, or `op: 'move'` with a string `to`. One missing required path invalidates the whole patch.
- `src/function/update_variables.ts:365-422`: `replace` maps to set, `delta` to numeric addition, `insert`/`add` to insertion, `remove` to deletion, and `move` to moving from `from` to `path` or `to`. Unknown operation names are silently ignored.
- Upstream JSON patch tests cover add/replace/remove. Delta/insert/move behavior is established from source.

The model-visible format lists five canonical operations and uses `from` plus `to` for move. Compatibility spellings stay out of the prompt. JSON pointers start at `stat_data` without a `stat_data.` prefix and escape `~` and `/` as `~0` and `~1`.

## Four standard entries

Names use English prose while preserving protocol tags: `[initvar]Initial variables - keep disabled`, `Variable list`, `[mvu_update]Variable update rules`, `[mvu_update]Variable output format`.

MVU locates initialization by `[initvar]` in the comment regardless of enabled state (`src/function/initvar/variable_init.ts:262-291`). Contents may be JSON or YAML. The initialization entry is constant and disabled; the other three are constant system entries at depth 0.

Module orders are relative. New-card generation combines modules and assigns global orders 1..N, placing disabled initialization last. `world-info.js` sorts descending and prepends entries, so the effective order within one depth/role is variable list → update rules → output format. Position 4, depth 0, and role 0 follow the host's enums.

The variable list retains `{{format_message_variable::stat_data}}` and omits only the upstream synchronization tool's YAML frontmatter line.

## Regex and interface marker

Since 0.3.0, interfaces consume MVU's automatically appended `<StatusPlaceHolderImpl/>`; the model is not asked to output it. Evidence is `handleVariablesInMessage` in `src/function/update_variables.ts` and `src/function/function_call.ts`. Without an interface, two extra regex rules remove the marker from display and prompts; with an interface, display rendering and prompt cleanup consume it. See [update modes](../../../docs/MVU-MODES.md).

Four update-block regexes match `update` and `UpdateVariable` case-insensitively: fold complete/incomplete blocks for display and remove complete/incomplete blocks from prompts. Placement includes user input and AI output, host enum values 1 and 2. They do not rewrite stored messages: `regex/engine.js:349-356` rewrites the source only when both display-only and prompt-only are false.

Fixtures cover single blocks, multiple blocks, incomplete streams, and a closed block followed by an incomplete block. `pnpm card check` verifies actual replacement output.

## JSON Schema projection

`schema.json` is maintained as the input projection of `schema.ts`. No production generator or build step writes it. The mvu-template test recomputes `z.toJSONSchema(Schema, { io: 'input' })` and compares every field, printing a replacement when different. Update both files together.

Use `io: 'input'`; output projection rejects transforms. Trust clamping is implemented by the transform. Minimum/maximum metadata describes the range in the projection and does not perform validation. Runtime registration uses `src/schema.ts`; JSON Schema is reference material for people and editors.

## Unverified behavior

No built card was imported into a real Tavern host and no remote helper was executed. Registration behavior above comes from source and documentation; record host evidence in `runtimeVerified` when available. An installed Tavern Helper may ship another Zod version, so basic Zod 4 API usage does not replace host testing.
