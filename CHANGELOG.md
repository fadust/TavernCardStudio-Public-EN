# Changelog

## Unreleased — English localization

- Localize the maintained application, command output, documentation, repository skills, templates, and bundled examples into English.
- Use English authoring keys for newly generated projects while retaining legacy Chinese schema compatibility.
- Document localization boundaries, runtime protocol preservation, and verification limits.
- Point English-edition download guidance to this fork without implying that an English release has been published.

## 0.5.1

- Make conversation the starting point; startup prompts and creative briefs are optional examples and notes.
- Add concise installation instructions, including agent-assisted environment setup and startup verification, while keeping complex-card support and specialist skills.
- Align the minimum Node.js version with pinned pnpm's Node.js 22.13 requirement; recommend Node.js 24 for new installations, matching CI.

## 0.5.0

- Add agent-led classification after import, local worldbook `category` metadata, pending classification/move lists in `card map`, and safe category-based organization.
- Give new cards a worldbook index and continuous global numbering matching the usual prompt layout. Add `card arrange` and its Studio action, with project backups and index-based numbering for reviewed custom layouts.
- Update examples, authoring skills, and agent instructions to include classification, ordering, and host verification.
- Add world-design guidance covering peoples, politics, customs, and organizations without binding categories to activation or insertion positions.

## 0.4.0

- Use category directories and meaningful worldbook filenames for new and split cards; preserve original entry names/settings and resolve filename collisions locally.
- Add CLI and Studio worldbook organization with backups, reference updates, and card/build-binding preservation checks; retain old paths.
- Expand optional macro, EJS, and variable guidance and clarify system-role defaults for depth entries.

## 0.3.0

- Use MVU's automatic status placeholder and remove redundant model-output instructions; hide the marker without a UI and preserve independent UI marker chains.
- Organize default worldbook content by setting, geography, characters, and depth rules; disable recursion in both directions. Recommend concise YAML-style setting text and leave general narration style to presets.
- Clarify card-name macros, refresh lightweight and comprehensive examples, and document keyword trees and state-driven scans.
- Document main versus extra API variable updates, stage markers, switching, and verification.
- Support publicly hosted scripts/interfaces at fixed versions, including loaders, build switching, dependency audits, and jQuery request URLs.
- Retry temporary-directory contention on Windows a bounded number of times, checking again that an existing project will not be overwritten.

## 0.2.0

- Publish an independent non-commercial workspace supporting text, worldbooks, regexes, scripts, EJS, MVU, Zod, HTML, and Vue.
- Add beginner/complex-card workflows, cross-agent instructions, tiered examples, and an original comprehensive example.
- Separate tool constraints from authoring preferences and support both traditional card fields and worldbook-based settings.
- Add environment setup/diagnostics, pinned reference restore, official-example verification, and public-export checks.
- Exclude personal cards, imports, generated output, reference caches, and agent session data by default; use local builds and manual host imports.

Checks and builds are separate from real host, extension, and model verification.
