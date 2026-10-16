---
name: tavern-mvu-zod
description: Write or review MVU Zod 4 schema.ts, defaults, idempotent transforms, derived read-only fields, and separate runtime registration scripts.
---

# MVU Zod 4

Read [Zod contract](../../../docs/MVU-ZOD.md). Repository requirements are authoring conventions; do not claim the library forbids other supported syntax.

Schema.ts only imports dependencies and exports Schema; no host reads/writes/events. Registration lives separately, and JSON Schema alone does not register anything. Runtime uses Helper's global Zod 4 instance, matching the adapter; do not bundle another runtime. Trusted tests may explicitly supply locked Zod 4. This repository has no upstream auto-imports, @util aliases, automatic projection generation, or assumed Pinia support.

Repeated parse must be idempotent. Transforms normalize values/compute derived state, not increment scores, charge money, randomize, or refresh timestamps. Prefer number coercion, strict booleans, and explicit key/value record schemas for dynamic inventories. Decide whether empty/null conversions are meaningful for the card.

Clearable containers need valid child defaults and outer prefault. Required missing facts should fail rather than become invented history. Clamp, round, or cap only when required. Per-round limits need old state and belong in update events. Derived current-value fields should recompute in the object holding their inputs; cross-state/event fields use VARIABLE_UPDATE_ENDED and remain declared in Schema.

Verify underscore/dollar handling against pinned MVU/adapter; names are not a security boundary for direct Helper/UI writes. Nested object parsing can strip saved fields; inspect migration results. Subscribe registration early enough to catch initialization, separately from consumers waiting for Mvu.

Test only reviewed trusted code: initial values, invalid/missing/boundary input, cleared containers, dynamic keys, unknown-field retention, repeated parse, and intermediate patch states. Reuse the reviewed loadTrustedSchema approach in [mvu-template.test.mjs](../../../tests/mvu-template.test.mjs): esbuild compile and explicit locked z, then parse and input JSON Schema projection. A vm is not an untrusted-code sandbox. Card check itself does not execute arbitrary schemas. Real host testing still needs initialization/update/swipe/regeneration and correct message stat_data.
