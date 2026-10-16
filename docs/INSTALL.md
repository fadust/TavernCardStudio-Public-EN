# Installation

Set up the environment once, then return to the same workspace to keep writing. Node.js runs the tools; pnpm installs their dependencies.

## Ask an agent

Open the extracted workspace in an agent with local file and terminal access and say:

> Check and install the environment this workspace needs, then confirm that the character card tool opens.

An agent with installation permission can inspect your current environment, install missing parts, and verify startup. It should identify any exact system-permission or installer step you need to complete. A chat-only window cannot install software on your computer.

## Manual setup

1. Install **Node.js 24** from [the official Node.js website](https://nodejs.org/en/download), then reopen the terminal or agent. An existing supported version is fine; `package.json` records the minimum.
2. Open a terminal in the workspace and run:

   ```sh
   npm install --global pnpm@11.17.0
   pnpm setup:workspace
   ```

3. Run `pnpm studio` to open the local tool.

The first installation requires internet access. If node/npm/pnpm cannot be found, reopen the terminal before troubleshooting further. Windows users can open a command prompt by typing `cmd` in File Explorer's address bar. macOS/Linux use the same commands in a terminal.

## Agent setup procedure

When asked to prepare the environment, perform the necessary setup directly rather than requiring a brief or asking the user to research modules.

- Inspect Node.js, npm, and pnpm. Read `engines.node` and `packageManager` from `package.json`; reuse a suitable installation. Prefer Node.js 24 for new installs, matching CI, and use the pinned pnpm version.
- Install missing Node.js through official channels appropriate to the operating system. Do not remove another project's runtime. Follow the current permission rules and describe any required manual step precisely.
- Once Node.js works, `node tools/doctor.mjs` can diagnose the workspace even before pnpm is installed. Install pinned pnpm if necessary, then run `pnpm setup:workspace`. Keep the lockfile and dependency versions unchanged.
- Run `node tools/doctor.mjs` again, start `pnpm studio`, and confirm the local page opens. If browser access is unavailable, report the last verified step. Finish with a concise startup instruction.

The launchers check versions and install missing/drifted project dependencies when Node.js and pnpm are available; they do not install Node.js or global pnpm. Reference downloads are optional: use `pnpm refs restore` when research needs them.
