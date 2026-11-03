# openapi-server

Published as `@codewithagents/openapi-server` (v2.0.0). CLI: `openapi-server`.

Generate a typed, framework-agnostic server-side service interface and an optional framework router from an OpenAPI 3.x spec. 3.1.x is the primary target; 3.0.x is supported in practice (8 of the 13 showcase specs are 3.0.x and all compile under `tsc --strict`).

## Generates

| File | Description |
|---|---|
| `service.ts` | TypeScript interface, one method per operation; implement this to wire your business logic |
| `router.ts` | Framework router (`createRouter(service)`): routes with optional Zod validation. Only generated when `framework` is not `"none"`. Re-exports `HttpError` from `_shared/errors.ts`, emitted once. |
| `_shared/errors.ts` | Shared `HttpError` class, emitted once per generation run. Single-project: inside the `output` dir. Multi-project: at the longest common parent of all `output` dirs. Override with `shared_output` in config. |

## Two-pass generation (schema-enhanced mode)

When `input_schema` is set in config:

1. **First pass**: generates `service.ts` + `router.ts` + `_shared/errors.ts` (no Zod validation in router)
2. **Second pass**: re-generates `router.ts` with validation wired from the schemas in `input_schema`. For the `hono`/`express` routers this means `safeParse` calls that return `422 { error, issues }` on failure. The `fastify` router instead wires the schemas through `fastify-type-provider-zod`, so Fastify validates natively and rejects with a `400` before the handler runs.

`input_schema` is **never overwritten**: the user owns it.
`_shared/errors.ts` is always emitted once per run regardless of schema mode.

## Config

Default: `openapi-server.config.json` in CWD. Fields: `input_openapi`, `output`, `framework?` (`"hono"` | `"express"` | `"fastify"` | `"none"`, default: `"none"`), `input_schema?`, `shared_output?` (override for `_shared/errors.ts` location), `spec_prefix?` (namespace for schema lookups when several specs share one `input_schema`: `${spec_prefix}${Type}Schema` is imported aliased to the bare `${Type}Schema`, see `src/plugins/schema-prefix.ts`), `error_format?` (`"default"` | `"problem+json"`; problem+json makes every router-produced error an RFC 9457 `application/problem+json` body, emitted via `src/plugins/problem-details.ts`; Fastify applies it in the generated default `setErrorHandler`).

## Fastify service interface shape

Every Fastify service method receives its request data through a single required `input` object. Only facets that the operation actually has are present as keys; no empty facets are emitted.

```typescript
// Example: path param + optional query + body + context_type
interface PetstoreService<Ctx = never> {
  createPet(input: { body: CreatePetRequest }): Promise<Pet>
  getPet(input: { params: { id: string } }): Promise<Pet>
  listPets(input: { query: { species?: string } }): Promise<Pet[]>
  getHealth(ctx: Ctx): Promise<void>                          // zero-facet: no input
  contact(input: { body: ContactRequest }, ctx: Ctx): Promise<ContactResponse>
}
```

Rules:
- Facet keys (`params`, `body`, `query`, `headers`, `cookies`) are present only when the operation has them.
- Each PRESENT facet key is REQUIRED on the outer `input` object (no `?`).
- Per-field optionality lives INSIDE each facet (e.g. `query: { q?: string }`).
- Zero facets: `input` is omitted entirely; the method signature is `(ctx: Ctx)` or `()`.
- `ctx` is always a SEPARATE trailing arg after `input`; it is never inside `input`.

This shape eliminates TS1016 (required parameter cannot follow an optional parameter) by construction: `input` is always required when present, so `ctx` can safely follow it.

## Fastify-specific runtime options

`createRouter(service, options?)` accepts a `CreateRouterOptions` object:

- `createContext?: (req: FastifyRequest) => Ctx | Promise<Ctx>`: **only emitted when `context_type` is set, and then it is required**. When `context_type` is set, `createRouter` is generic over `Ctx` (`createRouter<Ctx = never>`), `CreateRouterOptions` becomes generic (`CreateRouterOptions<Ctx>`), and the options parameter is no longer optional. The concrete type is inferred at the call site; no context type name is baked into generated output. The hook runs first inside every handler (the auth boundary: throw `HttpError(401)` to reject) and its result is passed as `ctx` to every service method, replacing the raw request. Operation-level `security` (`operation.security ?? spec.security`) is surfaced at `req.routeOptions.config.security` and as an escaped `@security` JSDoc tag on each service method; it is metadata only, `createContext` enforces it.
- `registerParsers?: boolean`: set `false` to skip auto-registering `@fastify/formbody` / `@fastify/multipart`
- `multipart?: { limits?: { fileSize?, files?, fieldSize?, ... } }`: forwarded to `@fastify/multipart` when it is auto-registered, merged over the generated defaults. Only emitted when the spec has multipart bodies. Raise `limits.fileSize` to increase the per-file upload cap without setting `registerParsers: false`. Also raise Fastify's core `bodyLimit` at instance creation for large uploads.
- `registerCustomRoutes?: (app: FastifyInstance) => void | Promise<void>`: callback called after ZodTypeProvider compilers, error handler, and body parsers are set up, but before spec-generated routes. Custom routes here inherit ZodTypeProvider and HttpError handling.
- `onRequest?: onRequestHookHandler | onRequestHookHandler[]`: plugin-scoped onRequest hooks; ideal for auth, rate-limiting, request ID injection. Fire before validation.
- `preHandler?: preHandlerHookHandler | preHandlerHookHandler[]`: plugin-scoped preHandler hooks; fire after validation, before the route handler. Ideal for authorization and context enrichment.
- `onSend?: onSendHookHandler | onSendHookHandler[]`: plugin-scoped onSend hooks; fire after the handler, before the response is flushed. Ideal for response header injection.
- `onError?: onErrorHookHandler | onErrorHookHandler[]`: plugin-scoped onError hooks; fire when any route handler or hook throws. For observability only: `errorHandler`/`setErrorHandler` is still the single response-producer. Both coexist safely.

The `fastify` router validates requests natively through `fastify-type-provider-zod` (set on each route via a ZodTypeProvider), so malformed input is rejected with a `400` before any service method runs, and registers an `HttpError` `setErrorHandler` as the single response-producer for thrown errors.

Hook execution order per request: `onRequest` -> `preHandler` -> handler -> `onSend`. Hooks are plugin-scoped: they cover generated routes and `registerCustomRoutes` routes, but not the parent Fastify instance.

## Key non-obvious decisions

- **`--external:prettier` in esbuild**: Prettier is ESM-only. Dynamic `await import('prettier')` plus the external flag keeps the CJS CLI bundle small (~700 KB) and avoids a `createRequire(undefined)` crash.
- **`createRouter(service)`**: router is a factory, not a singleton. This makes it trivially testable with `app.inject()` / `app.request()` in vitest without starting a server.
- **Zod validation is opt-in**: with no `input_schema`, the router is the plain framework router (Hono, Express, or Fastify) with no Zod dep in generated output. Zero footprint for consumers who don't want validation.
- **Schema names matched by convention**: `${PascalCasedOperationBodyType}Schema` must exist in `input_schema`. Unmatched schemas trigger a `console.warn` drift warning.

## Test / build

```
pnpm test    # vitest
pnpm build   # tsc + esbuild CJS CLI
```
