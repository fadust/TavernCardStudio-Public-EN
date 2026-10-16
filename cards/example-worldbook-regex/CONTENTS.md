# Content navigation

Start at `src/index.yaml`: its lists select what gets packaged. Worldbook injection depends on position, order, depth, and role, not filenames. Edit body text/code in its source file and settings in the matching YAML.

| Content | Location |
| --- | --- |
| Worldbook | `src/worldbook/**/*.yaml` settings by category, with `.md` bodies |
| Regex | `src/regex/*.yaml` settings and matching `.txt` replacement |
| Helper scripts | `src/scripts/*.yaml` settings and `.js` code |
| First message | `src/text/first_mes.md` |
| Other greetings | `src/greetings/`, ordered in the index |
| HTML/Vue source | `src/ui/`, when included |
| Dependencies and avatar | `project.json` dependencies / avatar |

New cards leave description, personality, scenario, and dialogue examples empty; choose traditional fields or worldbook entries for your content. Imported cards preserve existing fields. To add an entry, create its YAML and body and reference it in the index. Omit link for new entries; preserve existing links. Removing a reference excludes its content from builds without deleting the file. Script folder children are listed under scripts in the folder YAML.

`.card/` contains tool-managed compatibility data and `original/` contains original snapshots. Do not edit either manually. Imported interfaces retain their embedded code; the original Vue project cannot be reconstructed automatically.

Run `pnpm card map "example-worldbook-regex"` at the repository root to inspect active paths, or `pnpm card build "example-worldbook-regex"` to generate `dist/example-worldbook-regex/`.
