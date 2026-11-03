# integration: cross-package test harness

Private package (`private: true`, never published). Verifies that `openapi-zod-ts`, `@codewithagents/openapi-react-query`, `@codewithagents/openapi-msw`, and `@codewithagents/api-errors` work correctly together at runtime, the things that TypeScript alone cannot catch.

---

## What it tests

Three test files, all run by vitest:

| File | What it covers |
|---|---|
| `integration.test.ts` | Generated client throws `ApiError` on non-2xx; `extractFieldErrors` and `mapApiErrors` consume it correctly |
| `client-runtime.test.ts` | HTTP method, path, query params, headers, body serialisation, response parsing, verified against MSW intercepts |
| `hooks-integration.test.ts` | Generated React Query hooks (`useListTasks`, `useGetTask`, `useCreateTask`, `useUpdateTask`, `useDeleteTask`), rendered with `renderHook` + `QueryClientProvider`, MSW-backed |

The MSW handlers used by these tests come from `generated/handlers.ts`, which is produced by `openapi-msw`.

---

## Running it

```bash
pnpm test
```

Vitest runs all three test files. No server or database required: MSW intercepts all HTTP at the Node.js level.

---

## Regenerating generated output

`generated/` is committed so tests can import it directly without a build step, and it is drift-checked in CI. To regenerate after spec or generator changes, run every generate script so all committed files stay in sync:

```bash
pnpm generate        # runs openapi-zod-ts
pnpm generate:hooks  # runs openapi-react-query
pnpm generate:mocks  # runs openapi-msw
```

Build the upstream packages first:

```bash
pnpm --filter openapi-zod-ts build
pnpm --filter @codewithagents/openapi-react-query build
pnpm --filter @codewithagents/openapi-msw build
```

---

## Structure

```
spec/
  api.json                  Fictional Task Manager spec (OpenAPI 3.1)

generated/                  Committed sample output, do not edit manually
  models.ts, client.ts, client-config.ts, server.ts, index.ts   openapi-zod-ts
  hooks.ts, test-utils.ts                                        openapi-react-query
  handlers.ts, fixtures.ts                                       openapi-msw (MSW v2 handlers + fixture builders)

src/
  __tests__/
    integration.test.ts        api-errors + generated client
    client-runtime.test.ts     HTTP behaviour via MSW
    hooks-integration.test.ts  React Query hooks via renderHook + MSW
  consumer-simulation.ts       Type-level import test (compiled, not run)
```
