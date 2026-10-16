# Reference sources

Authoring conclusions should be traceable. Local reference sources are configured in maintenance/reference-sources.json and pinned in maintenance/references.lock.json. The restored cache lives in references/upstream; references/index.json is generated for searching. These caches are read-only research and are not included in public releases or automatically packaged into cards.

## Restore versus update

Run pnpm refs restore after cloning, cleanup, or cache corruption. It reads locked full commits/file lists, reuses valid files, verifies each SHA-256, and rebuilds the local index. It does not resolve latest branches, use the GitHub tree API, change lock contents/timestamps, or upgrade sources. Failure rolls back without damaging an existing cache. Use --source <id> to restore a subset. Search/check require restored material.

Refs update intentionally refreshes sources: configured pinCommit sources remain fixed, others resolve ref at that time, downloads update, fetchedAt/locks are rewritten, and the index is rebuilt. Use it only for a deliberate upgrade or initial lock generation, never merely to replace missing cache files.

Licenses and per-file hashes are recorded in the lockfile; actual terms remain in each restored original license file. Do not infer licensing from project names or repeat drifting legal summaries here. See [Third-party notices](../THIRD_PARTY_NOTICES.md).

| Source ID | Material |
| --- | --- |
| tavern-helper | runtime API types, including @types/function and @types/iframe |
| tavern-helper-docs | original upstream Helper documentation |
| sillytavern | card parsing, worldbooks, prompt/chat injection, macros, slash commands, regex implementation |
| sillytavern-docs | official host documentation |
| prompt-template | EJS extension implementation/docs |
| tavern-helper-template | StageDog templates, skills, examples, MVU types, webpack setup |
| mvu | framework implementation/docs at pinned 3377b494… |
| tavern-resource | registration adapter/source/artifact at pinned 69abb272… |
| character-card-spec | community V2 specification |
| character-card-spec-v3 | authoritative SPEC_V3.md |

Helper types describe their pinned interface version; MVU APIs come from the separate mvu source. MVU pins match the runtime bundle dependency. Old tutorial _.set syntax is research history; current `<JSONPatch>` semantics come from pinned source. Upstream documentation/source paths are preserved even when their names or contents are Chinese.

## Specification versus implementation

Specifications define fields/structures; a particular host's parser/validator determines actual support. V3 JSON field preservation does not mean CHARX packaging. This workspace processes PNG and JSON and does not automatically convert old formats.

| Question | Pinned path under references/upstream |
| --- | --- |
| Card fields | character-card-spec/spec_v2.md; character-card-spec-v3/SPEC_V3.md (confirm local paths in lockfile) |
| Worldbook grouping/position/order | sillytavern/public/scripts/world-info.js |
| Final injection order | sillytavern/public/script.js doChatInject; public/scripts/openai.js populationInjectionPrompts; public/scripts/PromptManager.js |
| Regex routing/replacement | sillytavern/public/scripts/extensions/regex/engine.js |
| PNG/card parsing | sillytavern/src/character-card-parser.js; src/validator/TavernCardValidator.js |
| Helper signatures | tavern-helper/@types/function and @types/iframe |
| MVU updates/events/shape validation | mvu/src/function; src/util.ts |
| MVU stage configuration | mvu/src/store.ts; src/function/request/filter_entries.ts |
| Zod registration | tavern-resource/util/mvu_zod.ts; dist/util/mvu_zod.js |
| EJS functions/stages | prompt-template/docs/reference_cn.md; features_cn.md |

## Public sources

- [SillyTavern docs](https://docs.sillytavern.app/) and [source](https://github.com/SillyTavern/SillyTavern)
- [Tavern Helper docs](https://n0vi028.github.io/JS-Slash-Runner-Doc/) and [types/source](https://github.com/N0VI028/JS-Slash-Runner)
- [Prompt Template](https://github.com/zonde306/ST-Prompt-Template)
- [MVU](https://github.com/MagicalAstrogy/MagVarUpdate)
- [StageDog registration adapter](https://github.com/StageDog/tavern_resource)
- [Zod API](https://zod.dev/api)
- [V2 specification](https://github.com/malfoyslastname/character-card-spec-v2) and [V3 specification](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)

## Recorded source reviews

The upstream workspace recorded implementation reviews on September 18–19, 2026, against MVU 3377b494… and SillyTavern 06bde939…; the complete lockfile commits remain authoritative. Reviews covered worldbook import/position/order/depth/role, regex fields/routing, Helper script structure, MVU state/events, PNG chunks, V3 fields versus host parsing, five patch operations/move destination, registration command takeover, and shared host Zod.

Additional recorded checks covered MVU automatic placeholders/stage filtering and request ownership; same-depth final assistant → user → system ordering (which differs from cached prompt-manager prose); and scan-only Helper injection using position:none/should_scan. Directory/variable locations are not scan material. Sample cards were research inputs only; skills/templates/tests must remain independent of private samples.

These records describe source/document review of restored hash-verified material, not real host execution. This English localization does not turn those historical reviews into new runtime evidence. Cite the exact file/version for field/API claims, record access dates for changing sources, prefer implementation when docs lag, and preserve third-party attribution. Runtime conclusions belong in project.runtimeVerified only after actual testing.
