# @codewithagents/openapi-server

[![npm](https://img.shields.io/npm/v/@codewithagents/openapi-server.svg)](https://npmjs.com/package/@codewithagents/openapi-server)
[![CI](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/codewithagents/openapi-zod-ts/graph/badge.svg?flag=openapi-server)](https://codecov.io/gh/codewithagents/openapi-zod-ts)
[![CodeQL](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/codeql.yml/badge.svg)](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/codeql.yml)

📖 **[Full documentation](https://openapi.codewithagents.de/openapi-server)**

`@codewithagents/openapi-server` generates a type-safe TypeScript service interface from your OpenAPI 3.1 spec, plus an optional router for Hono, Express, or Fastify, so your server implementation stays in sync with your API contract automatically.

- **Framework-agnostic service interface**: `service.ts` is a plain TypeScript interface with no framework imports. Implement it however you want: Hono, Express, Fastify, Koa, plain `http`, Bun, Deno, or anything else.
- **Optional router scaffolding**: set `"framework"` to `"hono"`, `"express"`, or `"fastify"` and get a ready-to-mount router as a starting point. Set `"framework": "none"` (the default) and wire the interface yourself. The generated code only ever imports what you already have.
- **Type-safe contract**: the compiler tells you if your implementation drifts from the spec. Add an endpoint in the spec and forget to implement it. TypeScript fails the build.
- **Prettier-clean output**: every generated file passes `prettier --check` out of the box.
- **OpenAPI 3.x**: 3.1.x is the primary target; 3.0.x is supported in practice (8 of the 13 showcase specs are 3.0.x and all compile under `tsc --strict`). Full support for `$ref`, `allOf`, `anyOf`, `oneOf`, `nullable`.
- **TypeScript strict mode**: all output passes `strict: true`.

---

## Install

```bash
pnpm add -D @codewithagents/openapi-server
# or
npm install -D @codewithagents/openapi-server
```

Requires [`openapi-zod-ts`](../openapi-zod-ts). Run both generators together.

> **v2**: the Fastify router now ships as a `FastifyPluginAsyncZod` factory. `createRouter(service)` returns a plugin you mount with `fastify.register(createRouter(service), { prefix })`, with native `fastify-type-provider-zod` validation. See the [CHANGELOG](./CHANGELOG.md) for the full v2 surface.

---

## Quick start

**1. Create `openapi-server.config.json` in your project root:**

```json
{
  "input_openapi": "./spec/api.json",
  "output": "./generated",
  "framework": "hono"
}
```

**2. Run the generator:**

```bash
npx openapi-server
```

**3. Files appear in `./generated/`:**

| File | What it contains |
|---|---|
| `service.ts` | TypeScript interface, one method per API operation |
| `router.ts` | `createRouter(service)` factory for your chosen framework (`hono`, `express`, or `fastify`). The Quick start below uses Hono as one example. |
| `_shared/errors.ts` | Shared `HttpError` class (see below) |

Run `openapi-zod-ts` first (or together) so `models.ts` exists before `service.ts` imports from it:

```bash
npx openapi-zod-ts && npx openapi-server
```

Or add to `package.json`:

```json
{
  "scripts": {
    "generate": "openapi-zod-ts && openapi-server"
  }
}
```

---

## Generated output

Given the petstore spec (`GET /pets`, `POST /pets`, `GET /pets/{id}`, `DELETE /pets/{id}`):

**`generated/service.ts`** (Hono/Express)

```ts
// This file is auto-generated. Do not edit manually.

import type { CreatePetRequest, Pet } from './models.js'

export interface PetstoreService {
  /** GET /pets */
  listPets(params?: { species?: string }): Promise<Pet[]>
  /** POST /pets */
  createPet(body: CreatePetRequest): Promise<Pet>
  /** GET /pets/{id} */
  getPet(id: string): Promise<Pet>
  /** DELETE /pets/{id} */
  deletePet(id: string): Promise<void>
}
```

**`generated/service.ts`** (Fastify, `framework: "fastify"`)

For Fastify, every service method receives a single required `input` object whose keys mirror the request (only the facets the operation actually declares are present):

```ts
// This file is auto-generated. Do not edit manually.

import type { CreatePetRequest, Pet } from './schema-types.js'

export interface PetstoreService {
  /** GET /pets */
  listPets(input: { query: { species?: string } }): Promise<Pet[]>
  /** POST /pets */
  createPet(input: { body: CreatePetRequest }): Promise<Pet>
  /** GET /pets/{id} */
  getPet(input: { params: { id: string } }): Promise<Pet>
  /** DELETE /pets/{id} */
  deletePet(input: { params: { id: string } }): Promise<void>
}
```

The `input` object can have up to five facet keys: `params`, `body`, `query`, `headers`, `cookies`. Each facet key is required (no `?`) when present; per-field optionality lives inside the facet (e.g. `query: { species?: string }`). Operations with no request data emit no `input` param at all.

**`generated/router.ts`**

```ts
// This file is auto-generated. Do not edit manually.

import { Hono } from 'hono'
import type { CreatePetRequest } from './models.js'
import type { PetstoreService } from './service.js'

import { HttpError } from './_shared/errors.js'
export { HttpError } from './_shared/errors.js'

export function createRouter(service: PetstoreService): Hono {
  const app = new Hono()

  app.get('/pets', async (c) => {
    const params = {
      species: c.req.query('species') ?? undefined
    }
    return c.json(await service.listPets(params))
  })

  // ... more routes
  return app
}
```

**`generated/_shared/errors.ts`**

```ts
// This file is auto-generated. Do not edit manually.

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}
```

The router handles:
- Path params: `{id}` → `:id` (Hono style), extracted via `c.req.param()`
- Query params: extracted and typed (`string`, `number`, `boolean`)
- Request bodies: parsed via `c.req.json<T>()` with the correct model type
- Response status: `200` for GET, `201` for POST, `204` for DELETE, derived from your spec

---

## Implementing the service

Create a file that satisfies the generated interface. The compiler enforces the contract.

**Hono / Express service implementation:**

```ts
// src/server/petService.ts
import { randomUUID } from 'node:crypto'
import type { PetstoreService } from '../generated/service.js'
import type { Pet } from '../generated/models.js'

const pets = new Map<string, Pet>()

export const petService: PetstoreService = {
  async listPets(params) {
    const all = Array.from(pets.values())
    if (params?.species) {
      return all.filter(p => p.species.toLowerCase() === params.species!.toLowerCase())
    }
    return all
  },
  async createPet(body) {
    const pet: Pet = { id: randomUUID(), ...body }
    pets.set(pet.id, pet)
    return pet
  },
  async getPet(id) {
    const pet = pets.get(id)
    if (!pet) throw new Error(`Pet ${id} not found`)
    return pet
  },
  async deletePet(id) {
    pets.delete(id)
  },
}
```

**Fastify service implementation** (uses the single `input` object shape):

```ts
// src/server/petService.ts
import { randomUUID } from 'node:crypto'
import type { PetstoreService } from '../generated/service.js'
import type { Pet } from '../generated/schema-types.js'
import { HttpError } from '../generated/router.js'

const pets = new Map<string, Pet>()

export const petService: PetstoreService = {
  async listPets(input) {
    const all = Array.from(pets.values())
    const { species } = input.query
    if (species) {
      return all.filter(p => p.species.toLowerCase() === species.toLowerCase())
    }
    return all
  },
  async createPet(input) {
    const pet: Pet = { id: randomUUID(), ...input.body }
    pets.set(pet.id, pet)
    return pet
  },
  async getPet(input) {
    const pet = pets.get(input.params.id)
    if (!pet) throw new HttpError(404, `Pet ${input.params.id} not found`)
    return pet
  },
  async deletePet(input) {
    pets.delete(input.params.id)
  },
}
```

For Fastify, each method receives its request data through the `input` object. Only the facets the operation declares are present: `params` for path params, `body` for request body, `query` for query params, `headers` for header params, `cookies` for cookie params.

The interface is re-generated every time the spec changes. If you add an endpoint in the spec and forget to implement it, TypeScript will tell you at compile time.

---

## Wiring it up

Mount the generated router on a Hono app and serve it:

```ts
// src/server/index.ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createRouter } from '../generated/router.js'
import { petService } from './petService.js'

const app = new Hono()

// Mount API routes at /api
const apiRouter = createRouter(petService)
app.route('/api', apiRouter)

serve({ fetch: app.fetch, port: 3001 })
```

`createRouter` returns a plain `Hono` instance. You can mount it at any path prefix, add middleware before or after, or nest it inside a larger app.

---

## Config reference

`openapi-server.config.json`:

```json
{
  "input_openapi": "./spec/api.json",
  "output": "./generated",
  "framework": "hono",
  "input_schema": "./generated/schemas.ts",
  "context_type": "RequestContext",
  "shared_output": "./shared"
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `input_openapi` | Yes | n/a | Path to OpenAPI 3.x spec |
| `output` | Yes | n/a | Directory to write `service.ts` and `router.ts` |
| `framework` | No | `"none"` | Router framework to generate: `"hono"`, `"express"`, `"fastify"`, or `"none"`. Use `"none"` to generate only `service.ts` |
| `input_schema` | No | none | Path to user-owned Zod schema file. Enables server-side request validation (see below) |
| `context_type` | No | none | TypeScript type name to thread through service methods as a final `ctx` argument. See below. |
| `emit_response_validation` | No | `false` | Fastify only. Synthesize inline Zod response schemas for flat inline schemas. See below. |
| `shared_output` | No | derived | Override directory for `_shared/errors.ts`. Default: derived from output paths (see below). |
| `spec_prefix` | No | none | Namespace prefix for schema lookups when several specs share one `input_schema` file: looks up `${spec_prefix}${Type}Schema` instead of `${Type}Schema`. See [Sharing one schemas file across specs](#sharing-one-schemas-file-across-specs-spec_prefix). |

Use `--config <path>` to point at a config file in a different location:

```bash
npx openapi-server --config ./config/openapi-server.config.json
```

Relative paths in the config resolve from the config file's directory.

---

## Zod request validation (`input_schema`)

See the [Zod validation](https://openapi.codewithagents.de/openapi-server#zod-validation-input_schema) section in the docs for the two-pass generation flow and schema naming convention.

Point `input_schema` at the same `schemas.ts` you use with `openapi-zod-ts`. The server generator adds runtime validation to every route that receives a request body:

**Config:**

```json
{
  "input_openapi": "./spec/api.json",
  "output": "./generated",
  "framework": "hono",
  "input_schema": "./generated/schemas.ts"
}
```

**Generated router with validation:**

```ts
app.post('/pets', async (c) => {
  const body = await c.req.json()
  const parseResult = CreatePetRequestSchema.safeParse(body)
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body', issues: parseResult.error.issues }, 422)
  }
  return c.json(await service.createPet(parseResult.data), 201)
})
```

Invalid requests get a structured `422` response instead of reaching your service implementation:

```json
{
  "error": "Invalid request body",
  "issues": [
    { "code": "too_small", "path": ["name"], "message": "Name is required" }
  ]
}
```

**Fastify validation is native.** The `"fastify"` router does not hand-roll the `safeParse` block shown above. It registers [`fastify-type-provider-zod`](https://github.com/turkerdev/fastify-type-provider-zod) once and attaches each operation's Zod schemas to the route (`schema: { body, querystring, params, headers, response }`), so Fastify validates and types requests through its own pipeline. Consequences specific to Fastify:

- **Validation failures return Fastify's native `400` (`FST_ERR_VALIDATION`)**, not the `422 { error, issues }` envelope that Hono and Express emit. Reshape it with a Fastify `setErrorHandler` if you want a different contract.
- **Responses are validated** against the declared response schema via the serializer compiler.
- **Handlers are fully typed**: `req.body`, `req.query`, and `req.params` are inferred from the Zod schemas (no manual generics or casts in your code).
- Requires `fastify` and `fastify-type-provider-zod` in your own `dependencies`.
- The router registers one `setErrorHandler` that maps the exported `HttpError` to its status; other errors are re-thrown to your app-level handler.
- Cookie params (`in: cookie`) are the exception: Fastify has no native cookie schema, so those keep a `_ckv` safeParse block and still return `422 { error: 'Invalid request cookies', issues }` (see [Cookie parameter validation](#cookie-parameter-validation)).

**Same schemas, both sides of the wire**: `openapi-zod-ts` validates outgoing requests in the browser; `openapi-server` validates incoming requests on the server. One `schemas.ts`, one source of truth.

**Drift detection**: if schemas diverge from the spec (extra schema, missing schema), the generator warns to stderr. Builds still succeed; the warning is advisory.

---

## Framework support

`service.ts` has no framework imports at all. It is always generated, always framework-agnostic, and works with anything.

`router.ts` is optional and supports:

| Value | What you get |
|---|---|
| `"none"` | Only `service.ts`. Wire the interface yourself. |
| `"hono"` | `service.ts` + a ready-to-mount `router.ts` using [Hono](https://hono.dev). Includes optional Zod request validation via `input_schema`. |
| `"express"` | `service.ts` + a ready-to-mount `router.ts` using [Express](https://expressjs.com) `Router`. Apply `express.json()` middleware before mounting. |
| `"fastify"` | `service.ts` + a `router.ts` that returns a `FastifyPluginAsyncZod` factory via `createRouter(service)`. Mount with `app.register(createRouter(service), { prefix })`. Uses [`fastify-type-provider-zod`](https://github.com/turkerdev/fastify-type-provider-zod) for native request/response validation. Requires `fastify` and `fastify-type-provider-zod` in your `dependencies`. |

The framework package must be in your own `dependencies`. This package adds nothing at runtime.

**Mounting patterns:**

```ts
// Hono
app.route('/api', createRouter(service))

// Express
app.use(express.json())
app.use('/api', createRouter(service))

// Fastify: createRouter(service) returns a FastifyPluginAsyncZod; mount it with register
fastify.register(createRouter(service), { prefix: '/api' })
```

The `"none"` path is always available and keeps the zero-footprint promise: the generated code has no runtime dependencies that you did not already choose.

## Cookie parameter validation

Operations that declare `in: cookie` parameters get the same Zod validation treatment as header and query params. The generator reads the cookie name and schema constraints (required, enum, minLength, maxLength, pattern) from the spec and emits a `_ckv` safeParse block in the generated route handler. Failures return `422 { error: 'Invalid request cookies', issues }`.

Cookie names are case-sensitive (unlike HTTP headers, which are always lowercased before lookup). The exact name from the spec is used for both the Zod field key and the value lookup.

Cookies are not forwarded to the service method signature. They are validated in the router layer only. Forwarding cookies to service methods is out of scope for the current release.

**Per-framework plugin requirements:**

| Framework | Required plugin / middleware | Cookie accessor |
|---|---|---|
| Fastify | `@fastify/cookie` registered before the router | `req.cookies['name']` |
| Express | `cookie-parser` middleware applied before mounting the router | `req.cookies['name']` |
| Hono | `hono/cookie` (imported automatically in the generated output) | `getCookie(c, 'name')` |

**Fastify setup:**

```ts
import fastifyCookie from '@fastify/cookie'

fastify.register(fastifyCookie)
fastify.register(createRouter(service), { prefix: '/api' })
```

**Express setup:**

```ts
import cookieParser from 'cookie-parser'

app.use(cookieParser())
app.use('/api', createRouter(service))
```

**Hono setup:**

No extra setup needed. The generator automatically adds `import { getCookie } from 'hono/cookie'` to the generated router when the spec declares cookie params. `hono/cookie` ships with Hono; no additional install is required.

---

## Error handling

`HttpError` is the canonical way to return structured HTTP errors from service methods. The generated `router.ts` re-exports it, so you always import from one place:

```ts
import { HttpError } from './generated/router.js'
```

This import works for all three frameworks and is stable across regenerations.

`HttpError` lives in `_shared/errors.ts` (see next section). `router.ts` re-exports it with `export { HttpError } from './_shared/errors.js'` so the import path above stays clean and unchanged even in multi-spec configurations.

### Framework error-shape comparison

Each framework has a different error shape for built-in validation failures. Use this table as a reference when writing app-level error handlers:

| Source | Framework | Status | Body shape |
|---|---|---|---|
| `HttpError` from service | All | any (your `.status`) | `{ error: err.message }` (Hono/Express) or `{ statusCode, code, error, message }` (Fastify) |
| Zod validation failure | Hono, Express | 422 | `{ error: 'Invalid request body', issues: [...] }` |
| Zod validation failure | Fastify | 400 | `{ statusCode: 400, code: 'FST_ERR_VALIDATION', error: '...', message: '...' }` |
| Unsupported Content-Type | Hono | 415 | `{ error: 'Unsupported Media Type' }` |
| Unsupported Content-Type | Fastify | 415 | `{ statusCode: 415, code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE', error: '...', message: '...' }` |

### How error propagation works

The generated router maps service-call errors in two cases. Hono and Express use a per-route `try/catch`; Fastify registers a single `setErrorHandler` once (no per-route `try/catch`). Both handle the same two cases:

- **`HttpError`**: mapped to its `.status` code. Use `new HttpError(404, 'Pet not found')` inside service methods to return structured HTTP error responses.
- **All other errors**: re-thrown to your app-level error handler (`setErrorHandler` in Fastify, error-handling middleware in Express, `app.onError` in Hono).

This means custom error types that do NOT extend `HttpError` propagate to the framework layer, where you install a single error handler for logging, monitoring, and response shaping.

**Example: custom error reaching Fastify's `setErrorHandler`**

```ts
// Your custom error class: does NOT extend HttpError
class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`)
    this.name = 'NotFoundError'
  }
}

// Service implementation throws NotFoundError
export const petService: PetstoreService = {
  async getPet(id) {
    const pet = db.get(id)
    if (!pet) throw new NotFoundError(`Pet ${id}`)
    return pet
  },
  // ...
}

// Register a Fastify error handler ONCE at the app level.
// The generated router re-throws non-HttpError errors, so they arrive here.
fastify.setErrorHandler((err, request, reply) => {
  if (err.name === 'NotFoundError') {
    return reply.status(404).send({ error: err.message })
  }
  // Unknown errors become 500
  fastify.log.error(err)
  return reply.status(500).send({ error: 'Internal server error' })
})

fastify.register(createRouter(petService), { prefix: '/api' })
```

The same pattern applies to Express error middleware (`app.use((err, req, res, next) => { ... })`) and to Hono's `app.onError((err, c) => { ... })`.

---

## Shared runtime (`_shared/`) and multi-spec mounting

Every generation run writes one `_shared/errors.ts` file that all generated routers import from. This design ensures that `err instanceof HttpError` works correctly when multiple generated routers are mounted in the same server process, a check that would silently fail if each router defined its own copy of the class.

### Where `_shared/` is written

The generator derives the shared location automatically:

- **Single project** (one `output` path): `_shared/` is placed inside the output directory itself.
  `output: "generated"` → shared file at `generated/_shared/errors.ts`, imported as `./_shared/errors.js` in `router.ts`.

- **Multiple projects** (via `projects` array in config): `_shared/` is placed at the longest common parent directory of all `output` paths.
  `output: "gen/public"` and `output: "gen/admin"` → shared file at `gen/_shared/errors.ts`, imported as `../_shared/errors.js` in each `router.ts`.

- **Override** (`shared_output` config field): set `"shared_output": "path/to/shared"` to place `_shared/errors.ts` at a specific location instead of the derived one. Useful when the output dirs share no common parent.

### Multi-spec mounting example

A real-world pattern: two API specs (public and admin) generate into sibling directories and are mounted in the same Fastify server. Because both routers import `HttpError` from the same `gen/_shared/errors.ts`, a single app-level error handler covers both routers and `instanceof` checks work correctly.

**Config (`openapi-server.config.json`):**

```json
{
  "projects": [
    {
      "input_openapi": "./specs/public.json",
      "output": "./gen/public",
      "framework": "fastify"
    },
    {
      "input_openapi": "./specs/admin.json",
      "output": "./gen/admin",
      "framework": "fastify"
    }
  ]
}
```

This writes:
- `gen/public/router.ts`: imports `HttpError` from `../_shared/errors.js`
- `gen/admin/router.ts`: imports `HttpError` from `../_shared/errors.js`
- `gen/_shared/errors.ts`: the single shared `HttpError` class

**Mounting both routers:**

```ts
import Fastify from 'fastify'
import { HttpError } from './gen/_shared/errors.js'
import { createRouter as createPublicRouter } from './gen/public/router.js'
import { createRouter as createAdminRouter } from './gen/admin/router.js'
import { publicService } from './src/publicService.js'
import { adminService } from './src/adminService.js'

const fastify = Fastify()

// Both routers use the same HttpError class: instanceof works correctly.
fastify.register(createPublicRouter(publicService), { prefix: '/api/v1' })
fastify.register(createAdminRouter(adminService), { prefix: '/admin' })

// One app-level error handler covers both routers.
fastify.setErrorHandler((err, request, reply) => {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.message })
  }
  fastify.log.error(err)
  return reply.status(500).send({ error: 'Internal server error' })
})

fastify.listen({ port: 3000 })
```

Because `HttpError` is a single class imported from one shared file, the `instanceof` check on line `if (err instanceof HttpError)` works for errors thrown in either router. Without the shared module, each router's locally-defined class would be a distinct identity and the check would silently fail for errors from the other router.

### Sharing one schemas file across specs (`spec_prefix`)

By default every router looks up its Zod schemas by the bare convention name `${Type}Schema`. When two specs both declare a `GetUser` type and point `input_schema` at the **same** file, both would resolve to one `GetUserSchema`. Set `spec_prefix` per project to namespace the lookup:

```json
{
  "projects": [
    {
      "input_openapi": "./specs/public.json",
      "output": "./gen/public",
      "framework": "fastify",
      "input_schema": "./shared/schemas.ts",
      "spec_prefix": "PublicApi"
    },
    {
      "input_openapi": "./specs/admin.json",
      "output": "./gen/admin",
      "framework": "fastify",
      "input_schema": "./shared/schemas.ts",
      "spec_prefix": "AdminApi"
    }
  ]
}
```

```ts
// shared/schemas.ts: user-owned, names chosen by you
export const PublicApiGetUserSchema = z.object({ id: z.string(), name: z.string() })
export const AdminApiGetUserSchema = z.object({ id: z.string(), role: z.string() })
export const ErrorSchema = z.object({ message: z.string() }) // unprefixed: shared by both
```

Each generated file imports the prefixed export under its bare name, so the rest of the output is identical to the unprefixed case:

```ts
// gen/public/router.ts
import { PublicApiGetUserSchema as GetUserSchema } from '../../shared/schemas.js'
```

Rules:

- Applies to every framework that looks schemas up by name: the Hono/Express `safeParse` blocks and the Fastify `schema.body` / `schema.response` slots plus `schema-types.ts`.
- `${spec_prefix}${Type}Schema` wins. An **unprefixed** `${Type}Schema` export is still used as a fallback, so schemas genuinely shared by all specs can stay unprefixed.
- Schemas must be declared as `export const NameSchema = ...` (the generator scans for that form; `export { A as B }` re-export lists are not detected).
- `spec_prefix` must be a valid identifier prefix (letters, digits, `_`, `$`; not starting with a digit) and has no effect without `input_schema`.

**Where the prefixed names come from.** `openapi-zod-ts` has no prefix option: its bootstrapped `input_schema` always uses bare `${Type}Schema` names, and its own `models.ts` / `client.ts` import those bare names. So the shared, prefixed file is one **you** maintain for the server side. A practical pattern is to keep each spec's bootstrapped `schemas.ts` for its client and build the shared server file from them:

```ts
// shared/schemas.ts
import * as publicApi from '../gen/public-client/schemas.js'
import * as adminApi from '../gen/admin-client/schemas.js'

export const PublicApiGetUserSchema = publicApi.GetUserSchema
export const AdminApiGetUserSchema = adminApi.GetUserSchema
```

If each spec has its own `schemas.ts` (the common setup), you do not need `spec_prefix` at all.

---

## Custom routes (`registerCustomRoutes`, Fastify only)

The Fastify `createRouter` accepts an optional `registerCustomRoutes` callback that runs after the ZodTypeProvider compilers, error handler, and body parsers are set up, but before the spec-generated routes. Custom routes registered here inherit the ZodTypeProvider context and the HttpError error handler.

```ts
import { createRouter, HttpError } from './generated/router.js'

fastify.register(
  createRouter(petService, {
    registerCustomRoutes: async (app) => {
      app.get('/health', async (_req, reply) => {
        return reply.send({ status: 'ok' })
      })

      app.get('/metrics', async (_req, reply) => {
        const count = await db.countPets()
        return reply.send({ pets: count })
      })
    },
  }),
  { prefix: '/api' }
)
```

Custom routes can throw `HttpError` and it will be caught by the same error handler as the spec-generated routes:

```ts
registerCustomRoutes: async (app) => {
  app.post('/admin/reset', async (req, reply) => {
    const auth = req.headers.authorization
    if (!auth) throw new HttpError(401, 'Unauthorized')
    await db.reset()
    return reply.status(204).send()
  })
}
```

**Sibling-plugin pattern for non-spec routes:**

For routes that do not belong in the spec (health checks, metrics, webhook receivers), register them as a separate Fastify plugin alongside the generated router rather than embedding them in `registerCustomRoutes`:

```ts
import Fastify from 'fastify'
import { createRouter } from './generated/router.js'

const fastify = Fastify()

// Non-spec routes as a standalone plugin
fastify.register(async (app) => {
  app.get('/health', async (_req, reply) => reply.send({ status: 'ok' }))
  app.get('/readyz', async (_req, reply) => reply.send({ ready: true }))
}, { prefix: '/' })

// Generated router with its own ZodTypeProvider scope
fastify.register(createRouter(petService), { prefix: '/api' })

// App-level error handler
fastify.setErrorHandler((err, request, reply) => {
  fastify.log.error(err)
  return reply.status(500).send({ error: 'Internal server error' })
})

fastify.listen({ port: 3000 })
```

The sibling-plugin pattern is preferred when the custom routes do not need ZodTypeProvider or HttpError handling. Use `registerCustomRoutes` when they do.

---

## Global lifecycle hooks (Fastify only)

The Fastify `createRouter` accepts four optional hook options in `CreateRouterOptions`. Each accepts a single handler or an array of handlers:

| Option | Fastify lifecycle point | Typical use |
|---|---|---|
| `onRequest` | Very first hook, before validation | Authentication, rate-limiting, request ID injection |
| `preHandler` | After validation, before handler | Authorization, context enrichment |
| `onSend` | After handler, before response is sent | Response header injection, logging |
| `onError` | When a handler or hook throws | Observability, error metrics |

Hooks are **plugin-scoped**: they apply to all spec-generated routes and to any routes added via `registerCustomRoutes`, but they do NOT propagate to the parent Fastify instance (standard Fastify encapsulation).

Hook execution order per request: `onRequest` -> `preHandler` -> route handler -> `onSend`.

```ts
import { createRouter } from './generated/router.js'
import type { onRequestHookHandler } from 'fastify'

// A reusable onRequest hook that validates a Bearer token.
const authHook: onRequestHookHandler = async (req, reply) => {
  const token = req.headers.authorization
  if (!token?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}

fastify.register(
  createRouter(petService, {
    onRequest: authHook,
    // Arrays are also accepted when you need multiple hooks.
    onError: [metricsHook, loggingHook],
  }),
  { prefix: '/api' }
)
```

**`onError` vs `errorHandler`:** `onError` hooks fire for observability (logging, metrics) but do NOT produce the response. The `errorHandler` option (or the built-in HttpError handler) is the single response-producer. Both can coexist safely: the error handler writes the response, then any `onError` hooks run.

---

## Request-scoped context / caller principal (`context_type`)

The `context_type` config option threads a typed caller context through every generated service method. Use it to pass an authentication principal, a tenant ID, or any per-request metadata without coupling service code to framework types.

**Config:**

```json
{
  "input_openapi": "./spec/api.json",
  "output": "./generated",
  "framework": "hono",
  "context_type": "RequestContext"
}
```

**What changes in generated `service.ts`:**

```ts
// Without context_type (default, Hono/Express style):
export interface PetstoreService {
  listPets(params?: { species?: string }): Promise<Pet[]>
  getPet(id: string): Promise<Pet>
}

// With context_type: "RequestContext" (Hono/Express):
export interface PetstoreService<Ctx = never> {
  listPets(params?: { species?: string }, ctx: Ctx): Promise<Pet[]>
  getPet(id: string, ctx: Ctx): Promise<Pet>
}

// Fastify (framework: "fastify") with context_type: "RequestContext":
// ctx is a separate trailing arg after the required input object.
// Zero-facet ops receive only ctx (no input param).
export interface PetstoreService<Ctx = never> {
  listPets(input: { query: { species?: string } }, ctx: Ctx): Promise<Pet[]>
  getPet(input: { params: { id: string } }, ctx: Ctx): Promise<Pet>
  getHealth(ctx: Ctx): Promise<void>  // zero-facet: no input param
}
```

The generic default `Ctx = never` keeps the interface usable when no context is needed: existing implementations that do not pass ctx continue to compile as long as the service is instantiated without a type argument.

**What changes in generated `router.ts`:**

For Hono and Express the generated router passes the framework's native request/context object as the final argument to every service call. For Fastify the router passes the value returned by a required `createContext(req)` hook (see the Fastify section below):

| Framework | ctx value passed |
|---|---|
| Hono | `c` (the Hono `Context` object) |
| Express | `req` (the Express `Request` object) |
| Fastify | the value returned by your `createContext(req)` hook, not the raw request |

```ts
// Generated Hono handler (with context_type: "RequestContext"):
app.get('/pets', async (c) => {
  try {
    return c.json(await service.listPets(c))
  } catch (err) { ... }
})
```

### Fastify: the `createContext` auth seam

The canonical full-stack reference app, [`petstore-fastify`](https://github.com/codewithagents/openapi-zod-ts/tree/main/packages/petstore-fastify), is a live demonstration of this seam: Fastify with `createContext` auth, a cross-field validation rule, and a React/react-query frontend that round-trips a cross-field error onto a form field.

For Fastify, `context_type` is a runtime auth boundary, not just a type. When `context_type` is set, `createRouter` is generic over `Ctx` and **requires** an options object with a `createContext` hook. The concrete principal type is inferred at the call site from your service implementation and `createContext`, so no context type name is baked into the generated file:

```ts
createRouter<Ctx = never>(service: PetstoreService<Ctx>, options: CreateRouterOptions<Ctx>)
```

`createContext(req)` runs first inside every route handler, so it is the place to authenticate the request and build the typed principal. Throw `HttpError(401)` to reject before any handler work runs. Its return value is passed as `ctx` to every service method.

```ts
import Fastify from 'fastify'
import { createRouter, HttpError, type CreateRouterOptions } from '../generated/router.js'
import type { PetstoreService } from '../generated/service.js'

interface RequestContext {
  userId: string
  scopes: string[]
}

const petService: PetstoreService<RequestContext> = {
  async listPets(input, ctx) {
    return db.listPets({ userId: ctx.userId, species: input.query.species })
  },
  // ... other operations receive ctx as their final argument after the input object
}

const app = Fastify()
app.register(
  createRouter(petService, {
    // Validate the token or session and build the typed principal. Throw to reject.
    createContext: (req) => {
      const userId = req.headers['x-user-id']
      if (typeof userId !== 'string') throw new HttpError(401, 'Unauthorized')
      return { userId, scopes: [] }
    },
  }),
  { prefix: '/v1' }
)
```

Operation-level `security` from the spec (falling back to the global `security`) is surfaced on each route at `req.routeOptions.config.security` as `Array<{ scheme, scopes }>`, so `createContext` (or a `preHandler` hook) can enforce per-operation scope requirements. It is also emitted as a `@security` JSDoc tag on each service method. Security is exposed as metadata only: `createContext` is where you enforce it.

**Implementing the service with context (Hono):**

```ts
import type { PetstoreService } from '../generated/service.js'
import type { Context } from 'hono'

// Define your request context type
interface RequestContext {
  userId: string
  tenantId: string
}

// Extract context from the Hono Context object in a middleware
const app = new Hono()
app.use('*', async (c, next) => {
  const userId = c.req.header('x-user-id') ?? ''
  // Store on the Hono context so the generated router can pass it
  c.set('userId', userId)
  await next()
})

// Implement the service. ctx is whatever the router passed (here: the Hono Context)
export const petService: PetstoreService<Context> = {
  async listPets(params, ctx) {
    const userId = ctx.get('userId')
    return db.listPets({ userId, species: params?.species })
  },
  async getPet(id, ctx) {
    const userId = ctx.get('userId')
    return db.getPet(id, userId)
  },
}
// Note: for Fastify (framework: "fastify"), service methods receive the single input
// object first, then ctx: listPets(input, ctx) where input.query.species is the field.
```

**Backward compatibility:** if `context_type` is not set in the config, the generated output is identical to previous versions. No changes to the interface shape, no extra arguments in service calls.

---

## Non-JSON request bodies (Fastify)

Fastify 5 natively parses only `application/json` and `text/plain` request bodies. The generated router automatically registers the required plugins for any content types declared in your spec.

### application/x-www-form-urlencoded

When your spec has form-urlencoded request bodies, the generated router auto-registers [`@fastify/formbody`](https://github.com/fastify/fastify-formbody) inside the plugin closure. You only need to install it:

```bash
pnpm add @fastify/formbody
```

No manual registration needed. `fastify.register(createRouter(service))` handles it.

### multipart/form-data

When your spec has multipart request bodies, the generated router auto-registers [`@fastify/multipart`](https://github.com/fastify/fastify-multipart) with `attachFieldsToBody: 'keyValues'` inside the plugin closure:

```bash
pnpm add @fastify/multipart
```

No manual registration needed. The `attachFieldsToBody: 'keyValues'` option is set automatically so each field's value lands directly on `req.body` (file fields arrive as `@fastify/multipart` file objects), which is what handlers and body validators expect.

**Upload size limits:** pass `multipart.limits` in `CreateRouterOptions` to raise the per-file cap without opting out of auto-registration. The limits are merged over the generated defaults (`attachFieldsToBody` stays `'keyValues'`):

```ts
fastify.register(
  createRouter(service, {
    multipart: { limits: { fileSize: 10_000_000 } },
  }),
  { prefix: '/api' }
)
```

Note: `@fastify/multipart`'s `fileSize` caps the multipart stream, but Fastify's core `bodyLimit` (default 1 MiB) caps the raw request body first. For large uploads also raise it at instance creation: `Fastify({ bodyLimit: 20_000_000 })`.

The `multipart` option is only present in `CreateRouterOptions` when the spec has multipart bodies. Specs with no multipart bodies get an unchanged `CreateRouterOptions`.

**Full control (all @fastify/multipart options):** pass `registerParsers: false` and register the plugin yourself before mounting the router:

```ts
fastify.register(fastifyMultipart, { attachFieldsToBody: 'keyValues', limits: { fileSize: 10_000_000 } })
fastify.register(createRouter(service, { registerParsers: false }), { prefix: '/api' })
```

### application/octet-stream

No extra plugin is needed. When your spec declares an `application/octet-stream` request body, the generator automatically emits an `addContentTypeParser` call inside `createRouter`:

```ts
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => done(null, body))
```

`addContentTypeParser` is a core Fastify API with no additional dependencies. The parsed body is a `Buffer` and is forwarded directly to the service method.

### 415 error-shape divergence

When a request arrives with an unsupported content type and no parser is registered, the two frameworks return different shapes:

| Framework | Status | Body shape |
|---|---|---|
| Hono | 415 | `{ error: 'Unsupported Media Type' }` |
| Fastify | 415 | `{ statusCode: 415, code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE', error: 'Unsupported Media Type', message: '...' }` |

Hono uses the shared `{ error }` envelope from the generated router. Fastify uses its own framework-level 415 envelope, which is emitted before the route handler runs. If you rely on a consistent error shape across frameworks, register the appropriate parser or add a Fastify `setErrorHandler` that normalises the response.

---

## Response validation opt-in (`emit_response_validation`, Fastify only)

Set `emit_response_validation: true` in your config to instruct the Fastify emitter to synthesize inline Zod expressions for `schema.response` on routes that have no named schema from `input_schema`.

```json
{
  "input_openapi": "./spec/api.json",
  "output": "./generated",
  "framework": "fastify",
  "emit_response_validation": true
}
```

**What the synthesizer does:**

- Flat `object` schema with scalar properties: emits `z.object({ field: z.string(), count: z.number() })`
- Scalar top-level responses: emits `z.string()`, `z.number()`, `z.boolean()`
- Array of scalars: emits `z.array(z.string())` (or the appropriate item type)
- `$ref`, `allOf`, `oneOf`, `anyOf`, or nested object properties: emits `z.unknown()` for that field or the whole response

**Limitations.** The synthesizer is intentionally minimal and honest. It does not chase `$ref` pointers or handle composition keywords. Complex schemas fall back to `z.unknown()`, which passes through any value. If your spec uses `$ref` or composition heavily, wire `input_schema` instead for full coverage.

**Recommendation.** Use `input_schema` (point it at the `schemas.ts` from `openapi-zod-ts`) for complete, type-safe response validation. `emit_response_validation` is a lightweight alternative for specs with simple flat inline response schemas where adding a full Zod schema file is not yet practical.

---

## Ecosystem

`@codewithagents/openapi-server` is one of five published packages, all driven from the same OpenAPI 3.x spec. Four are generators that emit files; `api-errors` is a runtime helper used in app code:

| Package | What it does |
|---|---|
| [`openapi-zod-ts`](https://www.npmjs.com/package/openapi-zod-ts) | Core generator: TypeScript models + native fetch client + Zod schemas. Required by `openapi-server`. |
| **`@codewithagents/openapi-server`** | Framework-agnostic service interface + optional `hono` / `express` / `fastify` / `none` (default `none`) router |
| [`@codewithagents/openapi-react-query`](https://www.npmjs.com/package/@codewithagents/openapi-react-query) | Typed React Query v5 hooks (`useQuery`, `useMutation`, key factories) |
| [`@codewithagents/openapi-msw`](https://www.npmjs.com/package/@codewithagents/openapi-msw) | MSW v2 HTTP handlers with seeded Faker mock data |
| [`@codewithagents/api-errors`](https://www.npmjs.com/package/@codewithagents/api-errors) | Maps backend API error responses to form-field errors (runtime helper, not a codegen step) |

See the [`petstore-fastify` demo](https://github.com/codewithagents/openapi-zod-ts/tree/main/packages/petstore-fastify) for the canonical full-stack example: Fastify with `createContext` auth, a cross-field validation rule, and a React/react-query frontend, with these packages working together.
