# Local character card Studio

Run `pnpm studio`, double-click `Open-TavernCardStudio.cmd` on Windows, or run `sh Open-TavernCardStudio.sh` on macOS/Linux. The tool runs locally without an account and does not upload cards to a website. Prepare Node.js and pinned pnpm first; see [Installation](INSTALL.md). Launchers check versions and install missing/drifted workspace dependencies from the lockfile, not Node.js or global pnpm.

The starting page offers new, import, and copy-example actions. Try a copy of example-text or example-fogharbor-bureau. Official examples are identified by the explicit public manifest, not by a name prefix. Desktop startup behavior on each operating system requires testing on that system; a supplied launcher alone is not runtime evidence.

## Import

Choose **Import character card**, select a PNG containing card data or a JSON card, enter a project name, and import. Drag/drop is also supported. Maximum file size is 64 MB. Ordinary images are for covers rather than card-data import.

Import archives the complete original under imports, then splits an editable project under cards/<name>/src. Identical archive names/content reuse the same file; different content gets a suffix. Existing projects are never overwritten. Originals already in imports can be selected. The project's original directory is an additional read-only verification copy, not editing input or final output.

The workflow is **imports → cards/<name>/src → dist/<name>**. The original-card-folder action opens imports; the sidebar lists split projects.

## Edit, check, and build

Select a project and open its content folder. Edit src/index.yaml and referenced files in your preferred editor. Generated CONTENTS.md helps locate them. Studio manages imports/projects; authoring remains file-based.

An agent can edit the same source and run `pnpm card build <name>`. Studio's Build reads those same files and writes the same dist directory. It does not split imports again or replace edits from the original.

Check displays specific validation issues. Build checks first and stops on errors. With a cover, output includes JSON and PNG containing the same card data; import either into SillyTavern once. Without a cover, output is JSON. Use **Open output folder** to locate it. Some old cards contain undeclared links or incomplete settings; successful splitting does not guarantee immediate build success. Correct source/dependency errors and retry. Neither check nor build executes card code or replaces host testing.

## Names, copies, and covers

The project name controls the directory/output filename; the character display name controls the host's character name. Renaming a project does not replace names inside prose. Rebuild after renaming; old output remains available for comparison and originals are unchanged.

Copy creates an independent project while retaining the source. It initially preserves the character display name, which can be changed separately.

Cover upload accepts PNG/JPG/WebP. The browser converts to PNG, preserves proportions without cropping, and reduces a longest edge over 4096 pixels. Original images must be no more than 24 million pixels. Removing a cover clears the build reference without deleting the original image; rebuilding removes stale PNG output. Name/cover operations validate temporary copies before replacing a project.

## Organize worldbook

**Organize worldbook** moves referenced settings/bodies into category directories with meaningful entry names and updates references and compatibility path records. It uses local category metadata, retaining the current directory when absent; import can infer an initial category only from explicit title conventions, never by reading prose.

The action runs immediately with a full backup in work/layout-backups/<project>-<number>. Results list moved entries, old/new paths, and backup location. Already-organized projects produce no changes or backup. A safety comparison checks that card data/build bindings remain unchanged. Save/close editors and avoid concurrent operations on the same project; concurrent modification aborts replacement. Studio permits one project operation at a time.

Import/organization results report pending classification. An agent should read those bodies in batches, add category by responsibility, then organize again. Only genuinely unresolved entries stay in unclassified, explicitly reported as pending. Classification changes file placement, not triggers, position, order, or prose. The CLI equivalent is `pnpm card organize <name>`; see [Worldbook files](WORLDBOOK-FILES.md).

## Arrange by prompt order

This is an explicit action separate from import, organization, and build. It sorts normal entries before_character → after_character → at_depth (deepest first), renumbers order continuously as 1..N, and updates the index/display_index. Other settings/prose remain unchanged. A full backup goes to work/order-backups and results include changed entries plus a budget warning. An already-aligned project is unchanged.

Order affects cross-position budget priority. Check the actual host prompt after arranging. Author-note, example-message, outlet, or invalid/missing order layouts cannot be inferred safely: inspect the host preset, manually arrange src/index.yaml, then use `pnpm card arrange <name> --order index`. The normal CLI equivalent is `pnpm card arrange <name>`.

## Stop and reopen

Keep the launch terminal open while using Studio. **Close tool** or closing that terminal stops it. Closing a browser tab does not stop the service. Relaunching opens an existing instance rather than starting another. If a connection expires, use the launcher again instead of bookmarking temporary connection URLs.

Studio listens only on loopback. Temporary connection records live under ignored work. It does not commit or push Git changes automatically.
