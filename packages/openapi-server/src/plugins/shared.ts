import type { OpenAPIV3_1 } from 'openapi-types'
import { toTypeName, resolveBodyRefToWritableName } from 'openapi-zod-ts'

type ReferenceObject = OpenAPIV3_1.ReferenceObject
type ParameterObject = OpenAPIV3_1.ParameterObject
type RequestBodyObject = OpenAPIV3_1.RequestBodyObject

export const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
export type SupportedMethod = (typeof SUPPORTED_METHODS)[number]

// ── Ref helpers ───────────────────────────────────────────────────────────────

export function isRef(obj: unknown): obj is ReferenceObject {
  return typeof obj === 'object' && obj !== null && '$ref' in obj
}

export function refToName(ref: string): string {
  const parts = ref.split('/')
  return toTypeName(parts[parts.length - 1]!)
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/**
 * Extract path param names from an OpenAPI path string in template order.
 * Returns raw names as they appear in the path (e.g. 'job-id', not 'jobId').
 * Callers that need valid TypeScript identifiers must sanitize with sanitizeOperationId.
 */
export function extractPathParamsFromPath(path: string): string[] {
  const matches = path.match(/\{([^}]+)\}/g)
  if (matches === null) return []
  // Keep raw param names: they are used in c.req.param() which must match
  // the actual Hono route pattern (e.g. :job-id requires c.req.param('job-id'))
  return matches.map((m) => m.slice(1, -1))
}

// ── Param resolution ──────────────────────────────────────────────────────────

export function resolveParam(
  p: ParameterObject | ReferenceObject,
  spec: OpenAPIV3_1.Document
): ParameterObject | undefined {
  if (!isRef(p)) return p as ParameterObject
  const refStr = (p as ReferenceObject).$ref
  const name = refToName(refStr)
  const components = spec.components as OpenAPIV3_1.ComponentsObject | undefined
  if (components?.parameters === undefined) return undefined
  const resolved = (components.parameters as Record<string, ParameterObject | ReferenceObject>)[
    name
  ]
  if (resolved === undefined || isRef(resolved)) return undefined
  return resolved as ParameterObject
}

// ── Service name ──────────────────────────────────────────────────────────────

export function deriveServiceName(spec: OpenAPIV3_1.Document): string {
  const title = spec.info?.title ?? ''
  const pascal = title
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  if (pascal.length === 0) return 'ApiService'
  // Guard against numeric-start identifiers (e.g. '1Password Connect' -> '_1PasswordConnect')
  const safePascal = /^[0-9]/.test(pascal) ? `_${pascal}` : pascal
  if (safePascal.endsWith('Service')) return safePascal
  return `${safePascal}Service`
}

// ── Operation ID sanitization ─────────────────────────────────────────────────

/**
 * Converts a raw operationId into a valid camelCase JS identifier.
 * Handles kebab-case, snake_case, dots, spaces, parens, braces and other
 * non-alphanumeric separators found in real-world OpenAPI specs.
 * e.g. "post-applePay-sessions"    -> "postApplePaySessions"
 * e.g. "calendar.calendars.insert" -> "calendarCalendarsInsert"
 * e.g. "Get User Profile"          -> "getUserProfile"
 * e.g. "forgotPassword(oneTimeCode)" -> "forgotPasswordOneTimeCode"
 */
export function sanitizeOperationId(id: string): string {
  const parts = id
    .replace(/'/g, '') // strip apostrophes without splitting ("user's" -> "users")
    .split(/[^a-zA-Z0-9]+/) // split on any non-alphanumeric sequence
    .filter(Boolean)
  if (parts.length === 0) return 'unknown'
  const [first = '', ...rest] = parts
  const camel =
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  // If result starts with a digit, prefix with underscore
  return /^[0-9]/.test(camel) ? `_${camel}` : camel
}

// ── Method name derivation ────────────────────────────────────────────────────

export function deriveMethodName(
  operationId: string | undefined,
  method: string,
  path: string
): string {
  if (operationId !== undefined && operationId.length > 0) {
    return sanitizeOperationId(operationId)
  }
  return deriveOperationName(method, path)
}

export function deriveOperationName(method: string, path: string): string {
  const prefixMap: Record<string, string> = {
    get: 'get',
    post: 'create',
    put: 'update',
    patch: 'patch',
    delete: 'delete',
  }
  const prefix = prefixMap[method] ?? method

  const segments = path.replace(/^\/api\/v\d+\//, '').replace(/^\//, '')
  const parts = segments.split('/').map((seg) => {
    // Handle mixed segments like "{maxLat}.{format}": extract each {param} inside
    const paramMatches = seg.match(/\{([^}]+)\}/g)
    if (paramMatches !== null && !(seg.startsWith('{') && seg.endsWith('}'))) {
      return paramMatches
        .map((m) => {
          const name = sanitizeOperationId(m.slice(1, -1))
          return 'By' + name.charAt(0).toUpperCase() + name.slice(1)
        })
        .join('')
    }
    if (seg.startsWith('{') && seg.endsWith('}')) {
      const name = seg.slice(1, -1)
      const sanitized = sanitizeOperationId(name)
      return 'By' + sanitized.charAt(0).toUpperCase() + sanitized.slice(1)
    }
    return toTypeName(seg)
  })

  return prefix + parts.join('')
}

// ── Param name normalization ───────────────────────────────────────────────────

/** Normalize a raw query param name to a valid TypeScript identifier.
 *  Strips trailing [] (array marker), converts separators to camelCase.
 */
export function normalizeParamName(name: string): string {
  // Split on non-alphanumeric sequences to avoid polynomial ReDoS from [^x]+y patterns.
  const stripped = name.replace(/\[\]$/, '').replace(/'/g, '')
  const parts = stripped.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (parts.length === 0) return '_'
  const camel = parts
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('')
  return /^[^a-zA-Z_$]/.test(camel) ? `_${camel}` : camel
}

// ── Schema type helpers ───────────────────────────────────────────────────────

export function schemaToTsType(
  schema: OpenAPIV3_1.SchemaObject | ReferenceObject | undefined
): string {
  if (schema === undefined || isRef(schema)) return 'string'
  const s = schema as OpenAPIV3_1.SchemaObject
  if (s.type === 'number' || s.type === 'integer') return 'number'
  if (s.type === 'boolean') return 'boolean'
  if (s.type === 'array') return 'string[]'
  // Emit a TypeScript literal-union type for string enums so the service interface
  // is more precise than plain `string`. Runtime behaviour is unchanged (Zod already
  // enforces the constraint); this only tightens the TypeScript type.
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ')
  }
  return 'string'
}

// ── Query params ──────────────────────────────────────────────────────────────

export interface QueryParam {
  name: string
  /** Raw parameter name as it appears in the spec (before normalizeParamName). */
  rawName: string
  tsType: string
  required: boolean
  /** Allowed values from the schema enum constraint. */
  enum?: string[]
  /** Inclusive minimum from schema.minimum. */
  minimum?: number
  /** Inclusive maximum from schema.maximum. */
  maximum?: number
  /** Exclusive minimum from schema.exclusiveMinimum (numeric form, OpenAPI 3.1). */
  exclusiveMinimum?: number
  /** Exclusive maximum from schema.exclusiveMaximum (numeric form, OpenAPI 3.1). */
  exclusiveMaximum?: number
  /** Minimum string length from schema.minLength. */
  minLength?: number
  /** Maximum string length from schema.maxLength. */
  maxLength?: number
  /** Regex pattern from schema.pattern. */
  pattern?: string
  /**
   * Delimiter style for array query params with explode:false.
   * 'csv' = comma (style:form + explode:false), 'ssv' = space, 'psv' = pipe.
   * When set, the raw query string value must be split on the delimiter before Zod validation.
   */
  delimiterStyle?: 'csv' | 'ssv' | 'psv'
  /**
   * When true, this param uses style:deepObject (e.g. filter[gte]=10&filter[lte]=20).
   * The router must collect all name[key]=value query entries and assemble them into a
   * nested object before Zod validation.
   */
  isDeepObject?: boolean
  /**
   * For deepObject params: property names and their types from the schema object.
   * Used to emit typed coercion (e.g. z.coerce.number()) per property.
   */
  deepObjectProperties?: Array<{ key: string; tsType: string }>
  /**
   * When true, this param is a plain repeated-key array (type:array, explode:true which is
   * the default for arrays). The router must emit z.array(<itemExpr>) for the querystring
   * schema to match the service T[] type. This is distinct from delimiterStyle (explode:false)
   * and deepObject, which have their own handling.
   */
  isArray?: boolean
  /**
   * TypeScript type of the array items, derived from schema.items. Used to emit typed Zod
   * coercion (e.g. z.coerce.number() for integer/number items) inside z.array().
   */
  itemsTsType?: string
}

/** Apply deepObject classification to a query param, mutating it in place. */
function applyDeepObjectStyle(
  param: QueryParam,
  schema: OpenAPIV3_1.SchemaObject | undefined,
  resolvedStyle: string | undefined
): void {
  if (resolvedStyle !== 'deepObject' || schema === undefined || isRef(schema)) return
  const s = schema as OpenAPIV3_1.SchemaObject
  if (s.type !== 'object' || s.properties === undefined) return
  param.isDeepObject = true
  param.deepObjectProperties = Object.entries(s.properties).map(([key, propSchema]) => ({
    key,
    tsType: schemaToTsType(propSchema as OpenAPIV3_1.SchemaObject | undefined),
  }))
  const propFields = param.deepObjectProperties.map((p) => `${p.key}?: ${p.tsType}`).join('; ')
  param.tsType = `{ ${propFields} }`
}

/**
 * Map an array item's tsType to the service-facing element type, mirroring the Fastify
 * router's z.array(<itemExpr>) item coercion in queryParamItemExpr (number -> number,
 * boolean -> boolean, everything else validates as z.string() -> string). Keeps the
 * service query type in lockstep with req.query so the router can forward it without TS2322.
 */
function queryArrayItemTsType(itemsTsType: string | undefined): string {
  if (itemsTsType === 'number') return 'number'
  if (itemsTsType === 'boolean') return 'boolean'
  return 'string'
}

/** Apply delimiter or plain-array classification to a query param, mutating it in place. */
function applyArrayStyle(
  param: QueryParam,
  schema: OpenAPIV3_1.SchemaObject | undefined,
  resolvedStyle: string | undefined,
  resolvedExplode: boolean | undefined
): void {
  if (param.isDeepObject || schema === undefined || isRef(schema)) return
  if ((schema as OpenAPIV3_1.SchemaObject).type !== 'array') return

  if (resolvedExplode === false) {
    // explode:false — value arrives as a single delimited string; split before validation.
    if (resolvedStyle === 'spaceDelimited') {
      param.delimiterStyle = 'ssv'
    } else if (resolvedStyle === 'pipeDelimited') {
      param.delimiterStyle = 'psv'
    } else {
      // style:form with explode:false = CSV (default for arrays when explode:false).
      param.delimiterStyle = 'csv'
    }
    // Delimited arrays arrive as a single string and are split + validated as z.array(z.string())
    // regardless of item type. The service type must match.
    param.tsType = 'string[]'
    return
  }

  // explode:true (default) — repeated keys (e.g. ?ids=1&ids=2). Needs z.array() in schema.
  param.isArray = true
  const arraySchema = schema as OpenAPIV3_1.ArraySchemaObject
  const items = arraySchema.items
  param.itemsTsType = !isRef(items) ? schemaToTsType(items as OpenAPIV3_1.SchemaObject) : 'string'
  // Align the service query type with the router's z.array(<itemExpr>) inference (#375, #377, #378):
  // number/integer items -> number[], boolean -> boolean[], everything else -> string[]. This
  // element type round-trips cleanly on all three router targets (Fastify, Hono, Express).
  param.tsType = `${queryArrayItemTsType(param.itemsTsType)}[]`
}

/**
 * Copy scalar constraints (enum, numeric, string) from schema onto the param.
 *
 * CRAP note: cyclomatic 11 is intentional — each branch is a one-liner guard for a distinct
 * OpenAPI constraint keyword. All branches are exercised by existing query-param router tests.
 * Elevating to a helper reduced getQueryParams complexity; the CRAP score is a static-only
 * artefact because CI runs fallow audit without coverage data.
 */
// fallow-ignore-next-line complexity
function applyScalarConstraints(
  param: QueryParam,
  schema: OpenAPIV3_1.SchemaObject | undefined
): void {
  if (schema === undefined || isRef(schema)) return
  const s = schema as OpenAPIV3_1.SchemaObject & {
    exclusiveMinimum?: number | boolean
    exclusiveMaximum?: number | boolean
  }
  if (Array.isArray(s.enum)) param.enum = s.enum as string[]
  if (typeof s.minimum === 'number') param.minimum = s.minimum
  if (typeof s.maximum === 'number') param.maximum = s.maximum
  // OpenAPI 3.1 uses numeric exclusiveMinimum/exclusiveMaximum; 3.0 uses boolean.
  if (typeof s.exclusiveMinimum === 'number') param.exclusiveMinimum = s.exclusiveMinimum
  if (typeof s.exclusiveMaximum === 'number') param.exclusiveMaximum = s.exclusiveMaximum
  if (typeof s.minLength === 'number') param.minLength = s.minLength
  if (typeof s.maxLength === 'number') param.maxLength = s.maxLength
  if (typeof s.pattern === 'string') param.pattern = s.pattern
}

export function getQueryParams(
  operation: OpenAPIV3_1.OperationObject,
  spec: OpenAPIV3_1.Document
): QueryParam[] {
  const parameters = operation.parameters as (ParameterObject | ReferenceObject)[] | undefined
  if (parameters === undefined) return []

  const result: QueryParam[] = []
  for (const p of parameters) {
    const resolved = resolveParam(p, spec)
    if (resolved === undefined || resolved.in !== 'query') continue

    const schema = resolved.schema as OpenAPIV3_1.SchemaObject | undefined
    const resolvedStyle = (resolved as { style?: string }).style as string | undefined
    const resolvedExplode = (resolved as { explode?: boolean }).explode as boolean | undefined
    const param: QueryParam = {
      name: normalizeParamName(resolved.name),
      rawName: resolved.name,
      tsType: schemaToTsType(schema),
      required: resolved.required === true,
    }

    applyDeepObjectStyle(param, schema, resolvedStyle)
    applyArrayStyle(param, schema, resolvedStyle, resolvedExplode)
    applyScalarConstraints(param, schema)

    result.push(param)
  }
  return result
}

// ── Path-item validation ──────────────────────────────────────────────────────

/**
 * True when a path-item is a usable Path Item Object: a non-null, non-array object. Arrays,
 * primitives, and null are malformed and cause every operation collector to skip the whole path
 * (pathItem[method] is undefined, or throws for null). objectPathItemEntries filters on this, and
 * warnOnNonObjectPathItems surfaces the drop (#375, #378). A $ref path item is an object and passes
 * here (it is simply unsupported by the collectors, out of scope), as is an operation-less {}.
 */
function isPathItemObject(pathItem: unknown): boolean {
  return pathItem !== null && typeof pathItem === 'object' && !Array.isArray(pathItem)
}

/**
 * Entries of spec.paths whose path-item is a usable Path Item Object, in declaration order.
 * Malformed entries (array/null/primitive) are filtered out here so every operation collector
 * iterates only valid path items without repeating a guard, and pathItem[method] never throws.
 * warnOnNonObjectPathItems separately surfaces the dropped entries as a diagnostic (#375, #378).
 */
export function objectPathItemEntries(
  spec: OpenAPIV3_1.Document
): Array<[string, Record<string, unknown>]> {
  const paths = spec.paths as Record<string, unknown> | undefined
  if (paths === undefined) return []
  return Object.entries(paths).filter((entry): entry is [string, Record<string, unknown>] =>
    isPathItemObject(entry[1])
  )
}

/**
 * Warn for each path-item that is not a valid Path Item Object (e.g. a JSON array, primitive,
 * or null). Such entries are silently skipped by every operation collector because
 * pathItem[method] is undefined, dropping ALL of that path's operations with no diagnostic.
 * Emitting a named warning surfaces the drop instead of losing it silently (#375, #378). A valid
 * but operation-less path item ({} or { parameters, description }) is a legitimate object and
 * does not warn; a $ref path item is also an object and is left alone (out of scope).
 */
export function warnOnNonObjectPathItems(spec: OpenAPIV3_1.Document): void {
  const paths = spec.paths as Record<string, unknown> | undefined
  if (paths === undefined) return
  for (const [path, pathItem] of Object.entries(paths)) {
    if (isPathItemObject(pathItem)) continue
    const kind = pathItem === null ? 'null' : Array.isArray(pathItem) ? 'array' : typeof pathItem
    console.warn(
      `Path "${path}" is not a valid Path Item Object (got ${kind}); all of its operations ` +
        'were skipped. Check the spec for a malformed path entry.'
    )
  }
}

// ── Body info ─────────────────────────────────────────────────────────────────

export interface BodyInfo {
  typeName: string | undefined
  /**
   * When the body $ref points to a schema that has a writable variant (readOnly/writeOnly
   * properties, directly or transitively via nested $refs), this field holds the XWritable
   * type name to use for the TypeScript type annotation and casts.
   * The Zod validation schema name always uses the base typeName (${typeName}Schema) so
   * runtime validation is unchanged.
   * Undefined when there is no writable variant or typeName is synthesized/undefined.
   */
  writableTypeName: string | undefined
  /** The request body content type that was matched. Drives parser choice in the router. */
  contentType:
    | 'application/json'
    | 'application/x-www-form-urlencoded'
    | 'multipart/form-data'
    | 'application/octet-stream'
  /**
   * True when typeName was synthesized from the operationId (inline schema, no $ref).
   * Synthesized names exist only for schema lookup (XxxSchema.safeParse) and are NOT
   * emitted as a TypeScript model type import — they have no entry in models.ts.
   */
  isSynthesized: boolean
}

// fallow-ignore-next-line complexity
export function getBodyInfo(
  operation: OpenAPIV3_1.OperationObject,
  writableVariantMap?: Map<string, string>
): BodyInfo | undefined {
  const requestBody = operation.requestBody as RequestBodyObject | ReferenceObject | undefined
  if (requestBody === undefined) return undefined
  if (isRef(requestBody)) {
    return {
      typeName: undefined,
      writableTypeName: undefined,
      contentType: 'application/json',
      isSynthesized: false,
    }
  }

  const rb = requestBody as RequestBodyObject
  const content = rb.content as
    Record<string, { schema?: OpenAPIV3_1.SchemaObject | ReferenceObject }> | undefined
  if (content === undefined) {
    return {
      typeName: undefined,
      writableTypeName: undefined,
      contentType: 'application/json',
      isSynthesized: false,
    }
  }

  // Check application/json first.
  const jsonContent = content['application/json']
  if (jsonContent !== undefined && jsonContent.schema !== undefined) {
    const schema = jsonContent.schema
    if (isRef(schema)) {
      const ref = (schema as ReferenceObject).$ref
      const baseName = refToName(ref)
      const writableName =
        writableVariantMap !== undefined
          ? resolveBodyRefToWritableName(ref, writableVariantMap)
          : undefined
      return {
        typeName: baseName,
        writableTypeName: writableName,
        contentType: 'application/json',
        isSynthesized: false,
      }
    }
    // Inline JSON schema: synthesize a stable name from the operationId so the router
    // can wire safeParse against a user-defined schema in schemas.ts.
    const operationId = operation.operationId
    if (operationId !== undefined && operationId.length > 0) {
      return {
        typeName: toTypeName(operationId),
        writableTypeName: undefined,
        contentType: 'application/json',
        isSynthesized: true,
      }
    }
    return {
      typeName: undefined,
      writableTypeName: undefined,
      contentType: 'application/json',
      isSynthesized: false,
    }
  }

  // Check application/x-www-form-urlencoded.
  const formContent = content['application/x-www-form-urlencoded']
  if (formContent !== undefined) {
    const schema = formContent.schema
    if (schema !== undefined && isRef(schema)) {
      const ref = (schema as ReferenceObject).$ref
      const baseName = refToName(ref)
      const writableName =
        writableVariantMap !== undefined
          ? resolveBodyRefToWritableName(ref, writableVariantMap)
          : undefined
      return {
        typeName: baseName,
        writableTypeName: writableName,
        contentType: 'application/x-www-form-urlencoded',
        isSynthesized: false,
      }
    }
    // Inline form schema: synthesize a stable name from the operationId.
    const operationId = operation.operationId
    if (operationId !== undefined && operationId.length > 0) {
      return {
        typeName: toTypeName(operationId),
        writableTypeName: undefined,
        contentType: 'application/x-www-form-urlencoded',
        isSynthesized: true,
      }
    }
    return {
      typeName: undefined,
      writableTypeName: undefined,
      contentType: 'application/x-www-form-urlencoded',
      isSynthesized: false,
    }
  }

  // Check multipart/form-data.
  const multipartContent = content['multipart/form-data']
  if (multipartContent !== undefined) {
    const schema = multipartContent.schema
    if (schema !== undefined && isRef(schema)) {
      return {
        typeName: refToName((schema as ReferenceObject).$ref),
        writableTypeName: undefined,
        contentType: 'multipart/form-data',
        isSynthesized: false,
      }
    }
    // Inline multipart schema: synthesize a stable name from the operationId.
    const operationId = operation.operationId
    if (operationId !== undefined && operationId.length > 0) {
      return {
        typeName: toTypeName(operationId),
        writableTypeName: undefined,
        contentType: 'multipart/form-data',
        isSynthesized: true,
      }
    }
    return {
      typeName: undefined,
      writableTypeName: undefined,
      contentType: 'multipart/form-data',
      isSynthesized: false,
    }
  }

  // Check application/octet-stream request body.
  const octetContent = content['application/octet-stream']
  if (octetContent !== undefined) {
    return {
      typeName: undefined,
      writableTypeName: undefined,
      contentType: 'application/octet-stream',
      isSynthesized: false,
    }
  }

  return {
    typeName: undefined,
    writableTypeName: undefined,
    contentType: 'application/json',
    isSynthesized: false,
  }
}
