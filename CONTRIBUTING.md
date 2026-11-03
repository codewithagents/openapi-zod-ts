# Contributing

Thank you for your interest in contributing! This is a pnpm workspace monorepo. Here's everything you need to get started.

---

## Prerequisites

- **Node.js 22 (>= 22.19)**, the version CI builds and tests against. The published generators declare `engines.node >=22.19.0` (required by `@apidevtools/swagger-parser` 13).
- **pnpm 10.30.3** is pinned via the `packageManager` field. Run `corepack enable` so the pinned pnpm is used automatically, or install it with `npm install -g pnpm@10.30.3`. Never use npm or yarn at the root.
- **TypeScript 6**, installed automatically as a dev dependency.

---

## Getting started

```bash
git clone https://github.com/codewithagents/openapi-zod-ts.git
cd openapi-zod-ts
pnpm install
```

### Repository structure

```
packages/
  openapi-zod-ts/        # openapi-zod-ts (unscoped core: TS models + fetch client + Zod)
  openapi-server/        # @codewithagents/openapi-server (service interface + hono/express/fastify router)
  openapi-react-query/   # @codewithagents/openapi-react-query (React Query v5 hooks)
  openapi-msw/           # @codewithagents/openapi-msw (MSW v2 handlers + seeded Faker mocks)
  api-errors/            # @codewithagents/api-errors (API errors -> form-field errors)
  integration/           # @codewithagents/integration (private: cross-package tests, committed output)
  petstore-shared/       # @codewithagents/petstore-shared (private: shared spec + hand-written Zod)
  petstore-fastify/      # canonical full-stack reference (private: Fastify + React + e2e)
  petstore-hono/         # @codewithagents/petstore-hono (private: retained legacy Hono full-stack)
  petstore-express/      # petstore-express (private: thin Express backend smoke)
.github/
  workflows/             # ci, examples (Showcase), smoke, mutation, fallow, codeql, docs-deploy, release
```

Five packages are published to npm: `openapi-zod-ts`, `@codewithagents/openapi-server`, `@codewithagents/openapi-react-query`, `@codewithagents/openapi-msw`, and `@codewithagents/api-errors`. The first four are codegen generators; `api-errors` is a runtime helper. The `petstore-*` and `integration` packages are private and never published.

---

## Development workflow

All of these run from the repo root.

### Run everything

```bash
pnpm -r run build      # build all packages (openapi-zod-ts builds before openapi-react-query)
pnpm -r run test       # run all unit tests
pnpm -r run lint       # type-check all packages (tsc --noEmit)
```

### Work on a single package

```bash
pnpm --filter openapi-zod-ts test
pnpm --filter @codewithagents/api-errors test
pnpm --filter openapi-zod-ts build
pnpm --filter openapi-zod-ts lint
```

### Coverage

```bash
pnpm --filter openapi-zod-ts test:coverage
```

Coverage thresholds are mandatory. Any package with a `test:coverage` script must declare `thresholds` in its `vitest.config.ts`. Seed the floor slightly below current with margin, then ratchet it up. Without a floor, coverage silently rots.

### Update snapshots after intentional output changes

```bash
pnpm --filter openapi-zod-ts test -- -u
```

### Format

```bash
pnpm format         # prettier --write . (apply formatting)
pnpm format:check   # prettier --check . (verify, as CI does)
```

### Before pushing

Run the static-analysis audit. It catches dead code, duplication, and unresolved imports against your current diff before CI does:

```bash
pnpm fallow:audit
```

---

## Commit message convention

We use [Conventional Commits](https://www.conventionalcommits.org/) with **package scopes**. This is not optional. [Release Please](https://github.com/googleapis/release-please) reads commit scopes to decide which package to version-bump, and the project squash-merges PRs so the squashed commit subject is what Release Please sees.

| Type | When to use |
|---|---|
| `feat(openapi-zod-ts): ...` | New feature in openapi-zod-ts |
| `fix(api-errors): ...` | Bug fix in api-errors |
| `chore(openapi-zod-ts): ...` | Maintenance (deps, config, CI) |
| `docs(openapi-zod-ts): ...` | Documentation only |
| `test(openapi-zod-ts): ...` | Adding or fixing tests |
| `refactor(openapi-zod-ts): ...` | Refactoring with no behaviour change |

**Why scopes matter:** an unscoped commit (`feat: ...`) is treated as a change to ALL packages and bumps every package's version. Always scope to the package you changed.

### Breaking changes

Add `BREAKING CHANGE:` in the commit footer (or `!` after the type) to trigger a major version bump:

```
feat(openapi-zod-ts)!: drop TypeScript 5 support

BREAKING CHANGE: TypeScript 6.0 is now required.
```

Major bumps require human approval. If Release Please proposes a major version increase, stop and confirm with a maintainer before merging the release PR. Never bump versions by hand: merge your PR, wait for Release Please to open its release PR, then merge that. The OIDC npm publish fires automatically.

---

## Adding a new package

The canonical, step-by-step source of truth is the `add-package` skill/guide in this repo. Follow it end to end. The outline:

1. Create `packages/your-package/` with a `package.json`. Packages use the `@codewithagents` scope (for example `@codewithagents/your-package`), EXCEPT the unscoped core package `openapi-zod-ts`.
2. It is already matched by `packages/*` in `pnpm-workspace.yaml`, so no workspace edit is needed.
3. If the package has a `test:coverage` script, declare `thresholds` in its `vitest.config.ts`. This is mandatory.
4. Add an entry to `release-please-config.json` with a `component` field.
5. Add an entry to `.release-please-manifest.json`.
6. Add a publish job to `.github/workflows/release.yml`.

---

## Pull request guidelines

- **Small and focused:** one concern per PR. If it touches unrelated files, split it.
- **Tests required:** new behaviour must have tests; bug fixes must have a regression test.
- **TypeScript strict:** all generated code and library code must pass `strict: true`.
- **No `any`:** use `unknown` plus type guards, or proper generics.
- **Snapshot updates:** if you change generated output intentionally, run `test -- -u` to update snapshots and commit the new snapshot file.
- **Run `pnpm fallow:audit` before pushing** so static-analysis issues surface locally, not in CI.
- **Squash merge:** PRs are squash-merged. Write a Conventional Commit-shaped PR title, since it becomes the squashed commit subject Release Please reads.

All checks must pass before merge: CI (build, lint, test, coverage), Showcase (examples), smoke, mutation, fallow, and CodeQL.

---

## Code style

- TypeScript 6 strict mode throughout.
- Generated code should look like code a developer would write: readable, not magical.
- Prefer explicit types over inference where it aids clarity.
- Use `type` imports (`import type { Foo }`) where possible.
- Prettier is enforced. Run `pnpm format` before pushing; CI runs `pnpm format:check`.

---

## Questions?

Open a [Discussion](https://github.com/codewithagents/openapi-zod-ts/discussions) or file an issue. We're happy to help.
