# Updates and backup

## Back up the full project

Copy the entire `cards/<name>/` directory: `project.json`, `.card/`, `original/`, `src/`, and any author notes. `CONTENTS.md` is generated navigation. Saving only src loses compatibility identities and unreferenced-entry records from `.card/state.json`. Keep migration snapshots with the project.

Output under dist can be rebuilt and reference caches restored from locks. Also back up originals in imports that have not been imported or that you want to retain independently. Work is temporary; do not keep your only creative material there. Use periodic full archives or a private repository.

## Version personal cards

Personal cards are ignored by default. The official-example allowlist is a release list rather than a place to register user projects. To track your own card, add exceptions after `cards/*` in the root .gitignore:

```gitignore
!cards/<your-card>/
!cards/<your-card>/**
```

Then git add normally, including project.json, .card, and original. Keep personal work out of maintenance/public-release.json. Alternatively, put the full card directory in a private repository.

## Update the workspace

1. Back up cards.
2. With Git, save local edits before pulling/switching versions. With an archive, extract into a new directory and copy complete personal card projects across. Avoid overlaying an old workspace and retaining obsolete tools or overwriting edits.
3. Run `pnpm setup:workspace`, then `pnpm doctor:workspace`.
4. Run `pnpm card check all` and `pnpm card build all`.
5. Investigate errors and build-report.json rather than replacing an existing card with a new template.

Templates affect future cards only. Official examples may update as a whole; personal projects are not automatically rewritten. Restore references using `pnpm refs restore`; use `refs update` only to intentionally change pinned versions.

The English edition generates English keys/names and accepts legacy Chinese authoring keys. Import remains a preservation operation: it does not automatically translate a user's prose, variable names, or code. See [Localization](LOCALIZATION.md).

## Existing-card migration

Since 0.3.0, standard MVU interfaces use the framework's automatic `<StatusPlaceHolderImpl/>`. An existing `<CardStatus/>` may be a deliberate custom layout. If migrating, update its rendering regex, remove obsolete model-output instructions/opening markers, and verify post-initialization display in the host. Independent non-MVU interfaces still use their own producer chain.

Since 0.4.0, new/split worldbooks use category directories and meaningful filenames. Old paths remain valid. To organize a v2 card, use `pnpm card organize <name>`; it backs up and verifies unchanged semantics. Agent-led imported-entry classification sets category after reading bodies; card map identifies pending entries. See [Worldbook files](WORLDBOOK-FILES.md).

Since 0.5.0, new cards use continuous global order. Import/build/organize do not renumber existing cards. For intentional alignment, use `pnpm card arrange <name>`, retaining its backup under work/order-backups. For special positions, inspect the host, manually arrange the index, then use `--order index`. Renumbering changes budget priority; run check/diff and inspect the host prompt.

SchemaVersion 1 projects remain readable. Migrate only when needed:

```sh
pnpm card migrate <name>
```

Migration validates semantic/build-binding preservation before replacing the project and stores prior files under .card/migration-v1. Failure leaves the original untouched. Do not migrate all merely for uniformity. Afterward check/build, and diff imported cards.

## Rollback

Restore the complete backed-up card directory for a damaged card; use your backup rather than treating migration snapshots as a full rollback package. To return to v1, restore a pre-migration backup; there is no reverse-migration command. To roll back the workspace, restore the earlier code/cards, then run setup. Rebuild dist as needed. To restore earlier references, restore their earlier configuration/lockfile and run refs restore rather than editing the cache.

Report changed directories, commands/results, and any actual host evidence. Leave runtimeVerified null if only local checks were performed.
