# openapi-zod-ts

Published to npm as `openapi-zod-ts` (unscoped, v2.1.0). This is the core generator: TypeScript models, native fetch client, and Zod v4 schemas from an OpenAPI 3.x spec (3.1 primary target; 3.0.x supported in practice, 8 of the 13 showcase specs are 3.0.x and all compile under `tsc --strict`). Zero runtime footprint.

**Related packages:** `@codewithagents/openapi-react-query` and `@codewithagents/openapi-msw` build on this client output; `@codewithagents/openapi-server` is the server-side counterpart.

## Generates
- `models.ts`: TypeScript interfaces
- `client.ts`: typed `fetch` functions (zero runtime deps)
- `client-config.ts`: base URL + default fetch options
- `index.ts`: barrel re-export
- `zod.ts` (optional): Zod v4 schemas, bootstrapped once, **never overwritten on regen**, the user owns it

## Plugins (`src/plugins/`)
| File | Generates |
|---|---|
| `types.ts` | models.ts |
| `client.ts` | client.ts (or, with `split_by_tag`, a barrel + `client/_runtime.ts` + `client/<tag>.ts`) |
| `event-stream.ts` | `parseEventStream` source, emitted into the client only when the spec has a text/event-stream op |
| `client-config.ts` | client-config.ts |
| `zod.ts` | zod.ts |
| `index-barrel.ts` | index.ts |

## Non-obvious decisions
- **`.js` extensions** in all generated imports: required for NodeNext module resolution
- **`resolveParamRef(p, spec)`**: resolves `$ref: '#/components/parameters/Name'` before filtering path/query/header params
- **`hasCookieAuth(spec)`**: checks `components.securitySchemes` for `type: apiKey, in: cookie`; sets `credentials: 'include'` default in client-config
- **`getRequestBodyInfo()`**: returns `{ typeName, kind: 'json' | 'multipart', multipartFields? }`; multipart generates `FormData` building code
- **Array query params**: `searchParams.append` in `for...of` loop (not `set`) for `string[]`/`number[]`
- **Header params**: `headerNameToCamelCase()` converts `X-My-Header` to `xMyHeader`; merged into `params`, spread into fetch headers
- **Zod schema ordering** (`zod.ts` plugin): schemas are topologically sorted before emission so dependencies always precede their dependents; mutual cycles are detected via Kahn's algorithm and both schemas wrapped in `z.lazy()`

## Config
Default: `openapi-zod-ts.config.json` in CWD. `--config <path>` resolves relative paths from config file's directory.

### `drift` field (optional)
Controls how schema drift is handled when `input_schema` is configured:
- Omitted or `'warn'` (default): log warnings to stderr, continue, exit 0. Behavior unchanged from before.
- `'error'`: throw and exit non-zero when drift is detected (missing component schema or missing synthesized inline-response schema in the user's schema file).

Drift detection only applies when `input_schema` is configured. Extra exports in the schema file are always allowed (users add FE-only or BE-only refinements).

### `--check` CLI flag
Run a read-only drift check. No files are written. Any drift is an error (regardless of `config.drift`). Exits non-zero on drift.

Recommended CI usage: run `openapi-zod-ts --check` (or `openapi-zod-ts --config path/to/config.json --check`) as a PR gate alongside `pnpm fallow:audit`. This catches FE/BE contract drift before a merge lands.

Cannot be combined with `--watch`.

## Test / build
```
pnpm test           # vitest (excludes integration)
pnpm build          # tsc + chmod +x dist/cli.js
```
Fixtures live in `src/__fixtures__/specs/`: all fictional, never real client specs.

Stryker mutation testing runs here (`stryker.config.json`); run it locally to catch tests that pass without truly asserting behavior.

## Integration test suite: examples/
The `examples/` directory at the repo root is the real-world integration suite for this generator:
- **13 showcase specs**: committed generated output, drift detection plus `tsc --strict` typecheck on every relevant PR
- **115 compat matrix specs**: generated at CI time, all 115 generate without errors (128/128 total)
- Known edge cases handled: dots in operationIds (Google APIs), spaces, special characters
- See `examples/README.md` for the full breakdown
