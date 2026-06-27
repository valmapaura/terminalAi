# Contributing to OS Assistant

First off, thank you for considering contributing! 🎉 Your help is what makes open-source great.

> **⚠️ Maintainer note:** This is a **spare-time project**. Reviews, responses, and merges happen when time allows — there is no fixed SLA. Please be patient! If you don't hear back within a couple of weeks, feel free to gently ping the thread. Unmaintained/stale issues and PRs will be auto-closed after a period of inactivity.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [Feature Requests](#feature-requests)
- [Support](#support)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/terminalAi.git
   cd terminalAi
   ```
3. **Add the upstream remote** to stay in sync:
   ```bash
   git remote add upstream https://github.com/valmapaura/terminalAi.git
   ```

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) (required for `node-pty` build on Windows)

### Install and run

```bash
npm install
npm run build
npm start
```

### Development mode (watch + auto-rebuild)

```bash
npm run dev:start
```

This runs the TypeScript compilers and Webpack in watch mode, then launches Electron. Changes to source files automatically rebuild.

### Run tests

```bash
npm run test:e2e         # headless
npm run test:e2e:headed  # with visible browser
```

## Project Structure

```
src/
├── main/          # Electron main process (Node.js)
│   ├── main.ts    # Window creation, shortcuts
│   ├── terminal.ts # node-pty terminal manager
│   └── ipc-handlers.ts  # IPC handlers
├── preload/       # Context bridge (secure API exposure)
│   └── preload.ts
└── renderer/      # React app
    ├── App.tsx
    ├── components/ # UI components
    ├── hooks/     # React hooks (useAI, useTerminal)
    ├── utils/     # AI clients, validators, logger
    ├── types/     # TypeScript type definitions
    └── styles/    # CSS
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed breakdown.

## Coding Standards

- **Language**: TypeScript (strict mode enabled)
- **Linting**: ESLint with `typescript-eslint` and `eslint-plugin-react`
- **Formatting**: Prettier (run `npx prettier --write src/` before committing)
- **React**: Functional components with hooks — no class components
- **Naming**:
  - Files: `kebab-case.ts` for utils, `PascalCase.tsx` for components
  - Exports: Named exports only (no `export default`)
  - Types/Interfaces: PascalCase prefixed where appropriate
- **Imports**: Group by: 1) external deps, 2) internal deps, 3) types — with a blank line between groups

Run the linter before submitting:

```bash
npx eslint src/
```

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

feat:     New feature
fix:      Bug fix
refactor: Code change that neither fixes a bug nor adds a feature
docs:     Documentation only
style:    Formatting, missing semicolons, etc. (no code change)
chore:    Build process, dependencies, etc.
test:     Adding or updating tests
perf:     Performance improvement
```

Examples:

```
feat(ai): add support for Ollama provider
fix(terminal): handle resize on window maximize
docs(readme): update setup instructions
chore(deps): upgrade electron to v30
```

## Pull Request Process

1. **Create a branch** from `main` with a descriptive name:

   ```
   feat/add-ollama-provider
   fix/terminal-resize-bug
   docs/update-readme
   ```

2. **Make your changes** — keep them focused on a single concern.

3. **Keep your branch up to date** with `main`:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

4. **Run the checks** locally:

   ```bash
   npm run build     # must compile without errors
   npx eslint src/   # must pass with zero errors
   ```

5. **Open a pull request** against the `main` branch.

6. In your PR description, include:
   - What the change does
   - Why it's needed
   - Any testing you performed
   - Screenshots (if UI-relevant)

7. A maintainer will review your PR when time permits. Please respond to feedback promptly so the PR doesn't go stale.

### PR Checklist

- [ ] Code compiles (`npm run build`)
- [ ] Linting passes (`npx eslint src/`)
- [ ] Tests pass (if applicable)
- [ ] New code includes appropriate comments
- [ ] No unrelated changes in the diff

## Reporting Issues

When filing a bug report, please include:

- **OS version** (e.g., Windows 11 23H2)
- **App version** (see package.json)
- **Steps to reproduce** — be as specific as possible
- **Expected behavior** vs **actual behavior**
- **Screenshots** (if visual)
- **Terminal output** or **dev tools console** errors (if any)

## Feature Requests

We welcome feature ideas! Open an issue with the label `enhancement` and describe:

- What problem you're trying to solve
- How you envision the feature working
- Any alternatives you've considered

## Support

See [SUPPORT.md](SUPPORT.md) for details on where to get help.

---

_Thank you for contributing! 🚀_
