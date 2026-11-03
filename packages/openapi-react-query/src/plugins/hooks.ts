import type { OpenAPIV3_1 } from 'openapi-types'
import {
  sanitizeOperationId,
  deriveOperationName,
  uniquifyName,
  buildWritableVariantMap,
  resolveBodyRefToWritableName,
  CLIENT_INTERNAL_NAMES,
  getParamPresence,
  buildOperationErrorTypeNames,
} from 'openapi-zod-ts'

type OperationObject = OpenAPIV3_1.OperationObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type PathItemObject = OpenAPIV3_1.PathItemObject
type ParameterObject = OpenAPIV3_1.ParameterObject

export interface HookGenOptions {
  staleTime: number
  gcTime: number
  suspense?: boolean
  overrides?: Record<string, { staleTime: number; gcTime: number }>
  autoInvalidate?: boolean
  /**
   * Controls infinite query hook generation.
   * - 'auto' (default): emit useXxxInfinite when pagination params are detected.
   * - true: emit useXxxInfinite for all list GET ops regardless of param names.
   * - false: never emit useXxxInfinite hooks.
   */
  infiniteQuery?: boolean | 'auto'
  /**
   * When true, hooks type their error as the client's per-operation error alias
   * (e.g. `GetPetError = ApiError<404, NotFound> | ApiError<422, ...>`) instead of
   * bare `ApiError`, so `error.status === 422` narrows `error.body`. Operations
   * without documented 4xx/5xx responses keep `ApiError`. Default: false.
   */
  typedErrors?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRef(obj: unknown): obj is ReferenceObject {
  return typeof obj === 'object' && obj !== null && '$ref' in obj
}

function refToName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1]!
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type SupportedMethod = (typeof SUPPORTED_METHODS)[number]

function extractPathParams(path: string): string[] {
  const matches = path.match(/\{([^}]+)\}/g)
  if (matches === null) return []
  return matches.map((m) => sanitizeOperationId(m.slice(1, -1)))
}

/** Extract primary resource name from path (first static segment after stripping API prefix) */
function primaryResource(path: string): string {
  // Strip /api/v{N}/ prefix or leading /
  const stripped = path.replace(/^\/api\/v\d+\//, '').replace(/^\//, '')
  const firstSegment = stripped.split('/')[0] ?? 'resource'
  // Remove any path param braces if somehow first seg is param
  return firstSegment.replace(/[{}]/g, '')
}

/**
 * Singularize a camelCase plural word using common English rules.
 *
 * Rules (applied in priority order):
 * 1. ends in `ies` (but not just `ies`): replace with `y`
 *    currencies → currency, categories → category
 * 2. ends in `sses`, `xes`, `zes`, `ches`, `shes`: strip `es`
 *    addresses → address, boxes → box, batches → batch
 * 3. ends in `s` (but not `ss`): strip `s`
 *    tasks → task, settings → setting, selections → selection
 * 4. no change otherwise
 */
function singularize(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) {
    return word.slice(0, -3) + 'y'
  }
  if (
    word.endsWith('sses') ||
    word.endsWith('xes') ||
    word.endsWith('zes') ||
    word.endsWith('ches') ||
    word.endsWith('shes')
  ) {
    return word.slice(0, -2)
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

/** Convert tag to valid camelCase identifier, then singularize. e.g. page-selections → pageSelection */
function toKeyFactoryName(resource: string): string {
  // Sanitize the resource to a valid camelCase identifier, then singularize
  const camel = sanitizeOperationId(resource)
  return singularize(camel)
}

interface OperationMeta {
  funcName: string
  hookName: string
  method: SupportedMethod
  path: string
  pathParams: string[]
  hasBody: boolean
  bodyTypeName: string | undefined
  hasQueryParams: boolean
  hasRequiredQueryParams: boolean
  deprecated: boolean
  isPaginated: boolean
  pageParamName: string | undefined
  /** TError for this operation's hooks: `ApiError` or the client's per-operation alias. */
  errorType: string
}

// ── Pagination detection ───────────────────────────────────────────────────────

/** Param names that signal a paginated list endpoint. First match wins. */
const PAGINATION_PARAM_NAMES = new Set([
  'page',
  'cursor',
  'offset',
  'pageToken',
  'pagetoken',
  'after',
  'before',
  'next_page',
  'nextPage',
  'page_token',
])

// Intentional mirror of openapi-zod-ts client.ts resolveParamRef — kept local to
// avoid a circular dependency between the two packages. Component-ref resolution
// only; deep JSON-pointer refs are out of scope for pagination detection.
function resolveParamRef(
  p: ParameterObject | ReferenceObject,
  spec: OpenAPIV3_1.Document,
  visited?: Set<string>
): ParameterObject | null {
  if (!isRef(p)) return p as ParameterObject
  const ref = (p as ReferenceObject).$ref
  const visitedSet = visited ?? new Set<string>()
  if (visitedSet.has(ref)) return null
  visitedSet.add(ref)

  const match = /^#\/components\/parameters\/(.+)$/.exec(ref)
  if (match !== null) {
    const name = match[1]!
    const params = spec.components?.parameters as
      Record<string, ParameterObject | ReferenceObject> | undefined
    const resolved = params?.[name]
    if (resolved === undefined) return null
    return resolveParamRef(resolved, spec, visitedSet)
  }
  return null
}

/**
 * Returns resolved query parameter names for an operation.
 * Merges path-item and operation parameters, resolves $ref params, and
 * returns the names of all query-in parameters.
 */
function getResolvedQueryParamNames(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): string[] {
  const pathItemParams = (pathItem.parameters ?? []) as (ParameterObject | ReferenceObject)[]
  const operationParams = (operation.parameters ?? []) as (ParameterObject | ReferenceObject)[]
  const all = [...pathItemParams, ...operationParams]
  const resolved = all
    .map((p) => resolveParamRef(p, spec))
    .filter((p): p is ParameterObject => p !== null)
  // Deduplicate by (name, in) — operation wins over path-item
  const seen = new Map<string, ParameterObject>()
  for (const p of resolved) {
    seen.set(`${p.name}::${p.in}`, p)
  }
  return [...seen.values()].filter((p) => p.in === 'query').map((p) => p.name)
}

const PAGINATED_FALSE = { isPaginated: false, pageParamName: undefined } as const

/**
 * Handles the explicit `x-infinite: true` case.
 * Warns and returns a no-op when no query params exist to inject pageParam into.
 */
function detectPaginationXInfiniteTrue(
  operation: OperationObject,
  pathItem: PathItemObject,
  spec: OpenAPIV3_1.Document
): { isPaginated: boolean; pageParamName: string | undefined } {
  const queryNames = getResolvedQueryParamNames(pathItem, operation, spec)
  const match = queryNames.find((n) => PAGINATION_PARAM_NAMES.has(n))
  const pageParam = match ?? queryNames[0]
  if (pageParam === undefined) {
    const opId = operation.operationId ?? '(unknown operationId)'
    console.warn(
      `[openapi-react-query] x-infinite: true on "${opId}" but no query params were found. ` +
        `No useXxxInfinite hook will be emitted. ` +
        `Add at least one query parameter to the operation or remove x-infinite.`
    )
    return PAGINATED_FALSE
  }
  return { isPaginated: true, pageParamName: pageParam }
}

/**
 * Heuristic path: checks for pagination param names among resolved query params.
 * Respects the `infiniteQuery` option (force-on / auto).
 */
function detectPaginationHeuristic(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document,
  infiniteQuery: boolean | 'auto'
): { isPaginated: boolean; pageParamName: string | undefined } {
  const queryNames = getResolvedQueryParamNames(pathItem, operation, spec)
  const match = queryNames.find((n) => PAGINATION_PARAM_NAMES.has(n))
  if (infiniteQuery === true) {
    return { isPaginated: true, pageParamName: match ?? queryNames[0] }
  }
  // Default 'auto': only emit when a recognized pagination param is present
  return match !== undefined ? { isPaginated: true, pageParamName: match } : PAGINATED_FALSE
}

/**
 * Detects whether an operation should receive an infinite query hook.
 *
 * Priority order:
 * 1. `x-infinite: true/false` on the operation (explicit opt-in/out).
 * 2. Heuristic: list-level GET (no path params) with a recognized pagination
 *    query param name.
 * 3. `infiniteQuery: true` forces detection for all list GET ops even without
 *    standard param names.
 *
 * Returns `{ isPaginated, pageParamName }`.
 */
function detectPagination(
  operation: OperationObject,
  pathItem: PathItemObject,
  spec: OpenAPIV3_1.Document,
  pathParams: string[],
  infiniteQuery: boolean | 'auto'
): { isPaginated: boolean; pageParamName: string | undefined } {
  const xInfinite = (operation as Record<string, unknown>)['x-infinite']
  if (xInfinite === true) return detectPaginationXInfiniteTrue(operation, pathItem, spec)
  if (xInfinite === false) return PAGINATED_FALSE
  if (pathParams.length > 0) return PAGINATED_FALSE
  if (infiniteQuery === false) return PAGINATED_FALSE
  return detectPaginationHeuristic(pathItem, operation, spec, infiniteQuery)
}

// getBodyInfo gained the writable-variant redirect (#242); complexity is under
// thresholds (CRAP-only flag), covered by the XWritable mutation test.
// fallow-ignore-next-line complexity
function getBodyInfo(
  operation: OperationObject,
  writableVariantMap: Map<string, string>
): {
  hasBody: boolean
  bodyTypeName: string | undefined
} {
  const requestBody = operation.requestBody as
    OpenAPIV3_1.RequestBodyObject | ReferenceObject | undefined
  if (requestBody === undefined) return { hasBody: false, bodyTypeName: undefined }
  if (isRef(requestBody)) return { hasBody: true, bodyTypeName: undefined }

  const rb = requestBody as OpenAPIV3_1.RequestBodyObject
  const content = rb.content as
    Record<string, { schema?: OpenAPIV3_1.SchemaObject | ReferenceObject }> | undefined
  if (content === undefined) return { hasBody: true, bodyTypeName: undefined }

  // Check multipart first
  if (content['multipart/form-data'] !== undefined) {
    return { hasBody: true, bodyTypeName: undefined }
  }

  const jsonContent = content['application/json']
  if (jsonContent === undefined || jsonContent.schema === undefined) {
    return { hasBody: true, bodyTypeName: undefined }
  }

  const schema = jsonContent.schema
  if (isRef(schema)) {
    const ref = (schema as ReferenceObject).$ref
    // When the referenced schema has a writable variant (readOnly/writeOnly props),
    // use XWritable so mutation variables match the write shape, not the read shape.
    const writableName = resolveBodyRefToWritableName(ref, writableVariantMap)
    if (writableName !== undefined) {
      return { hasBody: true, bodyTypeName: writableName }
    }
    return { hasBody: true, bodyTypeName: refToName(ref) }
  }

  // Inline schema
  const s = schema as OpenAPIV3_1.SchemaObject
  if (s.type === 'object') {
    return { hasBody: true, bodyTypeName: 'Record<string, unknown>' }
  }
  return { hasBody: true, bodyTypeName: undefined }
}

// ── Key factory generation ─────────────────────────────────────────────────────

interface KeyEntry {
  key: string // e.g. 'list' | 'detail' | operationId-derived
  funcName: string // function to use in key factory
  pathParams: string[]
  hasQueryParams: boolean
  hasRequiredQueryParams: boolean
}

// pre-existing size; decomposition deferred (buildMutationHook and generateHooks were the #244 targets)
// fallow-ignore-next-line complexity
function buildKeyFactory(resource: string, entries: KeyEntry[]): string {
  const factoryName = `${toKeyFactoryName(resource)}Keys`
  const lines: string[] = []
  lines.push(`export const ${factoryName} = {`)
  lines.push(`  all: () => [${JSON.stringify(resource)}] as const,`)

  for (const entry of entries) {
    const paramsOptional = !entry.hasRequiredQueryParams
    const paramsArg = paramsOptional
      ? `params?: Parameters<typeof ${entry.funcName}>[${entry.pathParams.length}]`
      : `params: Parameters<typeof ${entry.funcName}>[${entry.pathParams.length}]`

    // When multiple detail-level GET ops share the same resource (e.g. GET /items/{id}
    // and GET /items/{id}/usage), each gets a funcName-derived key instead of 'detail'.
    // Include the key name as a segment to prevent cache key collisions.
    // Single detail ops keep the canonical ['resource', id] shape (no breaking change).
    const keySegment =
      entry.pathParams.length > 0 && entry.key !== 'detail' ? `'${entry.key}', ` : ''

    if (entry.pathParams.length === 0 && entry.hasQueryParams) {
      // list: (params?) => ['resource', 'list', params]
      lines.push(
        `  ${entry.key}: (${paramsArg}) => [${JSON.stringify(resource)}, '${entry.key}', params] as const,`
      )
    } else if (entry.pathParams.length === 0 && !entry.hasQueryParams) {
      // list with no params
      lines.push(`  ${entry.key}: () => [${JSON.stringify(resource)}, '${entry.key}'] as const,`)
    } else if (entry.pathParams.length === 1 && !entry.hasQueryParams) {
      // detail: (id) => ['resource', id]  or  getItemUsage: (id) => ['resource', 'getItemUsage', id]
      const param = entry.pathParams[0]!
      lines.push(
        `  ${entry.key}: (${param}: Parameters<typeof ${entry.funcName}>[0]) => [${JSON.stringify(resource)}, ${keySegment}${param}] as const,`
      )
    } else if (entry.pathParams.length === 1 && entry.hasQueryParams) {
      // detail with query params
      const param = entry.pathParams[0]!
      lines.push(
        `  ${entry.key}: (${param}: Parameters<typeof ${entry.funcName}>[0], ${paramsArg}) => [${JSON.stringify(resource)}, ${keySegment}${param}, params] as const,`
      )
    } else if (!entry.hasQueryParams) {
      // multiple path params, no query params
      const paramList = entry.pathParams
        .map((p, i) => `${p}: Parameters<typeof ${entry.funcName}>[${i}]`)
        .join(', ')
      const paramValues = entry.pathParams.join(', ')
      lines.push(
        `  ${entry.key}: (${paramList}) => [${JSON.stringify(resource)}, ${keySegment}${paramValues}] as const,`
      )
    } else {
      // multiple path params + query params
      const paramList = entry.pathParams
        .map((p, i) => `${p}: Parameters<typeof ${entry.funcName}>[${i}]`)
        .join(', ')
      const paramValues = entry.pathParams.join(', ')
      lines.push(
        `  ${entry.key}: (${paramList}, ${paramsArg}) => [${JSON.stringify(resource)}, ${keySegment}${paramValues}, params] as const,`
      )
    }
  }

  lines.push(`}`)
  return lines.join('\n')
}

// ── queryOptions factory generation ───────────────────────────────────────────

/**
 * The raw response type of a client function (the queryFn's resolved value).
 * Every query hook / factory also takes a `TData` generic defaulting to this
 * type, so a caller's `select` transform narrows the hook's `data` type
 * (#195). The default keeps existing call sites source compatible.
 */
function queryDataType(funcName: string): string {
  return `Awaited<ReturnType<typeof ${funcName}>>`
}

/**
 * Derives the factory function name for a GET operation.
 * e.g. funcName "listTasks" -> "listTasksQueryOptions"
 */
function queryOptionsFuncName(funcName: string): string {
  return `${funcName}QueryOptions`
}

/**
 * Builds the queryKey call string used in both the factory and the hooks.
 * When nonNullPathParams is true, each path param is suffixed with ! (for the
 * useQuery hook, which widens param types to allow null/undefined and uses an
 * enabled guard). When false (factory, suspense hook), params are plain strings.
 */
function buildQueryKeyCall(
  keyFactoryName: string,
  keyEntry: KeyEntry,
  pathParams: string[],
  hasQueryParams: boolean,
  nonNullPathParams: boolean
): string {
  const suffix = nonNullPathParams ? '!' : ''
  const base = `${keyFactoryName}.${keyEntry.key}`

  if (pathParams.length === 0) {
    return hasQueryParams ? `${base}(params)` : `${base}()`
  }

  const paramValues = pathParams.map((p) => `${p}${suffix}`).join(', ')
  return hasQueryParams ? `${base}(${paramValues}, params)` : `${base}(${paramValues})`
}

/**
 * Generates a plain queryOptions(...) factory for a GET operation.
 * The factory is suitable for use in RSC / server-side prefetching:
 *   await queryClient.prefetchQuery(listTasksQueryOptions(params))
 */
function buildQueryOptionsFactory(
  op: OperationMeta,
  keyFactoryName: string,
  keyEntry: KeyEntry,
  staleTime: number,
  gcTime: number
): string {
  const lines: string[] = []
  const dataType = queryDataType(op.funcName)

  const hasQueryParams = keyEntry.hasQueryParams
  const paramsRequired = keyEntry.hasRequiredQueryParams
  const pathParams = op.pathParams

  // Build parameter list. Path param types are derived from the client function
  // signature (Parameters<typeof fn>[i]) rather than hard-coded to string, so
  // integer path params stay typed as number (#300). No nullish widening here.
  const sigParts: string[] = []
  pathParams.forEach((p, i) => {
    sigParts.push(`${p}: Parameters<typeof ${op.funcName}>[${i}]`)
  })
  if (hasQueryParams) {
    const paramsToken = paramsRequired ? 'params' : 'params?'
    sigParts.push(`${paramsToken}: Parameters<typeof ${op.funcName}>[${pathParams.length}]`)
  }
  sigParts.push(
    `options?: Omit<UseQueryOptions<${dataType}, ${op.errorType}, TData>, 'queryKey' | 'queryFn'>`
  )

  const queryKeyCall = buildQueryKeyCall(
    keyFactoryName,
    keyEntry,
    pathParams,
    hasQueryParams,
    false
  )

  const queryFnArgs: string[] = [...pathParams]
  if (hasQueryParams) queryFnArgs.push('params')
  const queryFnCall = `${op.funcName}(${queryFnArgs.join(', ')})`

  const factoryName = queryOptionsFuncName(op.funcName)

  if (op.deprecated) {
    lines.push(`/** @deprecated */`)
  }
  lines.push(`export function ${factoryName}<TData = ${dataType}>(`)
  lines.push(`  ${sigParts.join(',\n  ')},`)
  lines.push(`) {`)
  lines.push(`  return queryOptions<${dataType}, ${op.errorType}, TData>({`)
  lines.push(`    queryKey: ${queryKeyCall},`)
  lines.push(`    queryFn: () => ${queryFnCall},`)
  lines.push(`    staleTime: ${staleTime},`)
  lines.push(`    gcTime: ${gcTime},`)
  lines.push(`    ...options,`)
  lines.push(`  })`)
  lines.push(`}`)

  return lines.join('\n')
}

// ── Query hook generation ──────────────────────────────────────────────────────

function buildQueryHook(
  op: OperationMeta,
  keyFactoryName: string,
  keyEntry: KeyEntry,
  staleTime: number,
  gcTime: number
): string {
  const lines: string[] = []
  const dataType = queryDataType(op.funcName)

  const hasQueryParams = keyEntry.hasQueryParams
  const paramsRequired = keyEntry.hasRequiredQueryParams
  const pathParams = op.pathParams
  const hasPathParams = pathParams.length > 0

  // Build parameter list
  const sigParts: string[] = []
  pathParams.forEach((p, i) => {
    // Widen path param types to allow nullish values — enables auto-disable without !!id boilerplate.
    // The base type is derived from the client function so integer params stay number (#300).
    sigParts.push(`${p}: Parameters<typeof ${op.funcName}>[${i}] | undefined | null`)
  })
  if (hasQueryParams) {
    const paramsToken = paramsRequired ? 'params' : 'params?'
    sigParts.push(`${paramsToken}: Parameters<typeof ${op.funcName}>[${pathParams.length}]`)
  }
  sigParts.push(
    `options?: Omit<UseQueryOptions<${dataType}, ${op.errorType}, TData>, 'queryKey' | 'queryFn'>`
  )

  // Build queryKey call (with non-null assertions for path params, since hook has enabled guard)
  const queryKeyCall = buildQueryKeyCall(keyFactoryName, keyEntry, pathParams, hasQueryParams, true)

  // Build queryFn call — use non-null assertions
  let queryFnArgs: string[] = pathParams.map((p) => `${p}!`)
  if (hasQueryParams) queryFnArgs.push('params')
  const queryFnCall = `${op.funcName}(${queryFnArgs.join(', ')})`

  // Build enabled expression for path-param hooks
  const enabledExpr = hasPathParams
    ? `${pathParams.map((p) => `${p} != null`).join(' && ')} && (options?.enabled ?? true)`
    : undefined

  // @deprecated JSDoc on deprecated operations
  if (op.deprecated) {
    lines.push(`/** @deprecated */`)
  }
  lines.push(`export function ${op.hookName}<TData = ${dataType}>(`)
  lines.push(`  ${sigParts.join(',\n  ')},`)
  lines.push(`) {`)
  lines.push(`  return useQuery<${dataType}, ${op.errorType}, TData>({`)
  lines.push(`    queryKey: ${queryKeyCall},`)
  lines.push(`    queryFn: () => ${queryFnCall},`)
  lines.push(`    staleTime: ${staleTime},`)
  lines.push(`    gcTime: ${gcTime},`)
  if (enabledExpr !== undefined) {
    lines.push(`    enabled: ${enabledExpr},`)
  }
  lines.push(`    ...options,`)
  lines.push(`  })`)
  lines.push(`}`)

  return lines.join('\n')
}

function buildSuspenseQueryHook(
  op: OperationMeta,
  keyFactoryName: string,
  keyEntry: KeyEntry,
  staleTime: number,
  gcTime: number
): string {
  const lines: string[] = []
  const dataType = queryDataType(op.funcName)

  const hasQueryParams = keyEntry.hasQueryParams
  const paramsRequired = keyEntry.hasRequiredQueryParams
  const pathParams = op.pathParams

  // Suspense hooks require path params (no nullish widening — suspense doesn't support enabled).
  // Path param types are derived from the client function so integer params stay number (#300).
  const sigParts: string[] = []
  pathParams.forEach((p, i) => {
    sigParts.push(`${p}: Parameters<typeof ${op.funcName}>[${i}]`)
  })
  if (hasQueryParams) {
    const paramsToken = paramsRequired ? 'params' : 'params?'
    sigParts.push(`${paramsToken}: Parameters<typeof ${op.funcName}>[${pathParams.length}]`)
  }
  sigParts.push(
    `options?: Omit<UseSuspenseQueryOptions<${dataType}, ${op.errorType}, TData>, 'queryKey' | 'queryFn'>`
  )

  // Build queryKey call (no non-null assertions — suspense params are always required strings)
  const queryKeyCall = buildQueryKeyCall(
    keyFactoryName,
    keyEntry,
    pathParams,
    hasQueryParams,
    false
  )

  // Build queryFn call
  const queryFnArgs: string[] = [...pathParams]
  if (hasQueryParams) queryFnArgs.push('params')
  const queryFnCall = `${op.funcName}(${queryFnArgs.join(', ')})`

  const suspenseHookName = `useSuspense${capitalize(op.funcName)}`

  if (op.deprecated) {
    lines.push(`/** @deprecated */`)
  }
  lines.push(`export function ${suspenseHookName}<TData = ${dataType}>(`)
  lines.push(`  ${sigParts.join(',\n  ')},`)
  lines.push(`) {`)
  lines.push(`  return useSuspenseQuery<${dataType}, ${op.errorType}, TData>({`)
  lines.push(`    queryKey: ${queryKeyCall},`)
  lines.push(`    queryFn: () => ${queryFnCall},`)
  lines.push(`    staleTime: ${staleTime},`)
  lines.push(`    gcTime: ${gcTime},`)
  lines.push(`    ...options,`)
  lines.push(`  })`)
  lines.push(`}`)

  return lines.join('\n')
}

// ── Infinite query hook generation ────────────────────────────────────────────

/**
 * Builds the query key call for the infinite hook.
 * Reuses the existing list key entry with an appended 'infinite' segment so
 * infinite queries are namespaced away from regular list queries.
 */
function buildInfiniteQueryKeyCall(
  keyFactoryName: string,
  keyEntry: KeyEntry,
  hasQueryParams: boolean
): string {
  const base = `${keyFactoryName}.${keyEntry.key}`
  const listCall = hasQueryParams ? `${base}(params)` : `${base}()`
  return `[...${listCall}, 'infinite']`
}

/**
 * Builds a `useXxxInfinite` hook for a paginated list operation.
 *
 * The hook:
 * - Is named `use${capitalize(funcName)}Infinite` (mirrors useSuspense* suffix).
 * - Accepts all params as the regular list hook (path params are none for list ops).
 * - Injects `pageParam` from React Query into the client call.
 * - Provides default `initialPageParam: undefined` and a placeholder
 *   `getNextPageParam: () => undefined`; callers override both via `options`.
 */
function buildInfiniteQueryHook(
  op: OperationMeta,
  keyFactoryName: string,
  keyEntry: KeyEntry,
  pageParamName: string,
  staleTime: number,
  gcTime: number
): string {
  const lines: string[] = []
  const { funcName, hasQueryParams, hasRequiredQueryParams, deprecated } = op
  const infiniteHookName = `use${capitalize(funcName)}Infinite`
  const dataType = queryDataType(funcName)

  const sigParts: string[] = []
  if (hasQueryParams) {
    const paramsToken = hasRequiredQueryParams ? 'params' : 'params?'
    sigParts.push(`${paramsToken}: Parameters<typeof ${funcName}>[0]`)
  }
  sigParts.push(
    `options?: Omit<UseInfiniteQueryOptions<${dataType}, ${op.errorType}, TData, QueryKey, unknown>, 'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'>`
  )

  const queryKeyCall = buildInfiniteQueryKeyCall(keyFactoryName, keyEntry, hasQueryParams)

  // Build queryFn: merges pageParam into the params object under the detected param name
  let queryFnBody: string
  if (hasQueryParams) {
    queryFnBody = `({ pageParam }) => ${funcName}({ ...params, ${JSON.stringify(pageParamName)}: pageParam as never })`
  } else {
    queryFnBody = `({ pageParam }) => ${funcName}({ ${JSON.stringify(pageParamName)}: pageParam as never } as never)`
  }

  if (deprecated) {
    lines.push(`/** @deprecated */`)
  }
  lines.push(`export function ${infiniteHookName}<TData = InfiniteData<${dataType}>>(`)
  lines.push(`  ${sigParts.join(',\n  ')},`)
  lines.push(`) {`)
  lines.push(`  return useInfiniteQuery<${dataType}, ${op.errorType}, TData, QueryKey, unknown>({`)
  lines.push(`    queryKey: ${queryKeyCall},`)
  lines.push(`    queryFn: ${queryFnBody},`)
  lines.push(`    initialPageParam: undefined,`)
  lines.push(`    // Override getNextPageParam in options to enable actual pagination.`)
  lines.push(`    getNextPageParam: () => undefined,`)
  lines.push(`    staleTime: ${staleTime},`)
  lines.push(`    gcTime: ${gcTime},`)
  lines.push(`    ...options,`)
  lines.push(`  })`)
  lines.push(`}`)

  return lines.join('\n')
}

// ── Mutation hook generation ───────────────────────────────────────────────────

interface MutationInvalidateInfo {
  keyFactoryName: string
  detailKeyName: string | undefined
}

/**
 * Computes the `variablesType` and `mutationFnBody` strings for a mutation hook.
 *
 * The client function argument order is: ...pathParams, body?, params?
 * The dispatch is over three boolean flags: pathParam count (0, 1, >1) x hasBody x hasQueryParams.
 */
function buildMutationVars(
  op: OperationMeta,
  paramsArgIndex: number
): { variablesType: string; mutationFnBody: string } {
  const { funcName, pathParams, hasBody, hasQueryParams } = op

  // No path params
  if (pathParams.length === 0) {
    if (!hasBody && !hasQueryParams) {
      return { variablesType: 'void', mutationFnBody: `() => ${funcName}()` }
    }
    if (!hasBody && hasQueryParams) {
      // params-only mutation: fn(params)
      return {
        variablesType: `Parameters<typeof ${funcName}>[0]`,
        mutationFnBody: `(vars) => ${funcName}(vars)`,
      }
    }
    if (hasBody && !hasQueryParams) {
      // body-only mutation: fn(body)
      return {
        variablesType: `Parameters<typeof ${funcName}>[0]`,
        mutationFnBody: `(vars) => ${funcName}(vars)`,
      }
    }
    // body + params: fn(body, params)
    return {
      variablesType: `{ body: Parameters<typeof ${funcName}>[0]; params: Parameters<typeof ${funcName}>[${paramsArgIndex}] }`,
      mutationFnBody: `({ body, params }) => ${funcName}(body, params)`,
    }
  }

  // Exactly one path param
  if (pathParams.length === 1) {
    const param = pathParams[0]!
    if (!hasBody && !hasQueryParams) {
      return {
        variablesType: `Parameters<typeof ${funcName}>[0]`,
        mutationFnBody: `(${param}) => ${funcName}(${param})`,
      }
    }
    if (!hasBody && hasQueryParams) {
      // 1 path param + params only
      return {
        variablesType: `{ ${param}: Parameters<typeof ${funcName}>[0]; params: Parameters<typeof ${funcName}>[${paramsArgIndex}] }`,
        mutationFnBody: `({ ${param}, params }) => ${funcName}(${param}, params)`,
      }
    }
    if (hasBody && !hasQueryParams) {
      return {
        variablesType: `{ ${param}: Parameters<typeof ${funcName}>[0]; body: Parameters<typeof ${funcName}>[1] }`,
        mutationFnBody: `({ ${param}, body }) => ${funcName}(${param}, body)`,
      }
    }
    // 1 path param + body + params
    return {
      variablesType: `{ ${param}: Parameters<typeof ${funcName}>[0]; body: Parameters<typeof ${funcName}>[1]; params: Parameters<typeof ${funcName}>[${paramsArgIndex}] }`,
      mutationFnBody: `({ ${param}, body, params }) => ${funcName}(${param}, body, params)`,
    }
  }

  // Multiple path params. Each path param type is derived from its positional
  // index in the client function so integer params stay number (#300).
  const fields = pathParams.map((p, i) => `${p}: Parameters<typeof ${funcName}>[${i}]`).join('; ')
  if (!hasBody && !hasQueryParams) {
    const destructured = pathParams.join(', ')
    return {
      variablesType: `{ ${fields} }`,
      mutationFnBody: `({ ${destructured} }) => ${funcName}(${destructured})`,
    }
  }
  if (!hasBody && hasQueryParams) {
    // multiple path params + params only
    const destructured = [...pathParams, 'params'].join(', ')
    return {
      variablesType: `{ ${fields}; params: Parameters<typeof ${funcName}>[${paramsArgIndex}] }`,
      mutationFnBody: `({ ${destructured} }) => ${funcName}(${[...pathParams, 'params'].join(', ')})`,
    }
  }
  if (hasBody && !hasQueryParams) {
    // multiple path params + body
    const destructured = [...pathParams, 'body'].join(', ')
    return {
      variablesType: `{ ${fields}; body: Parameters<typeof ${funcName}>[${pathParams.length}] }`,
      mutationFnBody: `({ ${destructured} }) => ${funcName}(${[...pathParams, 'body'].join(', ')})`,
    }
  }
  // multiple path params + body + params
  const destructured = [...pathParams, 'body', 'params'].join(', ')
  return {
    variablesType: `{ ${fields}; body: Parameters<typeof ${funcName}>[${pathParams.length}]; params: Parameters<typeof ${funcName}>[${paramsArgIndex}] }`,
    mutationFnBody: `({ ${destructured} }) => ${funcName}(${[...pathParams, 'body', 'params'].join(', ')})`,
  }
}

function buildMutationHook(
  op: OperationMeta,
  autoInvalidate: boolean,
  invalidateInfo: MutationInvalidateInfo | undefined
): string {
  const lines: string[] = []
  const { funcName, hookName, pathParams, hasBody, hasQueryParams } = op

  // Compute the index of the params argument in the client function signature
  const paramsArgIndex = pathParams.length + (hasBody ? 1 : 0)

  const { variablesType, mutationFnBody } = buildMutationVars(op, paramsArgIndex)

  // @deprecated JSDoc on deprecated operations
  if (op.deprecated) {
    lines.push(`/** @deprecated */`)
  }
  lines.push(`export function ${hookName}(`)
  lines.push(
    `  options?: Omit<UseMutationOptions<Awaited<ReturnType<typeof ${funcName}>>, ${op.errorType}, ${variablesType}>, 'mutationFn'>,`
  )
  lines.push(`) {`)

  const shouldInvalidate = autoInvalidate && invalidateInfo !== undefined
  if (shouldInvalidate) {
    lines.push(`  const queryClient = useQueryClient()`)
  }

  lines.push(
    `  return useMutation<Awaited<ReturnType<typeof ${funcName}>>, ${op.errorType}, ${variablesType}>({`
  )
  lines.push(`    mutationFn: ${mutationFnBody},`)
  // Spread options first so caller can override mutationFn-unrelated options (e.g. retry, meta).
  // onSuccess must come AFTER the spread so the auto-invalidation logic always runs —
  // the caller's onSuccess is composed via options?.onSuccess?.(...args) inside.
  lines.push(`    ...options,`)

  if (shouldInvalidate) {
    const { keyFactoryName, detailKeyName } = invalidateInfo
    const canInvalidateDetail =
      detailKeyName !== undefined &&
      pathParams.length >= 1 &&
      (op.method === 'put' || op.method === 'patch')

    // Determine how to reference the first path param from variables in onSuccess
    let detailIdRef: string
    if (pathParams.length === 1 && !hasBody && !hasQueryParams) {
      // variablesType is 'string' — variables IS the id directly
      detailIdRef = 'variables'
    } else if (pathParams.length >= 1) {
      // variablesType is an object — access via property name
      detailIdRef = `variables.${pathParams[0]}`
    } else {
      detailIdRef = 'variables'
    }

    lines.push(`    onSuccess: (...args) => {`)
    if (canInvalidateDetail) {
      lines.push(`      const [, variables] = args`)
    }
    lines.push(`      queryClient.invalidateQueries({ queryKey: ${keyFactoryName}.all() })`)
    if (canInvalidateDetail) {
      lines.push(
        `      queryClient.invalidateQueries({ queryKey: ${keyFactoryName}.${detailKeyName}(${detailIdRef}) })`
      )
    }
    lines.push(`      options?.onSuccess?.(...args)`)
    lines.push(`    },`)
  }

  lines.push(`  })`)
  lines.push(`}`)

  return lines.join('\n')
}

// ── Main generator ─────────────────────────────────────────────────────────────

// Cognitive complexity is dominated by the two nested for-loops that existed
// before #189; the pagination detection call added here is a single ternary.
// fallow-ignore-next-line complexity
/**
 * Walks all paths in the spec and produces a flat list of OperationMeta records.
 *
 * Name deduplication mirrors the client generator so that funcName values stay in
 * sync with client exports (e.g. getConfig -> getConfig_2, fetch -> fetch_2).
 */
function collectOperations(
  spec: OpenAPIV3_1.Document,
  infiniteQuery: boolean | 'auto' = 'auto',
  errorTypeNames: ReadonlyMap<string, string> = new Map()
): OperationMeta[] {
  const paths = spec.paths as Record<string, Record<string, OperationObject>> | undefined

  // Build the writable-variant map so getBodyInfo can redirect request-body schemas
  // that have readOnly/writeOnly props to their XWritable variant.
  const writableVariantMap = buildWritableVariantMap(spec)

  // Pre-seed with client-internal names so that operation names derived from the spec
  // receive the same numeric suffix that the client generator assigns. This keeps hook
  // imports in sync with client exports (e.g. getConfig -> getConfig_2, fetch -> fetch_2).
  const usedFuncNames = new Set<string>(CLIENT_INTERNAL_NAMES)
  const usedHookNames = new Set<string>()

  const operations: OperationMeta[] = []

  if (paths !== undefined) {
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const method of SUPPORTED_METHODS) {
        const operation = pathItem[method] as OperationObject | undefined
        if (operation === undefined) continue

        // Derive and deduplicate the client function name. Must mirror the dedup
        // logic in openapi-zod-ts/client.ts so the import list stays in sync.
        let funcName: string
        if (operation.operationId !== undefined) {
          funcName = sanitizeOperationId(operation.operationId)
        } else {
          funcName = deriveOperationName(method, path)
        }
        funcName = uniquifyName(funcName, usedFuncNames)

        const hookName = uniquifyName('use' + capitalize(funcName), usedHookNames)
        const pathParams = extractPathParams(path)
        const { hasBody, bodyTypeName } = getBodyInfo(operation, writableVariantMap)
        // Use getParamPresence from openapi-zod-ts — it resolves $ref parameters and
        // merges path-item level parameters, exactly mirroring the client generator's
        // rule: params is present when any query or header param exists; it is required
        // when at least one of those params is required.
        const { hasParams, hasRequiredParams } = getParamPresence(
          pathItem as PathItemObject,
          operation,
          spec
        )
        const hasQueryParams = hasParams
        const hasRequiredQueryParams = hasRequiredParams
        const deprecated = operation.deprecated === true

        // Pagination detection only applies to GET operations
        const { isPaginated, pageParamName } =
          method === 'get'
            ? detectPagination(
                operation,
                pathItem as PathItemObject,
                spec,
                pathParams,
                infiniteQuery
              )
            : { isPaginated: false, pageParamName: undefined }

        operations.push({
          funcName,
          hookName,
          method,
          path,
          pathParams,
          hasBody,
          bodyTypeName,
          hasQueryParams,
          hasRequiredQueryParams,
          deprecated,
          isPaginated,
          pageParamName,
          errorType: errorTypeNames.get(funcName) ?? 'ApiError',
        })
      }
    }
  }

  return operations
}

export function generateHooks(
  spec: OpenAPIV3_1.Document,
  options: HookGenOptions
): { filename: string; content: string } {
  const {
    staleTime,
    gcTime,
    suspense = false,
    autoInvalidate = false,
    infiniteQuery = 'auto',
    typedErrors = false,
  } = options

  // Collect all operations (metadata extraction separated from string emission)
  const errorTypeNames = typedErrors ? buildOperationErrorTypeNames(spec) : undefined
  const operations = collectOperations(spec, infiniteQuery, errorTypeNames)

  // Separate GET vs mutation operations
  const getOps = operations.filter((op) => op.method === 'get')
  const mutationOps = operations.filter((op) => op.method !== 'get')

  // Group GET ops by resource for key factories
  const resourceToGetOps = new Map<string, OperationMeta[]>()
  for (const op of getOps) {
    const resource = primaryResource(op.path)
    const existing = resourceToGetOps.get(resource) ?? []
    existing.push(op)
    resourceToGetOps.set(resource, existing)
  }

  // Build key factories and track which key factory + entry each GET op uses
  const opToKeyInfo = new Map<string, { factoryName: string; keyEntry: KeyEntry }>()
  const keyFactoryBlocks: string[] = []

  for (const [resource, ops] of resourceToGetOps.entries()) {
    const factoryName = `${toKeyFactoryName(resource)}Keys`

    // Determine entry keys — list vs detail, or operationId-derived if ambiguous
    const listOps = ops.filter((op) => op.pathParams.length === 0)
    const detailOps = ops.filter((op) => op.pathParams.length > 0)

    const entries: KeyEntry[] = []

    if (listOps.length === 1) {
      const op = listOps[0]!
      const entry: KeyEntry = {
        key: 'list',
        funcName: op.funcName,
        pathParams: [],
        hasQueryParams: op.hasQueryParams,
        hasRequiredQueryParams: op.hasRequiredQueryParams,
      }
      entries.push(entry)
      opToKeyInfo.set(op.funcName, { factoryName, keyEntry: entry })
    } else if (listOps.length > 1) {
      for (const op of listOps) {
        const entry: KeyEntry = {
          key: op.funcName,
          funcName: op.funcName,
          pathParams: [],
          hasQueryParams: op.hasQueryParams,
          hasRequiredQueryParams: op.hasRequiredQueryParams,
        }
        entries.push(entry)
        opToKeyInfo.set(op.funcName, { factoryName, keyEntry: entry })
      }
    }

    if (detailOps.length === 1) {
      const op = detailOps[0]!
      const entry: KeyEntry = {
        key: 'detail',
        funcName: op.funcName,
        pathParams: op.pathParams,
        hasQueryParams: op.hasQueryParams,
        hasRequiredQueryParams: op.hasRequiredQueryParams,
      }
      entries.push(entry)
      opToKeyInfo.set(op.funcName, { factoryName, keyEntry: entry })
    } else if (detailOps.length > 1) {
      for (const op of detailOps) {
        const entry: KeyEntry = {
          key: op.funcName,
          funcName: op.funcName,
          pathParams: op.pathParams,
          hasQueryParams: op.hasQueryParams,
          hasRequiredQueryParams: op.hasRequiredQueryParams,
        }
        entries.push(entry)
        opToKeyInfo.set(op.funcName, { factoryName, keyEntry: entry })
      }
    }

    keyFactoryBlocks.push(buildKeyFactory(resource, entries))
  }

  // Build queryOptions factories and query hooks (and suspense/infinite variants if enabled)
  const queryOptionsBlocks: string[] = []
  const queryHookBlocks: string[] = []
  let needsUseInfiniteQuery = false
  for (const op of getOps) {
    const info = opToKeyInfo.get(op.funcName)
    if (info === undefined) continue
    const { factoryName, keyEntry } = info
    const resource = primaryResource(op.path)
    const resourceOverride = options.overrides?.[resource]
    const effectiveStaleTime = resourceOverride?.staleTime ?? staleTime
    const effectiveGcTime = resourceOverride?.gcTime ?? gcTime
    queryOptionsBlocks.push(
      buildQueryOptionsFactory(op, factoryName, keyEntry, effectiveStaleTime, effectiveGcTime)
    )
    queryHookBlocks.push(
      buildQueryHook(op, factoryName, keyEntry, effectiveStaleTime, effectiveGcTime)
    )
    if (suspense) {
      queryHookBlocks.push(
        buildSuspenseQueryHook(op, factoryName, keyEntry, effectiveStaleTime, effectiveGcTime)
      )
    }
    if (op.isPaginated && op.pageParamName !== undefined) {
      needsUseInfiniteQuery = true
      queryHookBlocks.push(
        buildInfiniteQueryHook(
          op,
          factoryName,
          keyEntry,
          op.pageParamName,
          effectiveStaleTime,
          effectiveGcTime
        )
      )
    }
  }

  // Build resource → detailKeyName map for auto-invalidate
  // detailKeyName is 'detail' when exactly one detail op exists (canonical name),
  // or undefined when zero or multiple detail ops exist (ambiguous — skip detail invalidation)
  const resourceDetailKeyName = new Map<string, string | undefined>()
  for (const [resource, ops] of resourceToGetOps.entries()) {
    const detailOps = ops.filter((op) => op.pathParams.length > 0)
    resourceDetailKeyName.set(resource, detailOps.length === 1 ? 'detail' : undefined)
  }

  // Build mutation hooks
  const mutationHookBlocks: string[] = []
  for (const op of mutationOps) {
    let invalidateInfo: MutationInvalidateInfo | undefined
    if (autoInvalidate) {
      const resource = primaryResource(op.path)
      // Only invalidate if a key factory exists for this resource (i.e. it has at least one GET op).
      // A mutation-only resource has no key factory — emitting invalidateQueries against it would
      // reference an undefined variable and crash at runtime.
      if (resourceToGetOps.has(resource)) {
        const keyFactoryName = `${toKeyFactoryName(resource)}Keys`
        const detailKeyName = resourceDetailKeyName.get(resource)
        invalidateInfo = { keyFactoryName, detailKeyName }
      }
    }
    mutationHookBlocks.push(buildMutationHook(op, autoInvalidate, invalidateInfo))
  }

  // Determine which react-query exports to import
  const needsQueryOptions = getOps.length > 0
  const needsUseQuery = getOps.length > 0
  const needsUseMutation = mutationOps.length > 0
  const needsUseSuspenseQuery = suspense && getOps.length > 0
  const needsUseQueryClient = autoInvalidate && needsUseMutation
  const rqImports: string[] = []
  if (needsQueryOptions) rqImports.push('queryOptions')
  if (needsUseQuery) rqImports.push('useQuery', 'type UseQueryOptions')
  if (needsUseSuspenseQuery) rqImports.push('useSuspenseQuery', 'type UseSuspenseQueryOptions')
  if (needsUseInfiniteQuery)
    rqImports.push(
      'useInfiniteQuery',
      'type UseInfiniteQueryOptions',
      'type InfiniteData',
      'type QueryKey'
    )
  if (needsUseMutation) rqImports.push('useMutation', 'type UseMutationOptions')
  if (needsUseQueryClient) rqImports.push('useQueryClient')

  // Collect all function names for client import
  const allFuncNames = operations.map((op) => op.funcName).sort()

  // Build file content
  const lines: string[] = []
  lines.push('// This file is auto-generated by @codewithagents/openapi-react-query — do not edit')
  lines.push('')
  if (rqImports.length > 0) {
    lines.push(`import { ${rqImports.join(', ')} } from '@tanstack/react-query'`)
  }
  // Error types: bare ApiError (default) plus any per-operation aliases in use.
  const errorTypeImports = [...new Set(operations.map((op) => op.errorType))]
    .filter((t) => t !== 'ApiError')
    .sort()
    .map((t) => `type ${t}`)
  const clientImports = [...allFuncNames, 'type ApiError', ...errorTypeImports]
  lines.push(`import { ${clientImports.join(', ')} } from './client.js'`)
  lines.push('')

  if (keyFactoryBlocks.length > 0) {
    lines.push('// ── Query key factories ──────────────────────────────────────')
    lines.push('')
    lines.push(keyFactoryBlocks.join('\n\n'))
    lines.push('')
  }

  if (queryOptionsBlocks.length > 0) {
    lines.push('// ── Query options factories ──────────────────────────────────')
    lines.push('')
    lines.push(queryOptionsBlocks.join('\n\n'))
    lines.push('')
  }

  if (queryHookBlocks.length > 0) {
    lines.push('// ── Queries ──────────────────────────────────────────────────')
    lines.push('')
    lines.push(queryHookBlocks.join('\n\n'))
    lines.push('')
  }

  if (mutationHookBlocks.length > 0) {
    lines.push('// ── Mutations ────────────────────────────────────────────────')
    lines.push('')
    lines.push(mutationHookBlocks.join('\n\n'))
    lines.push('')
  }

  return {
    filename: 'hooks.ts',
    content: lines.join('\n'),
  }
}
