# Contributing to Rehydra

## Getting Started

```bash
git clone https://github.com/rehydra-ai/rehydra-sdk.git
cd rehydra-sdk
npm install
npm run build
```

To set up the NER model for full test coverage:

```bash
npm run setup:ner
```

## Development Workflow

1. Create a branch from `main`
2. Make your changes
3. Run tests and lint before pushing:
   ```bash
   npm run test:run
   npm run lint
   ```
4. Open a pull request against `main`

## Commit Conventions

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) to drive automated releases. **PR titles must use a conventional prefix** since GitHub squash-merges use the PR title as the commit message.

| Prefix | Effect | Example |
|--------|--------|---------|
| `fix:` | Patch release | `fix: handle empty input in validator` |
| `feat:` | Minor release | `feat: add CSV export for PII maps` |
| `feat!:` or `BREAKING CHANGE:` in body | Major release | `feat!: remove deprecated rehydrate() API` |
| `chore:`, `docs:`, `test:`, `ci:` | No release | `chore: update dev dependencies` |

## Pull Requests

- Keep PRs focused — one logical change per PR
- Include a clear description of **what** and **why**
- Reference related issues (e.g. `Fixes #47`)
- All CI checks must pass (tests on Node 18/20/22, lint, browser bundle test)

## Testing

Tests use [Vitest](https://vitest.dev/) and are organized by component:

```
test/
├── integration/    # End-to-end tests
├── ner/            # NER model tests
├── pipeline/       # Pipeline stage tests
├── storage/        # Storage provider tests
└── recognizers/    # Pattern recognizer tests
```

Run a single test file:

```bash
npx vitest test/path/to/file.test.ts
```

Run the full suite with coverage:

```bash
npm run test:coverage
```

## Releases

Releases are fully automated via [release-please](https://github.com/googleapis/release-please):

1. Merge a PR with a `fix:` or `feat:` prefix
2. release-please creates a Release PR with version bumps, changelog updates, and dependency syncs
3. A maintainer merges the Release PR to publish all three packages to npm

All three packages (`rehydra`, `@rehydra/cli`, `@rehydra/opencode`) are versioned in lockstep. No manual version bumps are needed.

## Project Structure

```
rehydra-sdk/
├── src/                    # Source code (all packages built from here)
│   ├── core/               # AnonymizerCore orchestration
│   ├── types/              # PIIType, AnonymizationPolicy, result types
│   ├── recognizers/        # Regex-based PII detection
│   ├── ner/                # ONNX-based Named Entity Recognition
│   ├── pipeline/           # Sequential processing stages
│   ├── storage/            # Encrypted PII persistence providers
│   ├── crypto/             # AES-256-GCM encryption (Web Crypto API)
│   ├── cli/                # CLI commands (@rehydra/cli)
│   ├── opencode-plugin/    # OpenCode plugin (@rehydra/opencode)
│   └── utils/              # Cross-platform abstractions
├── packages/
│   ├── cli/                # @rehydra/cli package.json + entry point
│   └── opencode-plugin/    # @rehydra/opencode package.json + entry point
└── test/                   # Tests (mirrors src/ structure)
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
