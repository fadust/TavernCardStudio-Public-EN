# TavernCardStudio — English edition

A local workspace for creating SillyTavern character cards with an AI agent. Start from scratch or import an existing PNG / JSON, then edit text, worldbooks, variables, scripts, and HTML/Vue interfaces.

This is the English localization of [TavernCardStudio](https://github.com/rhys-3/TavernCardStudio-Public), maintained in [fadust/TavernCardStudio-Public-EN](https://github.com/fadust/TavernCardStudio-Public-EN). Original authorship, license terms, and third-party attribution are retained.

## Getting started

1. Download and extract the [English workspace source archive](https://github.com/fadust/TavernCardStudio-Public-EN/archive/refs/heads/main.zip), or clone this repository. Open the folder in your usual coding agent.
2. Ask: **“Check and install the environment this workspace needs, then confirm that the character card tool opens.”** For manual setup, see [Installation](docs/INSTALL.md).
3. Once the environment is ready, run **`pnpm studio`**. Create a card, copy an example, or choose **Import and split PNG / JSON**. Your agent can also import the card for you.

## Continue in the same conversation

> Review the card I just imported, organize its worldbook, and change the opening so the protagonist has just arrived in town.

> I want a large world with several peoples and factions. Let's discuss the setting first.

You do not need to complete a creative brief or paste a long startup prompt. Codex, Claude Code, DSH, and other agents that can read local files and run commands can work here. If your agent has not read the workspace instructions, say **“Read AGENTS.md first.”** A chat window without local file access needs files supplied separately.

The workflow and specialist knowledge live in [AGENTS.md](AGENTS.md) and `.agents/skills/`. The agent reads the relevant material as needed. Describe the result you want and anything that must be preserved; refine the details as you work.

## Your files

| Directory | Purpose |
| --- | --- |
| `imports/` | Complete original cards, archived during import |
| `cards/<name>/src/` | Text, configuration, and code that you and the agent edit |
| `dist/<name>/` | Built JSON / PNG files ready to import into SillyTavern |

After editing, ask the agent to check and build the card, or use **Check** and **Build** in the local tool. Continue editing an existing split project; importing the original again would discard your editing workflow. Back up the entire `cards/<name>/` directory, including hidden `.card/` and `original/`. Personal cards are ignored by Git by default.

## Further reading

- [Installation](docs/INSTALL.md) · [Local Studio](docs/STUDIO.md)
- [Creation and modules](docs/CREATION.md) · [World design](docs/WORLD-DESIGN.md)
- [Worldbook files and order](docs/WORLDBOOK-FILES.md) · [Complex cards](docs/COMPLEX-CARDS.md)
- [Architecture and commands](docs/ARCHITECTURE.md) · [Backup and updates](docs/UPDATING.md)
- [Verification limits](docs/VERIFICATION.md) · [Reference sources](docs/SOURCES.md)
- [English localization principles](docs/LOCALIZATION.md)

Checks and builds do not establish compatibility with a real SillyTavern installation. Confirm the result with your own host, extensions, and preset. Workspace content is for non-commercial use; see [LICENSE](LICENSE).
