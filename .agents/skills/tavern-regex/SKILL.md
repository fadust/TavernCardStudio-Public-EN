---
name: tavern-regex
description: Write or review card regex routing for display, prompts, stored messages, MVU streaming/complete blocks, and frontend markers; verify execution order.
---

# Tavern regexes

Read [Regexes](../../../docs/REGEX.md) and [field mapping](../../../docs/ARCHITECTURE.md#authoring-field-mapping). Each src/regex/*.yaml is referenced by index.regex. Use find, replacement_file, name, trim, disabled, display_only, prompt_only, run_on_edit, substitute_regex, min_depth, max_depth, and placement. Preserve link and IDs. Reference changes take effect on build without pointer edits.

Before editing, identify each input/output, placement, display/prompt flags, depth bounds, edit behavior, and prior rule output.

- Separate display hiding from prompt cleanup, preserving raw messages for MVU. Both flags false may rewrite stored history and require explicit intent.
- Cover unfinished streaming and complete blocks; use bounded/non-greedy matches and test multiple blocks with intervening prose.
- Min/max depth are lower/upper bounds from newest 0; max 3 is a recent range, not old-only history. Verify system/tool/continuation routes separately. Regex placement/depth differs from worldbook position/depth.
- Render UI markers only on display and remove them from prompts. If only recent panels render, separately clean old markers without hiding narration.
- Standard MVU consumes automatic `<StatusPlaceHolderImpl/>`; independent/special UIs need a reliable custom producer. For remote loaders see [Remote assets](../../../docs/REMOTE-ASSETS.md), keeping fences/body/dependencies.
- Preserve the repository's Base64 transport to protect capture/macro-like text. It is encoding, not encryption or a way to conceal dependencies.

Add meaningful tests/regex.json examples for positive/no match, multiline, multiple/unfinished blocks, adjacent prose, and replacement boundaries. Card check covers supported single-rule capture/trim replacement, not host global rules, macro expansion, depth routing, or complete chains. Run check/build and state any missing real-host streaming verification.
