# Templates

Card new uses base/ to create a plain-text src/index.yaml and project.json. Select needed modules with --modules; choose html or vue for the initial interface. Templates are starting points, not finished characters. Edit a created card's src rather than templates; template updates affect only future cards.

Worldbook template category is local file metadata, not exported card data or activation/order. Generated settings/bodies use meaningful category paths. Depth entries default to system role. See [Worldbook files](../docs/WORLDBOOK-FILES.md).

| Module | Supplies | Runtime requirements |
| --- | --- | --- |
| worldbook | constant/keyword setting examples | host worldbooks |
| regex | note folding and fixtures | host regex support |
| script | event listener and cleanup example | Tavern Helper |
| mvu | initialization, fixed state-list/output assets, update rules, Zod 4 Schema/registration, complete/streaming regex fixtures | Helper global z, pinned MVU/adapter, network for those dependencies |
| html | HTML/CSS/JS panel | Helper frontend rendering and card regexes |
| vue | Vue panel; MVU reader when combined with mvu | Helper frontend rendering/regexes, optional MVU |

Frontends can use native variables, custom logic, or static content without MVU; MVU can work without UI. MVU+UI consumes automatic `<StatusPlaceHolderImpl/>` without a model-output entry. MVU without UI hides the marker. Independent UI uses `<CardStatus/>`. Default worldbooks include setting/geography/characters/rules with both recursion directions disabled; authors can change creative defaults.

Optional planning/review documents are [Creative brief](prompts/creative-brief.md), [Writing checklist](prompts/writing-checklist.md), and [Conversation examples](prompts/start-here.md). They are not automatically packaged.

## Maintain module templates

Module.json declares entries, regexes, scripts, resources, and build types. ContentFile supplies worldbook prose, replacementFile supplies regex text, and source supplies script code. Files maps template resources to new-card paths. New cards receive fresh regex/script UUIDs; imported cards do not use this flow or reset IDs.

Build entries attach to the generated target configuration. Use English authoring defaults and preserve protocol markers/pins. Update resource tests when changing build behavior. Do not add private external dependencies.

For MVU, src/schema.ts is runtime structure truth and a separate pinned registerMvuSchema script connects it. Schema.json is an editor projection; template tests compare it, while ordinary check/build neither execute schemas nor regenerate projections. Fixed assets are modules/mvu/variables.md and format.md. Ordinary authoring changes Schema, initial state, rules, and UI, preserving macros/tags/operation fields. See [MVU notes](modules/mvu/NOTES.md), [MVU skill](../.agents/skills/tavern-mvu/SKILL.md), and [Zod skill](../.agents/skills/tavern-mvu-zod/SKILL.md).
