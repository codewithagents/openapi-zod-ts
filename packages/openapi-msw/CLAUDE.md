# @codewithagents/openapi-msw (v0.2.0). CLI: `openapi-msw`

Generates MSW v2 HTTP handlers with seeded Faker mock data from an OpenAPI 3.x spec (3.1 primary target, 3.0.x best-effort). Depends on `openapi-zod-ts` (`parseSpec`, config-core, cli-core); peer deps `msw` ^2 || ^3 and `@faker-js/faker` ^10.

## What it generates

A single `handlers.ts` file containing:
- `import { http, HttpResponse } from 'msw'`
- `import { faker } from '@faker-js/faker'`
- `faker.seed(SEED)` at the top for deterministic output
- One `http.<method>(path, resolver)` handler per operation
- `export const handlers = [...]`

Opt-in (`fixtures: true`): `fixtures.ts` next to it, one `a<Name>(overrides?: Partial<Name>, variant = 0): Name` builder (plus `a<Name>.full()`) per component schema, typed via `import type` from `models_import` (default `./models.js`).

## Config

Default: `openapi-msw.config.json` in CWD. Point elsewhere with `--config <path>` (relative paths in the config resolve from the config file's directory).

| Field | Type | Default | Notes |
|---|---|---|---|
| `input_openapi` | string | required | Path to the OpenAPI 3.1 spec (JSON or YAML) |
| `output` | string | required | Directory to write `handlers.ts` (created recursively) |
| `seed` | number | `42` | Passed to `faker.seed()`; integer >= 0 |
| `max_array_items` | number | `3` | Array length in generated mocks; integer >= 1 |
| `depth_cap` | number | `30` | Schema recursion depth before emitting `null`; integer >= 1 |
| `base_url` | string | `*` wildcard | Origin (+ optional base path) prefixed to every handler path; non-empty string |
| `fixtures` | boolean | `false` | Also write `fixtures.ts` (per-schema fixture builders) |
| `models_import` | string | `./models.js` | Module specifier fixtures.ts imports model types from |

Multi-spec generation via a top-level `projects` array (inherited from openapi-zod-ts config-core). Mixing `projects` with top-level `input_openapi`/`output` throws.

## Peer dependencies

`msw` ^2 || ^3 and `@faker-js/faker` ^10 are peer dependencies, not bundled. Install them yourself:

```
pnpm add msw @faker-js/faker
```

The generated `handlers.ts` imports `http`/`HttpResponse` from `msw` and `faker` from `@faker-js/faker` directly, so both must be present in the project that uses the handlers.

## Non-obvious decisions

**Seeded faker**: `faker.seed(42)` (default, configurable) ensures generated output is stable across runs. The seed is emitted at the top of the generated file, not in the generator itself.

**MSW v2 path syntax**: OpenAPI `{id}` path params are converted to MSW `:id` colon-style params.

**Origin-anchored handler URLs**: never emit a bare relative path. MSW resolves relative matchers against `location.href`, so in Node (`setupServer`) `'/api/v1/tasks'` never matches `fetch('http://localhost/api/v1/tasks')`. Default is `'*/api/v1/tasks'` (any origin); `base_url` replaces `*`. `handlers-runtime.test.ts` proves this with a real `setupServer` + `onUnhandledFrame: 'error'`.

**Shared faker machinery**: `src/plugins/faker-expr.ts` (`schemaToFaker` + context) is used by both `handlers.ts` and `fixtures.ts`; do not fork it. Context flags `requiredOnly` / `omitWriteOnly` are fixtures-only; handlers emit every property.

**Fixture determinism**: each builder call reseeds a private `new Faker(...)` (aliased import `_Faker`, so a schema named `Faker` cannot clash) with `[seed, fnv1a(schemaName), variant]`, and `faker.setDefaultRefDate` pins relative dates (otherwise `faker.date.recent()` differs per call). Same call = same value, independent of call order and of the handlers' global faker. Builder type names mirror openapi-zod-ts `models.ts` naming (`toTypeName` + `uniquifyName` in schema order). Base values are cast to the model type; only `overrides` are type-checked. Every component `$ref` is emitted as a call to the referenced builder via the `refExpr` hook (pure inlining blew docusign up to a 248 MB file). Refs back into the builder's own reference cycle (SCC, `schema-graph.ts`, same last-segment ref rule as `resolveRef`) are wrapped in the generated `cyclic(...)` guard (one nested level, then `null`) so runtime calls cannot recurse forever. `.full()` runs inside `deeper()`; nested builder calls pick `.full` only while `fullDepth < FULL_DEPTH` (2), else the required-only builder: without this, `.full()` on docusign's wide DAG never finished. Nested calls get `variant = faker.number.int(0xffffffff)` from the caller's seeded faker so array siblings differ. `fixtures.test.ts` compiles generated fixtures against `generateTypes` output.

**depth_cap**: Schema recursion is terminated at depth 30 (default, configurable) with `null /* depth cap reached */` to avoid infinite loops on circular or deeply nested allOf/anyOf/oneOf schemas. The depth counter increments at each $ref hop and each allOf/anyOf/oneOf resolution step.

**allOf handling**: Properties of all allOf members are merged. anyOf/oneOf picks the first concrete (non-ref) member.

**2xx response selection**: Prefers 200, then 201, then the first 2xx code. 204 (no body) emits `HttpResponse.json(null, { status: 204 })`. Operations whose only 2xx response has a non-JSON content type (text/plain, text/csv, octet-stream, image) emit `new HttpResponse(null, { status: N })` to avoid claiming application/json.

## Test / build

```
pnpm test    # vitest run (excludes compat-matrix)
pnpm build   # tsc + esbuild CJS CLI bundle, chmod +x
```

The 128-spec compat matrix runs separately via `pnpm test:matrix` and is excluded from `test` / `test:coverage`.
