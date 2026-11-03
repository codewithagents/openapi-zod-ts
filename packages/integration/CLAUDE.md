# integration

Private cross-package test harness. Verifies `openapi-zod-ts` + `openapi-server` + `openapi-react-query` + `openapi-msw` + `@codewithagents/api-errors` work together end-to-end.

## Key facts
- `private: true`, never published to npm
- `generated/` is **committed** sample output that the tests import directly, and it is drift-checked in CI. It includes `client.ts` and `models.ts` (openapi-zod-ts), `server.ts` (the openapi-zod-ts server client), `hooks.ts` (openapi-react-query), `handlers.ts` and `fixtures.ts` (openapi-msw, `fixtures: true`).
- `spec/api.json`, a fictional Task Manager OpenAPI 3.1 spec. The suite spans the cross-package flow: generated client into api-errors, plus the openapi-react-query hooks, the server client, and the openapi-msw handlers.

## Regenerating `generated/`
Build packages first, then run every generate script so all committed files stay in sync:
```
pnpm run generate        # runs openapi-zod-ts, emits client.ts, models.ts, server.ts (server_client: true)
pnpm run generate:hooks  # runs openapi-react-query, emits hooks.ts
pnpm run generate:mocks  # runs openapi-msw, emits handlers.ts + fixtures.ts
pnpm run generate:hooks:extended  # opt-in hooks (typed_errors, queries, optimistic_updates) into generated-hooks-extended/
```
`generated-hooks-extended/` holds hooks generated with the opt-in options from `openapi-react-query.extended.config.json`; its `client.ts` is a hand-written shim re-exporting `../generated/client.js`. `src/consumer-simulation-extended.ts` type-checks it.
`server.ts` is produced by the `generate` script via the `server_client: true` flag in `openapi-zod-ts.config.json`, not by a separate openapi-server step.

## Test
```
pnpm test   # vitest run
```
