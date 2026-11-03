# @codewithagents/openapi-react-query

[![npm](https://img.shields.io/npm/v/@codewithagents/openapi-react-query.svg)](https://npmjs.com/package/@codewithagents/openapi-react-query)
[![CI](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/codewithagents/openapi-zod-ts/graph/badge.svg?flag=openapi-react-query)](https://codecov.io/gh/codewithagents/openapi-zod-ts)
[![CodeQL](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/codeql.yml/badge.svg)](https://github.com/codewithagents/openapi-zod-ts/actions/workflows/codeql.yml)

📖 **[Full documentation](https://openapi.codewithagents.de/openapi-react-query)**

`@codewithagents/openapi-react-query` is an OpenAPI React Query codegen tool that generates typed TanStack Query v5 hooks (`useQuery`, `useMutation`, key factories) directly from your OpenAPI 3.1 spec, with no hand-written boilerplate and full TypeScript strict-mode compliance.

- **One hook per operation**: a `useQuery` variant for every GET and a `useMutation` for every write. Types are derived directly from the generated client, no duplication.
- **`queryOptions()` factories**: a plain `xxxQueryOptions()` factory alongside every `useQuery` hook, enabling `queryClient.prefetchQuery()` in Next.js App Router server components and `<HydrationBoundary>` SSR patterns.
- **Smart detail hooks**: path-param hooks disable automatically when the param is `null` or `undefined`. No `enabled: !!id` at every call site.
- **Key factories included**: structured cache keys per resource (`all()`, `list(params)`, `detail(id)`) for consistent invalidation.
- **Auto-invalidate on mutation**: set `auto_invalidate: true` and mutation hooks invalidate related queries on success, with no `useQueryClient` boilerplate required.
- **Suspense variants**: set `suspense: true` to generate `useSuspense*` hooks alongside every query hook.
- **Prettier-clean output**: every generated file passes `prettier --check` out of the box.

This package consumes the typed fetch client emitted by [`openapi-zod-ts`](https://www.npmjs.com/package/openapi-zod-ts): it has a runtime dependency on it, so `openapi-zod-ts` must run first. The generated hooks derive their data and variable types directly from that client output. It sits alongside the other generators in the toolchain, [`@codewithagents/openapi-server`](https://www.npmjs.com/package/@codewithagents/openapi-server) (service interface plus optional `hono | express | fastify | none` router) and [`@codewithagents/openapi-msw`](https://www.npmjs.com/package/@codewithagents/openapi-msw) (seeded MSW v2 handlers), plus the [`@codewithagents/api-errors`](https://www.npmjs.com/package/@codewithagents/api-errors) runtime helper. See the [petstore-fastify demo](https://github.com/codewithagents/openapi-zod-ts/tree/main/packages/petstore-fastify) for the canonical full-stack example that wires these together.

## Install

```bash
npm install -D @codewithagents/openapi-react-query openapi-zod-ts
npm install @tanstack/react-query
```

`@tanstack/react-query ^5` is a peer dependency, and React Query v5 requires React 18 or later. `openapi-zod-ts` is a runtime dependency of this generator and must produce its client output first (see [Generate](#generate)).

## Configure

See the [full configuration reference](https://openapi.codewithagents.de/openapi-react-query#configuration) in the docs for all options including `overrides` and the `--config` CLI flag.

Create `openapi-react-query.config.json` in your project root:

```json
{
  "input_openapi": "./openapi.json",
  "output": "./src/api",
  "stale_time": 30000,
  "gc_time": 300000,
  "suspense": false,
  "auto_invalidate": false,
  "infinite_query": "auto"
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `input_openapi` | Yes | n/a | OpenAPI 3.x spec (JSON or YAML) |
| `output` | Yes | n/a | Directory to write generated files (same as openapi-zod-ts output) |
| `stale_time` | No | `0` | `staleTime` in ms applied to all `useQuery` hooks |
| `gc_time` | No | `300000` | `gcTime` in ms applied to all `useQuery` hooks |
| `suspense` | No | `false` | When `true`, generates a `useSuspense*` variant alongside every query hook |
| `auto_invalidate` | No | `false` | When `true`, mutation hooks auto-invalidate related queries on success |
| `infinite_query` | No | `'auto'` | `boolean \| 'auto'`. Generates a `useXxxInfinite` hook for paginated list operations. `'auto'` detects paginated GETs; `true` forces generation, `false` disables it |
| `typed_errors` | No | `false` | When `true`, hooks type their error as the client's per-operation error alias (e.g. `GetTaskError`), so `error.status` narrows `error.body` (see [Typed per-status errors](#typed-per-status-errors)) |
| `queries` | No | `false` | When `true`, generates a `useXxxQueries(paramsList, options?, combine?)` hook per GET operation with parameters, for a dynamic number of parallel queries (see [Dynamic parallel queries](#dynamic-parallel-queries)) |
| `optimistic_updates` | No | `false` | When `true`, mutation hooks accept an `optimistic: { queryKey, updater }` option that updates the cache before the request and rolls back on error (see [Optimistic updates](#optimistic-updates)) |
| `overrides` | No | none | Per-resource cache timing (see [Per-resource cache timing](#per-resource-cache-timing)) |

## Generate

Run both generators, openapi-zod-ts first:

```bash
npx openapi-zod-ts
npx openapi-react-query
```

Or add to `package.json`:

```json
{
  "scripts": {
    "generate": "openapi-zod-ts && openapi-react-query"
  }
}
```

## What gets generated

Given a spec with a `/tasks` resource, `hooks.ts` contains:

**Key factory**: one per resource, used for cache invalidation:

```ts
// Key factory (id stays string here; the hook widens it to allow undefined/null)
export const taskKeys = {
  all: () => ['tasks'] as const,
  list: (params?) => ['tasks', 'list', params] as const,
  detail: (id: string) => ['tasks', id] as const,
}
```

**queryOptions factories**: one per GET operation, for use in RSC / server-side prefetching:

```ts
// Plain function, no hooks, safe to call in any context (RSC, loaders, tests)
export function listTasksQueryOptions(params?, options?) {
  return queryOptions({
    queryKey: taskKeys.list(params),
    queryFn: () => listTasks(params),
    staleTime: 30000,
    gcTime: 300000,
    ...options,
  })
}

export function getTaskQueryOptions(id: string, options?) {
  return queryOptions({
    queryKey: taskKeys.detail(id),
    queryFn: () => getTask(id),
    staleTime: 30000,
    gcTime: 300000,
    ...options,
  })
}
```

**Query hooks**: one per GET operation, consuming the factory above:

```ts
export function useListTasks(params?, options?) {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => listTasks(params),
    staleTime: 30000,
    gcTime: 300000,
    ...options,   // override any option per call site
  })
}

// Detail hook: id widened to allow undefined/null, auto-disabled until id is set
export function useGetTask(
  id: string | undefined | null,
  options?,
) {
  return useQuery({
    queryKey: taskKeys.detail(id!),
    queryFn: () => getTask(id!),
    enabled: id != null && (options?.enabled ?? true),
    ...options,
  })
}
```

Detail hooks (those with a path parameter) automatically disable when the parameter is `null` or `undefined`. No more `enabled: !!id` at every call site.

**Mutation hooks**: one per POST/PUT/PATCH/DELETE:

```ts
export function useCreateTask(options?) {
  return useMutation({ mutationFn: (vars) => createTask(vars), ...options })
}

export function useUpdateTask(options?) {
  return useMutation({ mutationFn: ({ id, body }) => updateTask(id, body), ...options })
}
```

All types are derived from the generated client, no duplication:
- Data type: `Awaited<ReturnType<typeof listTasks>>`
- Variables type: `Parameters<typeof createTask>[0]`

## Typed `select` transforms

Every query hook, `queryOptions` factory, `useSuspense*` hook and `useXxxInfinite` hook takes a `TData` generic that defaults to the response type. A `select` transform therefore changes the type of `data`:

```ts
const { data } = useGetTask(id, { select: (task) => task.title })
//      ^? string | undefined

const { data: count } = useListTasks({}, { select: (page) => page.items.length })
//      ^? number | undefined

// The queryOptions factory carries the select type into useQuery / useQueries
useQuery(getTaskQueryOptions(id, { select: (task) => task.id }))
```

Without `select`, `data` is still the raw response type, so existing call sites (including explicit `UseQueryResult<Task, ApiError>` annotations) keep compiling.

## Typed per-status errors

`openapi-zod-ts` exports a per-operation error alias from `client.ts` for every operation that documents explicit `4xx` / `5xx` responses, e.g. `export type GetTaskError = ApiError<404, NotFound> | ApiError<422, ValidationProblem>`. With `typed_errors: true` the hooks use it as their error type:

```ts
const { error } = useGetTask(id)
if (error?.status === 422) {
  error.body.errors // ValidationProblem
}

useCreateTask({
  onError: (error) => {
    if (error.status === 409) toast(error.body.message)
  },
})
```

Operations without documented error statuses keep `ApiError`. This is opt-in because the alias only lists *documented* statuses: an existing comparison against an undocumented status (`error.status === 500`) stops compiling once the type is narrowed, and an undocumented status at runtime is still thrown as a plain `ApiError`.

## Dynamic parallel queries

When `queries: true` in config, every GET operation that takes parameters also gets a `useXxxQueries` hook: a `useQueries` wrapper that builds each query with the operation's `xxxQueryOptions` factory, so cache keys, timing and `queryFn` match the single-query hook exactly.

```ts
// One argument (a path param or the params object): pass the values directly
const results = useGetTaskQueries(taskIds) // UseQueryResult<Task, ApiError>[]

// Several arguments: pass one tuple per query, in client-function order
const repos = useGetRepoQueries([
  ['acme', 'web', { ref: 'main' }],
  ['acme', 'api', { ref: 'main' }],
])

// Shared options apply to every query; `combine` reduces the results
const titles = useGetTaskQueries(taskIds, { staleTime: 60_000 }, (results) =>
  results.flatMap((r) => (r.data ? [r.data.title] : []))
)
```

Operations without parameters get no `useXxxQueries` hook (there is nothing to vary). With `typed_errors: true` the results use the per-operation error alias.

## Next.js App Router SSR prefetch

The generated `queryOptions` factories work in React Server Components (RSC) without any client-boundary workarounds. Prefetch on the server, then pass the dehydrated cache to the client:

```tsx
// app/tasks/page.tsx  (React Server Component)
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { listTasksQueryOptions } from '@/src/api/hooks'
import { TaskList } from './TaskList'

export default async function TasksPage() {
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery(listTasksQueryOptions())
  // or with params: listTasksQueryOptions({ status: 'open' })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TaskList />
    </HydrationBoundary>
  )
}
```

```tsx
// app/tasks/TaskList.tsx  ('use client')
'use client'
import { useListTasks } from '@/src/api/hooks'

export function TaskList() {
  // Cache is already populated from the server; renders without a loading state
  const { data } = useListTasks()
  return <ul>{data?.map(t => <li key={t.id}>{t.title}</li>)}</ul>
}
```

For detail pages, pass the id as a plain string (the factory does not widen to `string | undefined | null`):

```tsx
// app/tasks/[id]/page.tsx  (React Server Component)
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { getTaskQueryOptions } from '@/src/api/hooks'
import { TaskDetail } from './TaskDetail'

export default async function TaskPage({ params }: { params: { id: string } }) {
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery(getTaskQueryOptions(params.id))

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TaskDetail id={params.id} />
    </HydrationBoundary>
  )
}
```

The `queryOptions` factories also work with `useSuspenseQuery` at the call site:

```ts
const { data } = useSuspenseQuery(getTaskQueryOptions(id))
```

## Suspense variants

When `suspense: true` in config, a `useSuspense*` hook is generated alongside every query hook:

```ts
// Regular hook (always generated)
const { data, isLoading } = useGetTask(id)

// Suspense variant (generated when suspense: true)
// data is never undefined: wrap parent in <Suspense fallback={...}>
const { data } = useSuspenseGetTask(id)
```

Works with React 18 `<Suspense>` boundaries and Next.js App Router loading states.

## Auto-invalidate on mutation success

When `auto_invalidate: true` in config, mutation hooks automatically invalidate related cache entries on success. No `useQueryClient` boilerplate at the call site:

```ts
// With auto_invalidate: true, invalidation is generated inside the hook
const create = useCreateTask()
create.mutate({ title: 'New task' })
// taskKeys.all() is automatically invalidated on success

const update = useUpdateTask()
update.mutate({ id: '123', body: { title: 'Updated' } })
// taskKeys.all() AND taskKeys.detail('123') are invalidated on success
```

Invalidation scope:
- `POST` → invalidates `resourceKeys.all()`
- `PUT` / `PATCH` → invalidates `resourceKeys.all()` + `resourceKeys.detail(id)`
- `DELETE` → invalidates `resourceKeys.all()`

Your `onSuccess` callback (if provided in `options`) is called after invalidation.

## Optimistic updates

When `optimistic_updates: true` in config, every mutation hook accepts an `optimistic` option implementing the TanStack Query v5 optimistic-update recipe:

```ts
const update = useUpdateTask({
  optimistic: {
    // static key, or derived from the mutation variables
    queryKey: (vars) => taskKeys.detail(vars.id),
    // annotate `old` to type the cache entry
    updater: (old: Task | undefined, vars) => old && { ...old, ...vars.body },
  },
})
update.mutate({ id: '123', body: { title: 'Renamed' } }) // the UI updates immediately
```

What the generated hook does:
- **onMutate**: `cancelQueries` for the key (so an in-flight fetch cannot overwrite the optimistic value), snapshots `getQueryData`, then `setQueryData` with your `updater`.
- **onError**: restores the snapshot (or resets the entry if it was not cached before).
- **onSettled**: invalidates the key so the server state wins.

Your own `onMutate` / `onError` / `onSuccess` / `onSettled` still run. `onMutate` runs after the optimistic write, and whatever it returns is passed to your other callbacks as their context, exactly as without the option. With `auto_invalidate: true` the resource invalidation runs on success as well. Without an `optimistic` option the hooks behave exactly like plain mutations. The hooks export `OptimisticUpdate<TVariables, TQueryData>` and `OptimisticContext<TContext>` types.

## Per-resource cache timing

Use `overrides` in config to set different `staleTime` / `gcTime` per resource:

```json
{
  "input_openapi": "./openapi.json",
  "output": "./src/api",
  "stale_time": 30000,
  "gc_time": 300000,
  "overrides": {
    "platforms": { "stale_time": 86400000 },
    "settings": { "stale_time": 5000, "gc_time": 60000 }
  }
}
```

The override key is the resource name as it appears in the API path (e.g. `platforms` for `/api/v1/platforms`). Non-overridden resources use the global `stale_time` / `gc_time`.

## Use it

```tsx
import { useListTasks, useCreateTask } from './src/api/hooks'

function TaskList() {
  const { data, isLoading } = useListTasks({ status: 'open' })

  // With auto_invalidate: true, useCreateTask invalidates taskKeys.all() automatically
  const create = useCreateTask()

  if (isLoading) return <Spinner />
  return (
    <>
      {data?.map(task => <Task key={task.id} task={task} />)}
      <button onClick={() => create.mutate({ title: 'New task' })}>Add</button>
    </>
  )
}
```

## Multiple specs

Use `--config` to point at different config files per vendor:

```bash
npx openapi-zod-ts --config ./config/payments.config.json
npx openapi-react-query --config ./config/payments.config.json
```

Relative paths in each config resolve from the config file's directory.

## Testing

The generator also produces a `test-utils.ts` file alongside `hooks.ts`. It exports `createTestQueryClient()` and `createWrapper()` to eliminate test boilerplate. See [Testing your hooks](https://openapi.codewithagents.de/openapi-react-query#testing-your-hooks) in the docs for copy-pasteable Vitest examples using MSW.

To mock the HTTP layer those tests hit, [`@codewithagents/openapi-msw`](https://www.npmjs.com/package/@codewithagents/openapi-msw) generates seeded MSW v2 handlers from the same OpenAPI spec, so the request mocks stay in sync with the client the hooks call.

## Troubleshooting

See the [Troubleshooting](https://openapi.codewithagents.de/openapi-react-query#troubleshooting) section in the docs for common issues: cache not invalidating, detail hooks firing with nullish ids, and hooks not working in React Server Components.

## License

MIT
