# openapi-zod-ts

[![npm](https://img.shields.io/npm/v/openapi-zod-ts.svg)](https://npmjs.com/package/openapi-zod-ts)
[![CI](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/codewithagents/openapi-zod-ts/graph/badge.svg?flag=openapi-zod-ts)](https://codecov.io/gh/codewithagents/openapi-zod-ts)
[![CodeQL](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/codeql.yml/badge.svg)](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/codeql.yml)

📖 **[Full documentation](https://openapi.codewithagents.de)**

`openapi-zod-ts` is an OpenAPI TypeScript codegen tool that generates type-safe TypeScript models, a native `fetch` client, and Zod v4 schemas from a single OpenAPI 3.1 spec, with zero runtime dependencies and 128 real-world specs tested on every PR.

- **Tested against 128 real-world specs**: Stripe, GitHub, Spotify, OpenAI, Adyen, Twilio, Slack, Vercel, and more generate without errors on every PR. 13 of the 128 are showcase specs whose generated output is committed, drift-checked, and typechecked under `tsc --strict`. See the [`examples/`](../../examples/) directory.
- **Zero runtime footprint**: generated code uses only `fetch`. No axios, no wrapper libraries.
- **Prettier-clean output**: every generated file passes `prettier --check` out of the box. Commit it, lint it, ship it.
- **SSR-ready**: every generated function accepts a per-request config override. No global singleton mutation.
- **OpenAPI 3.x**: 3.1.x is the primary target (including 3.1.1); 3.0.x is supported in practice, with a few 3.0-only constructs still being normalized to 3.1 semantics. Full support for `$ref`, `allOf`, `anyOf`, `oneOf`, `nullable`.
- **TypeScript strict mode**: all output passes `strict: true`.

---

## Why choose this?

Most OpenAPI generators either produce types only (you still need to write the fetch calls yourself) or add framework weight such as axios adapters and runtime wrappers. `openapi-zod-ts` generates a complete, ready-to-use typed `fetch` client alongside the types, with nothing added to your runtime bundle.

It is also the foundation of a full pipeline. It sits at the head of four generators that all read one spec and write to one output directory: this package, [`@codewithagents/openapi-server`](https://npmjs.com/package/@codewithagents/openapi-server) for a typed server interface, [`@codewithagents/openapi-react-query`](https://npmjs.com/package/@codewithagents/openapi-react-query) for React Query hooks, and [`@codewithagents/openapi-msw`](https://npmjs.com/package/@codewithagents/openapi-msw) for MSW mock handlers.

| Package | What it generates |
|---|---|
| **`openapi-zod-ts`** | TypeScript types + native `fetch` client + Zod validation |
| [`@codewithagents/openapi-react-query`](https://npmjs.com/package/@codewithagents/openapi-react-query) | React Query v5 hooks (`useQuery`, `useMutation`, key factories) |
| [`@codewithagents/openapi-server`](https://npmjs.com/package/@codewithagents/openapi-server) | Framework-agnostic service interface + optional router (`hono` \| `express` \| `fastify` \| `none`, default `none`) |
| [`@codewithagents/openapi-msw`](https://www.npmjs.com/package/@codewithagents/openapi-msw) | MSW v2 HTTP handlers with seeded Faker mock data |
| [`@codewithagents/api-errors`](https://npmjs.com/package/@codewithagents/api-errors) | Maps API error responses to form field errors |

See the [petstore-fastify demo](https://github.com/codewithagents/openapi-zod-ts/tree/main/packages/petstore-fastify) for a full-stack example with the generators working together.

---

## Install

```bash
pnpm add -D openapi-zod-ts
# or
npm install -D openapi-zod-ts
```

---

## Quick start

**1. Create `openapi-zod-ts.config.json` in your project root:**

```json
{
  "input_openapi": "./openapi.json",
  "output": "./src/api"
}
```

**2. Run the generator:**

```bash
npx openapi-zod-ts
# or override input/output without a config file:
npx openapi-zod-ts --input ./openapi.yaml --output ./src/api
```

**3. Files appear in `./src/api/`:**

| File | What it contains |
|---|---|
| `models.ts` | TypeScript types for every schema in `components.schemas` |
| `client-config.ts` | `configureClient()`: call once at startup to set base URL and auth |
| `client.ts` | One `async function` per API operation, using native `fetch` |
| `server.ts` *(optional)* | `createServerClient()` factory, generated when `server_client: true` |
| `client/<tag>.ts` *(optional)* | One module per OpenAPI tag, generated when `split_by_tag: true` (see [Splitting the client by tag](#splitting-the-client-by-tag)) |

---

## Generated output

Given an OpenAPI spec with a `Task` schema and a `GET /tasks` endpoint, you get:

**`models.ts`**
```typescript
export interface Task {
  id: string
  title: string
  done?: boolean
}
```

**`client-config.ts`**
```typescript
export interface ClientConfig {
  baseUrl: string
  token?: string | (() => string | Promise<string>)
  credentials?: RequestCredentials
  headers?: Record<string, string>
}

export function configureClient(config: ClientConfig): void { ... }
export function getConfig(): Readonly<ClientConfig> { ... }
```

**`client.ts`**
```typescript
export async function getTasks(
  params?: { page?: number; status?: string },
  config?: Partial<ClientConfig>      // optional SSR override
): Promise<Task[]> { ... }
```

### readOnly / writeOnly variants

When a schema marks properties `readOnly` (server-set, e.g. `id`, `createdAt`) or `writeOnly` (input-only, e.g. `password`), the response and request shapes genuinely differ. openapi-zod-ts splits them, but only for schemas that actually use those flags:

- The base type (e.g. `User`) is the response shape and omits `writeOnly` properties.
- A `UserWritable` variant is emitted for the request shape and omits `readOnly` properties.
- Operation request bodies referencing such a schema automatically use the `Writable` variant.

Schemas without any `readOnly`/`writeOnly` properties are left as a single type, so output stays minimal.

```typescript
export interface User {           // response shape (no writeOnly)
  id: string                      // readOnly
  name: string
}
export interface UserWritable {   // request shape (no readOnly)
  name: string
  password: string                // writeOnly
}
```

---

## Auth configuration

### Bearer token (OAuth / JWT)

```typescript
// Startup (e.g. main.ts or App.tsx)
import { configureClient } from './src/api/client-config'

configureClient({
  baseUrl: 'https://api.example.com',
  token: () => getAccessToken(),   // sync or async, called per request
  credentials: 'omit',
})
```

### Cookie-based auth

```typescript
configureClient({
  baseUrl: 'https://api.example.com',
  credentials: 'include',           // sends HttpOnly cookies automatically
})
```

---

## SSR support (Next.js, Remix, RSC)

Every generated function accepts an optional `config` override as its last parameter. This merges with the global config for that single call, with no singleton mutation and safe for concurrent server requests.

```typescript
// app/tasks/page.tsx (Next.js Server Component)
import { getTasks } from '@/api/client'
import { getServerSession } from 'next-auth'

export default async function TasksPage() {
  const session = await getServerSession()

  const tasks = await getTasks(undefined, {
    baseUrl: process.env.API_URL,        // absolute URL required on server
    token: session.accessToken,
    credentials: 'omit',
  })

  return <TaskList tasks={tasks} />
}
```

```typescript
// Client component: uses global config set at startup, no override needed
const tasks = await getTasks({ page: 1 })
```

---

## Next.js RSC: server client factory

When `server_client: true` in config, the generator also writes `server.ts` alongside the other files. It exports `createServerClient()`, a factory that pre-binds a per-request `ClientConfig` to every function:

```ts
// Generated: src/api/server.ts
export function createServerClient(config: Partial<ClientConfig>) {
  return {
    listTasks: (...args) => listTasks(...args, config),
    getTask: (...args) => getTask(...args, config),
    createTask: (...args) => createTask(...args, config),
    // ... all functions
  }
}
```

Usage in a Next.js Server Component:

```ts
// app/tasks/page.tsx
import { createServerClient } from '@/api/server'

async function getServerConfig(): Promise<Partial<ClientConfig>> {
  const session = await getServerSession()
  return { baseUrl: process.env.API_URL, token: session.accessToken }
}

export default async function TasksPage() {
  const api = createServerClient(await getServerConfig())

  const tasks = await api.listTasks()
  const featured = await api.getTask('featured-id')

  return <TaskList tasks={tasks} featured={featured} />
}
```

Without this, you would pass config to every call manually. With it, bind once per request and call freely.

---

## Server-Sent Events (`text/event-stream`)

An operation whose success response is `text/event-stream` (and offers no JSON alternative) keeps its existing method, which resolves to the raw `ReadableStream<Uint8Array> | null` body. Alongside it the client gets an additive `<op>Events()` async generator that yields parsed events:

```typescript
import { streamChatEvents } from './src/api'

for await (const msg of streamChatEvents(roomId, { prompt: 'hi' })) {
  // msg: EventStreamMessage = { event?: string; data: string; id?: string; retry?: number }
  if (msg.event === 'done') break      // breaking out closes the connection
  console.log(JSON.parse(msg.data))
}
```

- `<op>Events()` takes the same arguments as `<op>()`, sends `Accept: text/event-stream` (per-call `config.headers` still win) and throws `ApiError` on non-2xx before yielding anything. A 204 yields nothing.
- The exported `parseEventStream(body)` helper does the parsing and can be used on any `ReadableStream<Uint8Array>`. It follows the WHATWG event-stream rules: CRLF / LF / CR line endings (also when a CRLF is split across chunks), a leading BOM, `:` comments, multi-line `data:` joined with `\n`, `id` persisting across events like `EventSource#lastEventId`, digit-only `retry`, and an unterminated final event is discarded.
- `data` is always a string: parse JSON payloads yourself (`JSON.parse(msg.data)`, or a Zod schema).
- The helper and the `<op>Events()` wrappers are only emitted when the spec has at least one streaming operation, so other clients are unchanged. If the name `<op>Events` is already taken by an operation, the wrapper gets a numeric suffix (`<op>Events_2`).

---

## Splitting the client by tag

Large specs produce one very large `client.ts`. Opt in to one module per OpenAPI tag with `"split_by_tag": true`:

```
src/api/
  client.ts            # barrel: re-exports ApiError + every tag module
  client/_runtime.ts   # shared runtime: ApiError and the request helpers (emitted once)
  client/pets.ts       # operations whose first tag is "pets"
  client/store-orders.ts
  client/default.ts    # operations without a tag
```

- Operations with several tags go to their **first** tag.
- Tag names become kebab-case file names (`Store Orders` and `storeOrders` both become `store-orders.ts`; tags that sanitize to the same name share a module, and tags with no ASCII letters or digits land in `default.ts`).
- `client.ts` re-exports everything, so all existing imports keep working unchanged: your own code, `index.ts`, `server.ts`, and `@codewithagents/openapi-react-query` hooks (which import from `./client.js`).
- **Tree-shaking:** import from a tag module directly to pull in only that tag's operations plus the shared runtime:

  ```typescript
  import { listPets } from './api/client/pets.js'   // only the pets operations
  import { listPets as viaBarrel } from './api'     // still works, same function
  ```

- Regeneration removes tag modules that are no longer produced (only files carrying the generator header), and `--check-drift` also checks the `client/` directory.

The default (`split_by_tag` omitted or `false`) is the single `client.ts`, unchanged.

---

## CLI flags

```
Usage: openapi-zod-ts [options]

Options:
  --config <path>   Path to config file (default: openapi-zod-ts.config.json in cwd)
                    Supports .json, .js, .mjs, and .cjs config files
  --input <path>    Path to OpenAPI spec file (overrides config input_openapi)
  --output <dir>    Output directory (overrides config output)
  --watch           Re-run generation on spec file changes (Ctrl-C to exit)
  --check           Read-only drift gate: write nothing, treat any drift as an
                    error, exit non-zero if regeneration would change committed
                    output (cannot be combined with --watch or --reset-schema)
  --reset-schema    Re-bootstrap the user-owned Zod schema file (input_schema)
                    from the spec, overwriting it (cannot be combined with
                    --check or --watch)
  --help, -h        Show this help message
  --version, -v     Show version number
```

**`--input` and `--output`** resolve relative paths from your shell's working directory. When both are provided, no config file is needed at all:

```bash
npx openapi-zod-ts --input ./openapi.yaml --output ./src/api
```

They can also be combined with `--config` to selectively override a config field:

```bash
npx openapi-zod-ts --config ./openapi-zod-ts.config.json --input ./v2/openapi.yaml
```

**`--watch`** keeps the process running and re-generates whenever the spec file changes. Uses Node's built-in `fs.watch` with a 100ms debounce. Press Ctrl-C to exit:

```bash
npx openapi-zod-ts --watch
npx openapi-zod-ts --input ./openapi.yaml --output ./src/api --watch
```

**`--check`** is a read-only drift gate for CI. It runs generation in memory, writes nothing, and exits non-zero if regenerating would change the committed output (for example, the spec changed but the generated files were not regenerated, or `input_schema` drifted from the spec). Use it as a PR gate so contract drift fails the build instead of landing silently. It cannot be combined with `--watch` (read-only one-shot, not a continuous mode) or with `--reset-schema` (which writes):

```bash
npx openapi-zod-ts --check
npx openapi-zod-ts --config ./openapi-zod-ts.config.json --check
```

**`--reset-schema`** re-bootstraps the user-owned `input_schema` file from the spec, overwriting it with a fresh bootstrap. This is the destructive remedy that drift messages point to: it replaces any customizations in the schema file, so reach for it only when you want to start the schema over from the current spec. It is one-shot, so it cannot be combined with `--watch`, and it cannot be combined with `--check` (which is read-only):

```bash
npx openapi-zod-ts --reset-schema
```

---

## Config reference

See the [full configuration reference](https://openapi.codewithagents.de#configuration) in the docs for detailed field descriptions.

### JSON config (default)

`openapi-zod-ts.config.json`:

```json
{
  "input_openapi": "./openapi.json",    
  "output": "./src/api",                
  "input_schema": "./src/api/zod.ts",   
  "baseUrl": "https://api.example.com", 
  "server_client": false,
  "split_by_tag": false
}
```

### JS/ESM config

Config files can also be `.js`, `.mjs`, or `.cjs`. The default export is loaded as the config object. Use the `defineConfig` helper for full TypeScript autocomplete:

```js
// openapi-zod-ts.config.mjs
import { defineConfig } from 'openapi-zod-ts'

export default defineConfig({
  input_openapi: './openapi.yaml',
  output: './src/api',
  baseUrl: 'https://api.example.com',
  server_client: true,
})
```

Then run with:

```bash
npx openapi-zod-ts --config ./openapi-zod-ts.config.mjs
```

The `defineConfig` helper is a typed identity function. It adds no runtime behavior and exists solely to give editors full autocompletion on config fields.

---

## Multi-spec projects

One config file can drive generation for multiple OpenAPI specs using the `projects` key. Each entry is a full config object and is generated sequentially.

```js
// openapi-zod-ts.config.mjs
import { defineProjects } from 'openapi-zod-ts'

export default defineProjects([
  {
    input_openapi: './services/users/openapi.json',
    output: './src/users',
    baseUrl: 'https://users.example.com',
  },
  {
    input_openapi: './services/orders/openapi.json',
    output: './src/orders',
    baseUrl: 'https://orders.example.com',
  },
])
```

Run with:

```bash
npx openapi-zod-ts --config ./openapi-zod-ts.config.mjs
```

Output shows progress per project:

```
[1/2] generating services/users/openapi.json...
[1/2] Writing output to: src/users
...
[2/2] generating services/orders/openapi.json...
[2/2] Writing output to: src/orders
...
All 2 projects generated successfully.
```

The `projects` key is mutually exclusive with top-level `input_openapi`/`output`. Having both in the same config is a validation error.

If you only need a single spec, continue using the flat `defineConfig` form. The `loadConfigs` function is also exported and returns a normalized `Config[]` for programmatic use: a single-spec config returns a one-element array, a projects config returns N elements.

---

## Error handling

See [error handling](https://openapi.codewithagents.de#error-handling) in the docs for narrowing `ApiError.body` and the global `onError` hook.

Generated functions throw `ApiError` for non-2xx responses:

```typescript
import { ApiError } from './src/api/client'

try {
  const task = await getTaskById('123')
} catch (err) {
  if (err instanceof ApiError) {
    console.error(err.status, err.body)
  }
}
```

---

## Zod validation (`input_schema`)

See the [Zod validation](https://openapi.codewithagents.de#zod-validation-input_schema) section in the docs for the form-wizard pattern, drift detection behaviour, and Zod v4 requirements.

Point `input_schema` at a user-owned Zod schema file and the generator upgrades its output:

**1. Bootstrap once**: if the file doesn't exist yet, `openapi-zod-ts` writes a `schemas.ts` for you:

```ts
// generated/schemas.ts  (bootstrapped, then yours to edit)
import { z } from 'zod'

export const PetSchema = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough()   // forward-compatible: new optional server fields are preserved

export const CreatePetRequestSchema = z.object({
  name: z.string(),
})
```

**2. Add your rules**: refine freely. The file is never overwritten:

```ts
export const CreatePetRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  species: z.enum(['cat', 'dog', 'fish']),
})
```

**3. Re-run the generator**: `models.ts` switches to `z.infer<>` types, `client.ts` adds runtime validation:

```ts
// models.ts (regenerated)
import type { z } from 'zod'
import type { PetSchema, CreatePetRequestSchema } from './schemas.js'
export type Pet = z.infer<typeof PetSchema>
export type CreatePetRequest = z.infer<typeof CreatePetRequestSchema>
```

```ts
// client.ts (regenerated): pre-send and post-receive validation
export async function createPet(body: CreatePetRequest): Promise<Pet> {
  const validatedBody = CreatePetRequestSchema.strip().parse(body)  // strips UI-only fields
  const res = await fetch(...)
  return PetSchema.parse(await res.json())                          // throws ZodError on bad response
}
```

**Form wizard pattern**: extend API schemas for UI-only fields without leaking them to the backend:

```ts
// Your form schema: adds step + confirmTerms on top of the API schema
export const CreatePetFormSchema = CreatePetRequestSchema.extend({
  step: z.number(),
  confirmTerms: z.boolean(),
})
// Use CreatePetFormSchema for React Hook Form validation.
// The generated client calls .strip().parse() before sending, so step and confirmTerms never reach the API.
```

**Drift detection**: if you add a schema to `schemas.ts` that has no matching component in the spec (or vice versa), the generator warns to stderr. Your build still succeeds; the warning is advisory.

---

## Ecosystem

These packages work together, all driven from the same OpenAPI 3.x spec. Four of them are generators that emit files from the spec; `api-errors` is a runtime helper you call in app code:

| Package | What it generates |
|---|---|
| **`openapi-zod-ts`** | TypeScript models + native fetch client + Zod schemas |
| [`@codewithagents/openapi-react-query`](https://www.npmjs.com/package/@codewithagents/openapi-react-query) | React Query v5 hooks (`useQuery`, `useMutation`, key factories) |
| [`@codewithagents/openapi-server`](https://www.npmjs.com/package/@codewithagents/openapi-server) | Framework-agnostic service interface + optional router (`hono` \| `express` \| `fastify` \| `none`, default `none`) |
| [`@codewithagents/openapi-msw`](https://www.npmjs.com/package/@codewithagents/openapi-msw) | MSW v2 HTTP handlers with seeded Faker mock data |
| [`@codewithagents/api-errors`](https://www.npmjs.com/package/@codewithagents/api-errors) | Maps API error responses to form field errors |

See the [petstore-fastify demo](https://github.com/codewithagents/openapi-zod-ts/tree/main/packages/petstore-fastify) for a full-stack example with the generators working together.
