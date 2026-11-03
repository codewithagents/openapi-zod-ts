# openapi-react-query

Published as `@codewithagents/openapi-react-query` (v3.12.1).

Generate typed React Query v5 hooks (`useQuery`, `useMutation`, key factories) from OpenAPI 3.x specs. 3.1.x is the primary target (including 3.1.1); 3.0.x is supported in practice (8 of the 13 showcase specs are 3.0.x and all compile under `tsc --strict`).

## What it generates (`hooks.ts`)
- **Key factories** per primary resource: `all()`, `list(params)`, `detail(id)`
- **`useQuery` hooks** for GET operations
- **`useMutation` hooks** for POST/PUT/PATCH/DELETE
- Types fully derived from the generated client, no duplication:
  - `Awaited<ReturnType<typeof fn>>` for data type
  - `Parameters<typeof fn>[N]` for variables type

## Dependencies
- **Runtime dep**: `openapi-zod-ts` (uses `parseSpec`); these hooks consume the client output that `openapi-zod-ts` emits
- **Peer dep**: `@tanstack/react-query ^5`
- Build order matters: build `openapi-zod-ts` first, then this package: `pnpm --filter openapi-zod-ts build`

## Config
Default: `openapi-react-query.config.json` in CWD. Fields:
- `input_openapi` (required): path to OpenAPI 3.x spec
- `output` (required): directory to write generated files
- `stale_time?`: staleTime in ms for all useQuery hooks (default: 0)
- `gc_time?`: gcTime in ms for all useQuery hooks (default: 300000)
- `suspense?`: when true, generates `useSuspense*` variants alongside each `useQuery` hook (default: false)
- `overrides?`: per-resource cache timing overrides; key is resource name, value is `{ stale_time?, gc_time? }`
- `auto_invalidate?`: when true, mutation hooks auto-invalidate related resource queries on success (default: false)
- `infinite_query?`: `boolean | 'auto'`, controls `useXxxInfinite` generation (default: `'auto'`)
- `typed_errors?`: when true, hooks type TError as the client's per-operation alias (`GetPetError`, from `buildOperationErrorTypeNames`) instead of bare `ApiError` (default: false; opt-in because narrowing to documented statuses breaks `error.status === <undocumented>` comparisons)
- `queries?`: when true, emits `useXxxQueries(paramsList, options?, combine?)` (a `useQueries` wrapper over the queryOptions factory) per GET op with parameters (default: false)
- `optimistic_updates?`: when true, mutation hooks take `<TContext, TQueryData>` generics and an `optimistic?: { queryKey, updater }` option, routed through a once-emitted `_withOptimisticUpdate` helper (default: false)

`--config <path>` resolves relative paths from config file's directory (same pattern as openapi-zod-ts).

## Key non-obvious decisions
- **Every query hook / factory has a `TData` generic** defaulting to `Awaited<ReturnType<typeof fn>>` (`InfiniteData<...>` for infinite hooks), so `select` changes the `data` type. Mutations have none.
- **Multiple detail ops produce an operation-name key segment**: when a resource has >1 GET with path params (e.g. `/items/{id}` and `/items/{id}/usage`), each key includes the operation name to prevent cache collisions: `['items', 'getItemById', id]` vs `['items', 'getItemUsage', id]`. Single detail ops keep the canonical `['resource', id]` shape.
- **`...options` spread before `onSuccess` in auto-invalidate hooks**, so the generated `onSuccess` (which calls `queryClient.invalidateQueries`) always wins; the caller's `onSuccess` is composed inside via `options?.onSuccess?.(...args)`.

## Test / build
```
pnpm test    # vitest (~286 it/test blocks across 10 files)
pnpm build   # tsc + chmod +x dist/cli.js
```

Stryker mutation testing runs locally on this package (config: `stryker.config.json`), alongside `openapi-zod-ts`.
