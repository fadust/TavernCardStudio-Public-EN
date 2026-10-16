# Regexes

Decide whether a replacement changes player display, model input, or stored chat text before writing it.

## Source and fields

Card regexes export to data.extensions.regex_scripts in execution order. Each src/regex/*.yaml is referenced by index.regex. Legacy root-extension regexes use legacy_regex. Use find for the expression and replacement_file for the exact replacement body; trailing newlines affect results, so an empty replacement needs a truly empty file. Preserve link and existing IDs. Removing an index reference removes the regex from output without requiring source deletion.

| Authoring YAML | Native field/meaning |
| --- | --- |
| name | scriptName, also command identity |
| find | findRegex; /expression/flags form supports flags |
| replacement_file | replaceString, capture/match replacements |
| trim | trimStrings removed from matched text before replacement |
| placement | target array |
| disabled | disabled without removing the entry |
| display_only / prompt_only | markdownOnly / promptOnly |
| run_on_edit | runOnEdit |
| substitute_regex | substituteRegex: 0 none, 1 raw macro substitution, 2 escaped |
| min_depth / max_depth | minDepth / maxDepth |

Placement values: legacy_display=0 (deprecated), user_input=1, ai_output=2, slash_command=3, world_info=5, reasoning=6. Historical 4 is unused and should not be authored. See [Mapping](ARCHITECTURE.md#authoring-field-mapping).

## Display, prompt, and storage

Display_only changes only rendered text; prompt_only changes only model input. Both true apply separately without rewriting stored messages. Both false can rewrite text when stored, with no automatic undo; use only when explicitly intended. MVU needs the raw update block preserved for parsing, so separate display folding and prompt removal.

Min_depth is the lower bound from newest message 0; blank/-1 is unrestricted and can apply to continuation. Max_depth is the upper bound. 0..2 means the latest three messages; equal 0 bounds means newest only. Edit behavior also depends on run_on_edit. System/tool prompts and continuation routing need host review. Regex depth is separate from worldbook depth.

## Replacement syntax and tests

Use $1/$2 for capture groups, $<name> for named captures, and {{match}} for the complete match. Trim runs before substitution. Common flags are i/g/s/m/u. Unicode mode does not make JavaScript's digit/word classes cover all scripts; use explicit ranges or Unicode property escapes where needed.

```json
[
  {
    "name": "Display note",
    "input": "Story<note>Rain begins outside.</note>",
    "expected": "Story<details><summary>Note</summary>Rain begins outside.</details>"
  }
]
```

Store meaningful examples under the card's tests/regex.json. Card check finds by id/name, executes the supported replacement/trim semantics, and compares expected output. It does not simulate host macro expansion, depth routing, global regexes, or the complete multi-rule chain. Macro substitution modes warn because static compilation cannot prove expanded expressions. Replacement HTML is also resource-audited.

## Streaming and chain design

Complete and unclosed streaming `<UpdateVariable>` blocks need separate coverage; matching only a closing tag leaks streaming structure. Use non-greedy or explicit boundaries and test two blocks with normal prose between them, multiline text, no match, adjacent prose, and unfinished blocks.

UI display regexes render markers; prompt regexes remove them. Standard MVU consumes automatic `<StatusPlaceHolderImpl/>`, not a second model-output requirement. Independent UIs need their own marker producer. To limit rendering to recent messages, pair recent-range rendering with old-range cleanup and all-range prompt cleanup; max_depth 2 covers three messages, and old cleanup starts at min_depth 3.

Later rules see earlier replacements. Global rules/extensions can add processing, so a single-rule pass is not chain verification. Use the Base64 HTML transport to protect capture/macro-like characters. Check HTML rendering settings, card/regex enabled state, and actual host streaming behavior. Run check/build and report any unverified host behavior explicitly.
