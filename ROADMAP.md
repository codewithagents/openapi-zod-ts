# Roadmap

**Mission:** Zero-footprint bridge between OpenAPI and Zod, for both sides of the wire.

Every package is a `devDependency` or a peer-dep-only tool. Nothing we publish adds bytes to a production bundle that isn't already there.

This file mirrors the docs roadmap at [openapi.codewithagents.de/roadmap](https://openapi.codewithagents.de/roadmap). Versions are not pinned here so they cannot drift; see [npm](https://www.npmjs.com/org/codewithagents) and each package CHANGELOG for the current release. The five published packages are four generators (`openapi-zod-ts`, `@codewithagents/openapi-server`, `@codewithagents/openapi-react-query`, `@codewithagents/openapi-msw`) plus one runtime helper (`@codewithagents/api-errors`).

---

## Shipped

### `@codewithagents/api-errors` ✅

Maps backend API error responses to form field errors. Framework-agnostic core with a React Hook Form adapter. This is a runtime helper used in app code, not a codegen step.

**Supported formats:** RFC 7807 / RFC 9457 Problem Details, Spring Boot validation, flat field/message objects, Axios response wrappers.

---

### `openapi-zod-ts` ✅

A CLI devDependency that reads an OpenAPI 3.x spec (3.1 primary target, 3.0.x supported in practice) and an optional user-owned Zod schema, then generates self-contained TypeScript. No runtime package required; the generated code uses only native `fetch`. CLI: `openapi-zod-ts`.

**Two inputs:**

| Field | Required | Description |
|---|---|---|
| `input_openapi` | ✅ | Path to OpenAPI 3.x spec (JSON or YAML) |
| `input_schema` | optional | Path to user-owned Zod schema file. Bootstrapped on first run if absent. |

**Always generated:**
- `models.ts`: TypeScript interfaces (or types derived from `input_schema` via `z.infer`)
- `client.ts`: native fetch functions. When `input_schema` is present: pre-send validation plus response validation using the user's Zod schemas.

**Usage:**
```json
{
  "scripts": { "generate": "openapi-zod-ts" },
  "devDependencies": { "openapi-zod-ts": "^2.0.0" }
}
```
```json
{
  "input_openapi": "openapi.json",
  "input_schema": "schemas.ts",
  "output": "src/api"
}
```

**First run (no `input_schema`):** bootstraps `schemas.ts` as a starting point, structural only, ready to customise with error messages and business rules.

**Subsequent runs:** uses `schemas.ts` as the validation layer. Warns on drift between the OpenAPI spec and the user's schema.

**Design constraints:**
- OpenAPI 3.x (3.1 primary target, 3.0.x supported in practice)
- TypeScript 6 only
- Generated code is readable, looks like code you'd write yourself
- Zero runtime footprint

---

### `@codewithagents/openapi-react-query` ✅

Separate package on top of `openapi-zod-ts`. Reads the same `openapi.json` and the output of `openapi-zod-ts`, generates React Query v5 hooks.

```json
{
  "devDependencies": {
    "openapi-zod-ts": "^2.0.0",
    "@codewithagents/openapi-react-query": "^3.0.0"
  }
}
```

Generates `hooks.ts`: key factories and `useQuery` hooks for GET endpoints, `useMutation` hooks for writes, `useInfiniteQuery` hooks for paginated endpoints. Imports from `openapi-zod-ts`'s `client.ts` output. Peer dep: `@tanstack/react-query`.

---

### `@codewithagents/openapi-server` ✅

Server-side counterpart. Same `openapi.json`, generates a typed service interface and optional framework router. Router target is `hono | express | fastify | none`, defaulting to `none`. With `none` the router is skipped and you wire the interface to any framework yourself. Fastify is the framework the project ships its canonical full-stack app on. CLI: `openapi-server`.

Peer dependencies: `hono`, `express`, or `fastify` depending on the chosen framework.

---

### `@codewithagents/openapi-msw` ✅

Generates MSW v2 HTTP handlers with seeded Faker mock data from an OpenAPI 3.1 spec. Depends on `openapi-zod-ts`. Produces a single `handlers.ts` file ready to drop into a Storybook or Vitest browser setup. CLI: `openapi-msw`.

- One `http.<method>(path, resolver)` handler per operation
- Faker-seeded responses derived from response schemas
- Peer dependencies: `msw` (`^2 || ^3`) and `@faker-js/faker` (`^10`)

---

## The full-stack story

One spec drives four generators. The shared `schemas.ts` is the single source of validation truth across the wire.

```
openapi.json + schemas.ts
    ├── openapi-zod-ts                      → client validates responses with the user's Zod schemas
    ├── @codewithagents/openapi-server      → server validates requests with the same Zod schemas
    ├── @codewithagents/openapi-react-query → React Query v5 hooks over the generated client
    └── @codewithagents/openapi-msw         → MSW v2 handlers with seeded Faker mock data
```

`@codewithagents/api-errors` then maps server validation failures back onto form fields in app code. The canonical end-to-end reference wiring all of this together is [`packages/petstore-fastify`](https://github.com/codewithagents/openapi-zod-ts/tree/main/packages/petstore-fastify): Fastify plus `createContext` auth, a cross-field validation rule, and a React / react-query frontend with browser e2e that round-trips a cross-field error onto a form field. `@codewithagents/petstore-hono` is a retained legacy Hono variant.

---

## Forward-looking

The roadmap is honest about what is not built. Nothing below is committed; priorities shift as feedback comes in.

**Planned**
- Tighten remaining OpenAPI 3.0-only construct normalization to 3.1 semantics (most is handled; a few constructs are still being normalized).
- Broader parser coverage in `api-errors` as new backend error shapes appear.

**Exploring**
- Additional `openapi-server` router targets beyond `hono | express | fastify`.
- Richer mock-data strategies in `openapi-msw` (schema-aware constraints, example reuse).

**Out of scope**
- Swagger 2.0 input. The toolchain targets OpenAPI 3.x only.
- A runtime client library. The generated code stays zero-footprint; we do not ship a package that ends up in a production bundle.
- Non-Zod validation backends. Zod v4 is the validation model.

Open an issue on [GitHub](https://github.com/codewithagents/openapi-zod-ts) if something here matters to your project.

---

## Design Principles

**1. Zero footprint**
Every package in this repo is a `devDependency` or generates code that only depends on what the project already has. We never add a runtime dependency a project didn't choose. `api-errors` is the one runtime helper, and it is opt-in.

**2. Latest only**
TypeScript 6, OpenAPI 3.x (3.1 primary, 3.0.x supported in practice), Zod v4, React Query v5. No legacy compatibility shims. Opinionated cuts mean less code and faster iteration.

**3. Two inputs, one truth**
`input_openapi` owns structure. `input_schema` owns validation behaviour and messages. Neither can replace the other. The generator merges them.

**4. User owns the schema**
`schemas.ts` is bootstrapped once and never overwritten. The user adds error messages, business rules, cross-field validation. The generator warns when it drifts from the OpenAPI spec.

**5. Readable output**
Generated code looks like code a developer would write. No minified magic, no opaque abstractions.

**6. Agent-friendly**
An AI agent building a TypeScript project should be able to install one devDependency, run one command, and have a fully-typed, validated API client. That's the bar.
