/**
 * Fastify type-provider-zod emitter for openapi-server.
 *
 * Replaces the hand-rolled Fastify branch in router.ts with a dedicated module
 * that uses fastify-type-provider-zod for request validation and type inference.
 *
 * Key design points (decided, not re-litigated):
 * - createRouter(service) returns a FastifyPluginAsyncZod; mount via app.register(createRouter(service), { prefix })
 * - FastifyPluginAsyncZod carries ZodTypeProvider: no withTypeProvider() call needed inside the plugin
 * - setValidatorCompiler, setSerializerCompiler, setErrorHandler are scoped to the plugin instance
 * - Per route: schema.body, schema.params, schema.querystring, schema.headers, schema.response, config.operationId
 * - preValidation hook for deepObject and delimiter-style query params (emitted per-route, not globally)
 * - Cookie params use manual _ckv safeParse: Fastify 5's FastifySchema only exposes body/querystring/params/headers/response, so there is no cookie slot in the type-provider path
 * - No per-route generic type arguments; req.body/req.query/req.params infer from schemas
 * - No (reply as FastifyReply) casts
 */
import type { OpenAPIV3_1 } from 'openapi-types'
import type { GeneratedFile } from 'openapi-zod-ts'
import { toTypeName } from 'openapi-zod-ts'
import {
  SUPPORTED_METHODS,
  type SupportedMethod,
  isRef,
  refToName,
  extractPathParamsFromPath,
  resolveParam,
  deriveServiceName,
  deriveMethodName,
  type QueryParam,
  getQueryParams,
  type BodyInfo,
  getBodyInfo,
  objectPathItemEntries,
} from './shared.js'
import { deriveEffectiveSecurity } from './security-meta.js'
import {
  type HeaderParam,
  type CookieParam,
  type ResponseStatus,
  getHeaderParams,
  getCookieParams,
  getResponseStatus,
  collectSortedBodyTypes,
  collectUsedSchemaNames,
  collectUsedResponseSchemaNames,
} from './operation-ir.js'
import { formatSchemaImportSpecifiers } from './schema-prefix.js'
import {
  type ErrorFormat,
  isProblemJson,
  fastifyErrorReturn,
  fastifyProblemErrorHandlerLines,
  fastifyProblemHelperLines,
} from './problem-details.js'

type OperationObject = OpenAPIV3_1.OperationObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type ParameterObject = OpenAPIV3_1.ParameterObject
type ResponseObject = OpenAPIV3_1.ResponseObject

// ── Local types (not shared with router.ts to avoid circular deps) ─────────────

interface RouteOperation {
  methodName: string
  httpMethod: SupportedMethod
  path: string
  honoPath: string
  pathParams: string[]
  queryParams: QueryParam[]
  headerParams: HeaderParam[]
  cookieParams: CookieParam[]
  bodyInfo: BodyInfo | undefined
  responseStatus: ResponseStatus
  responseTypeName?: string
  responseIsArray?: boolean
  /** Raw OpenAPI operation object for schema.params resolution. */
  rawOperation: OperationObject
  /**
   * Effective security requirements for this operation, derived from
   * operation.security if present, otherwise from the global spec.security.
   * Each entry is a { scheme, scopes } pair. Empty array means no security.
   */
  effectiveSecurity: Array<{ scheme: string; scopes: string[] }>
}

interface RouterOptions {
  schemaNames?: Set<string>
  schemaImportPath?: string
  /** Bare schema name -> actual exported name, for spec_prefix (#334). See schema-prefix.ts. */
  schemaImportAliases?: Map<string, string>
  /** Error body format; 'problem+json' emits RFC 9457 / RFC 7807 bodies. See problem-details.ts. */
  errorFormat?: ErrorFormat
  /**
   * When true, emit the zero-cast router: body is passed as req.body (no cast),
   * response is sent without a cast, and model imports are skipped. The router
   * imports alias types from schema-types.js (emitted separately by generateFastifyTypes).
   * Enabled by the generator when framework=fastify and input_schema is configured.
   */
  zeroCast?: boolean
  contextType?: string
  /**
   * When true, synthesize inline Zod response schema expressions for schema.response
   * when the response schema is flat (no $ref, allOf, oneOf, anyOf, nested objects).
   * Falls back to z.unknown() for complex shapes. Default: false.
   * For best coverage, use input_schema to wire your own Zod schemas instead.
   */
  emitResponseValidation?: boolean
  /**
   * Relative import path (from the generated router.ts) to the shared `_shared/errors.js`
   * module. Defaults to `./_shared/errors.js` when not provided.
   * The generator always passes the correct path based on the shared dir derivation logic.
   */
  errorsImportPath?: string
}

// ── Shared path conversion ────────────────────────────────────────────────────

function toFastifyPath(openapiPath: string): string {
  return openapiPath.replace(/\{([^}]+)\}/g, ':$1')
}

// getResponseTypeName is a branchy codegen dispatcher (response-status priority + $ref/inline
// fallback chain), parallel to router.ts; coupling the emitters would violate generation separation.
// fallow-ignore-next-line complexity
function getResponseTypeName(
  operation: OperationObject,
  schemaNames?: Set<string>
): { typeName: string; isArray: boolean } | undefined {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined
  if (responses === undefined) return undefined

  // Priority list mirrors the one in router.ts; both emitters scan the same response
  // priority ordering but for different purposes (type names vs. schema expressions).
  // fallow-ignore-next-line code-duplication
  const priority = [
    '200',
    '201',
    ...Object.keys(responses).filter(
      (k) => /^2\d\d$/.test(k) && k !== '200' && k !== '201' && k !== '204'
    ),
  ]

  for (const code of priority) {
    const response = responses[code]
    if (response === undefined || isRef(response)) continue
    const resp = response as ResponseObject
    const content = resp.content as
      Record<string, { schema?: OpenAPIV3_1.SchemaObject | ReferenceObject }> | undefined
    if (content === undefined) continue
    const jsonContent = content['application/json']
    if (jsonContent === undefined || jsonContent.schema === undefined) continue
    const schema = jsonContent.schema
    if (isRef(schema)) {
      const typeName = refToName((schema as ReferenceObject).$ref)
      // Warn when schemaNames is provided but the named $ref schema is absent.
      // This typically means the schemas.ts is out of sync with the spec.
      if (schemaNames !== undefined && !schemaNames.has(`${typeName}Schema`)) {
        console.warn(
          `${operation.operationId ?? 'unknown'} (${code}): response schema ${typeName}Schema is referenced in the spec but not found in schemas.ts. The service return type will be unknown.`
        )
      }
      return { typeName, isArray: false }
    }
    const s = schema as OpenAPIV3_1.SchemaObject
    if (s.type === 'array' && s.items !== undefined && isRef(s.items)) {
      const typeName = refToName((s.items as ReferenceObject).$ref)
      if (schemaNames !== undefined && !schemaNames.has(`${typeName}Schema`)) {
        console.warn(
          `${operation.operationId ?? 'unknown'} (${code}): response schema ${typeName}Schema is referenced in the spec but not found in schemas.ts. The service return type will be unknown.`
        )
      }
      return { typeName, isArray: true }
    }
  }

  // Synthesized response schema fallback: when the response is inline (no $ref), try
  // several naming conventions in priority order before giving up. This enables schema.response
  // wiring and typed service return types for operations with inline response schemas.
  //
  // Fallback order (first match wins):
  //   1. toTypeName(operationId) + 'Schema'         e.g. LabInlineResponseSchema
  //   2. toTypeName(operationId) + 'ResponseSchema'  e.g. LabInlineBodyResponseSchema
  //   3. toTypeName(operationId) + statusCode + 'Schema' e.g. LabInlineBody200Schema
  //
  // Guard: skip any candidate whose name collides with the operation's body schema name.
  // This prevents a form-body schema (e.g. LabFormBodySchema) from being misidentified
  // as a response schema for the same operation.
  if (
    schemaNames !== undefined &&
    operation.operationId !== undefined &&
    operation.operationId.length > 0
  ) {
    const synthesizedName = toTypeName(operation.operationId)
    const bodyInfo = getBodyInfo(operation)
    const bodySchemaName =
      bodyInfo?.typeName !== undefined ? `${bodyInfo.typeName}Schema` : undefined

    // Candidate 1: operationId + Schema
    const candidate1 = `${synthesizedName}Schema`
    if (schemaNames.has(candidate1) && candidate1 !== bodySchemaName) {
      return { typeName: synthesizedName, isArray: false }
    }

    // Candidate 2: operationId + ResponseSchema
    const candidate2 = `${synthesizedName}ResponseSchema`
    if (schemaNames.has(candidate2) && candidate2 !== bodySchemaName) {
      return { typeName: `${synthesizedName}Response`, isArray: false }
    }

    // Candidate 3: operationId + {3-digit statusCode} + Schema (try each 2xx code)
    for (const code of priority) {
      if (responses[code] === undefined) continue
      const candidate3 = `${synthesizedName}${code}Schema`
      if (schemaNames.has(candidate3) && candidate3 !== bodySchemaName) {
        return { typeName: `${synthesizedName}${code}`, isArray: false }
      }
    }
  }

  return undefined
}

// ── Operation collection ──────────────────────────────────────────────────────

function collectOperations(
  spec: OpenAPIV3_1.Document,
  schemaNames?: Set<string>
): RouteOperation[] {
  // fallow-ignore-next-line code-duplication
  const operations: RouteOperation[] = []

  for (const [path, pathItem] of objectPathItemEntries(spec)) {
    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method] as OperationObject | undefined
      if (operation === undefined) continue

      const methodName = deriveMethodName(operation.operationId, method, path)
      const pathParams = extractPathParamsFromPath(path)
      const queryParams = getQueryParams(operation, spec)
      const headerParams = getHeaderParams(operation, spec)
      const cookieParams = getCookieParams(operation, spec)
      const bodyInfo = getBodyInfo(operation)
      const responseStatus = getResponseStatus(operation, method)
      // Pass schemaNames so synthesized response schema names are recognised.
      const responseTypeInfo = getResponseTypeName(operation, schemaNames)
      const effectiveSecurity = deriveEffectiveSecurity(operation, spec)

      operations.push({
        methodName,
        httpMethod: method,
        path,
        honoPath: toFastifyPath(path),
        pathParams,
        queryParams,
        headerParams,
        cookieParams,
        bodyInfo,
        responseStatus,
        responseTypeName: responseTypeInfo?.typeName,
        responseIsArray: responseTypeInfo?.isArray,
        rawOperation: operation,
        effectiveSecurity,
      })
    }
  }

  return operations
}

// ── Zod expression builders ───────────────────────────────────────────────────

function delimiterChar(style: 'csv' | 'ssv' | 'psv'): string {
  if (style === 'ssv') return ' '
  if (style === 'psv') return '|'
  return ','
}

/** Append .min/.max/.regex string constraints in a stable order. */
function stringConstraintSuffix(p: {
  minLength?: number
  maxLength?: number
  pattern?: string
}): string {
  let s = ''
  if (p.minLength !== undefined) s += `.min(${p.minLength})`
  if (p.maxLength !== undefined) s += `.max(${p.maxLength})`
  if (p.pattern !== undefined) s += `.regex(/${p.pattern}/)`
  return s
}

/** Append .min/.max/.gt/.lt numeric constraints in a stable order. */
function numberConstraintSuffix(p: {
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
}): string {
  let s = ''
  if (p.minimum !== undefined) s += `.min(${p.minimum})`
  if (p.maximum !== undefined) s += `.max(${p.maximum})`
  if (p.exclusiveMinimum !== undefined) s += `.gt(${p.exclusiveMinimum})`
  if (p.exclusiveMaximum !== undefined) s += `.lt(${p.exclusiveMaximum})`
  return s
}

/** z.enum([...]) when an enum is present, else z.string(), plus string constraints. */
function enumOrStringExpr(p: {
  enum?: string[]
  minLength?: number
  maxLength?: number
  pattern?: string
}): string {
  const base =
    p.enum !== undefined && p.enum.length > 0
      ? `z.enum([${p.enum.map((v) => JSON.stringify(v)).join(', ')}])`
      : 'z.string()'
  return base + stringConstraintSuffix(p)
}

/** Wrap a Zod expression in .optional() unless the param is required. */
function withOptional(base: string, required: boolean): string {
  return required ? base : `${base}.optional()`
}

// ── Inline response schema synthesizer (emit_response_validation) ─────────────

/**
 * Synthesize a Zod expression string for an inline response schema property type.
 * Handles only primitive types and simple string enums. Everything else is z.unknown().
 * This is intentionally conservative: complex shapes (nested objects, $ref, allOf,
 * oneOf, anyOf) are out of scope; use input_schema for those.
 *
 * CRAP note: cyclomatic 13 / cognitive 13 is intentional — this is a type-dispatch
 * switch over every OpenAPI scalar kind plus array/ref/unknown fallbacks. Each branch
 * is a one-liner. All branches are covered by the synthesizer unit tests in
 * router.test.ts; the elevated CRAP score is a static-only artefact because CI runs
 * fallow audit without coverage data.
 */
// fallow-ignore-next-line complexity
function synthesizePropExpr(
  schema: OpenAPIV3_1.SchemaObject | ReferenceObject | undefined
): string {
  if (schema === undefined || isRef(schema)) return 'z.unknown()'
  const s = schema as OpenAPIV3_1.SchemaObject
  if (s.type === 'string') {
    if (Array.isArray(s.enum) && s.enum.length > 0) {
      return `z.enum([${(s.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')}])`
    }
    return `z.string()${stringConstraintSuffix(s as { minLength?: number; maxLength?: number; pattern?: string })}`
  }
  if (s.type === 'number' || s.type === 'integer')
    return `z.number()${numberConstraintSuffix(s as { minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number })}`
  if (s.type === 'boolean') return 'z.boolean()'
  // Array with simple items.
  if (s.type === 'array' && s.items !== undefined && !isRef(s.items)) {
    const itemExpr = synthesizePropExpr(s.items as OpenAPIV3_1.SchemaObject)
    if (!itemExpr.startsWith('z.unknown')) return `z.array(${itemExpr})`
  }
  return 'z.unknown()'
}

/**
 * Synthesize a Zod schema expression for an inline (non-$ref) response schema.
 * Only handles flat z.object({...}) shapes with primitive properties. Returns
 * z.unknown() for: $ref, allOf, oneOf, anyOf, nested objects, or missing types.
 * Always returns a string — callers can use the result directly in schema.response.
 *
 * CRAP note: cyclomatic 12 / cognitive 13 is intentional — this dispatches over
 * composition keywords, array variants, object shapes, and scalar primitives; each
 * arm is a necessary distinct case. All branches are covered by the synthesizer unit
 * tests in router.test.ts; the elevated CRAP score is a static-only artefact because
 * CI runs fallow audit without coverage data.
 */
// fallow-ignore-next-line complexity
function synthesizeResponseSchemaExpr(
  schema: OpenAPIV3_1.SchemaObject | ReferenceObject | undefined
): string {
  if (schema === undefined || isRef(schema)) return 'z.unknown()'
  const s = schema as OpenAPIV3_1.SchemaObject & {
    allOf?: unknown
    oneOf?: unknown
    anyOf?: unknown
  }
  // Bail out for composition keywords: these require the user to supply their own Zod schema.
  if (s.allOf !== undefined || s.oneOf !== undefined || s.anyOf !== undefined) return 'z.unknown()'
  // Array type with inline items.
  if (s.type === 'array') {
    if (s.items === undefined) return 'z.array(z.unknown())'
    if (isRef(s.items)) return 'z.unknown()'
    const itemExpr = synthesizePropExpr(s.items as OpenAPIV3_1.SchemaObject)
    return `z.array(${itemExpr})`
  }
  // Object type with properties.
  if (s.type === 'object' && s.properties !== undefined) {
    const required = Array.isArray(s.required) ? new Set(s.required as string[]) : new Set<string>()
    const fields = Object.entries(
      s.properties as Record<string, OpenAPIV3_1.SchemaObject | ReferenceObject>
    )
      .map(([key, propSchema]) => {
        // Nested objects fall back to z.unknown().
        if (!isRef(propSchema) && (propSchema as OpenAPIV3_1.SchemaObject).type === 'object') {
          const safeKey = /[^a-zA-Z0-9_$]/.test(key) ? JSON.stringify(key) : key
          return `${safeKey}: ${required.has(key) ? 'z.unknown()' : 'z.unknown().optional()'}`
        }
        const expr = synthesizePropExpr(propSchema)
        const safeKey = /[^a-zA-Z0-9_$]/.test(key) ? JSON.stringify(key) : key
        return `${safeKey}: ${required.has(key) ? expr : `${expr}.optional()`}`
      })
      .join(', ')
    return `z.object({ ${fields} })`
  }
  // Primitive type at the top level.
  return synthesizePropExpr(s)
}

const SCALAR_QUERY_BOOL_EXPR = "z.enum(['true', 'false']).transform((v) => v === 'true')"

function queryParamItemExpr(itemsTsType: string | undefined): string {
  if (itemsTsType === 'number') return 'z.coerce.number()'
  if (itemsTsType === 'boolean') return 'z.boolean()'
  return 'z.string()'
}

function queryParamBaseExpr(param: QueryParam): string {
  if (param.delimiterStyle !== undefined) return 'z.array(z.string())'
  if (param.isDeepObject === true && param.deepObjectProperties !== undefined) {
    const propFields = param.deepObjectProperties.map((p) => {
      const coerced = p.tsType === 'number' ? 'z.coerce.number()' : 'z.string()'
      const key = /[^a-zA-Z0-9_$]/.test(p.key) ? JSON.stringify(p.key) : p.key
      return `${key}: ${coerced}.optional()`
    })
    return `z.object({ ${propFields.join(', ')} })`
  }
  // Plain repeated-key array (type:array, explode:true). Emit z.array(<itemExpr>) so the
  // querystring schema matches the service T[] signature. Item coercion mirrors the scalar path.
  if (param.isArray === true) return `z.array(${queryParamItemExpr(param.itemsTsType)})`
  if (param.tsType === 'number') return `z.coerce.number()${numberConstraintSuffix(param)}`
  // Fastify's querystring parser never converts types, so a scalar boolean arrives as the
  // string 'true'/'false'. Accept exactly those two and transform to a boolean; anything
  // else is rejected with 400 by the validatorCompiler.
  if (param.tsType === 'boolean') return SCALAR_QUERY_BOOL_EXPR
  return enumOrStringExpr(param)
}

function queryParamZodExpr(param: QueryParam): string {
  return withOptional(queryParamBaseExpr(param), param.required)
}

function headerParamZodExpr(param: HeaderParam): string {
  return withOptional(enumOrStringExpr(param), param.required)
}

function cookieParamZodExpr(param: CookieParam): string {
  return withOptional(enumOrStringExpr(param), param.required)
}

// ── Path param schema builder ─────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function pathParamSchemaExpr(resolved: ParameterObject): string {
  const schema = resolved.schema as OpenAPIV3_1.SchemaObject | undefined
  if (schema === undefined || isRef(schema)) return 'z.string()'
  const s = schema as OpenAPIV3_1.SchemaObject & {
    exclusiveMinimum?: number
    exclusiveMaximum?: number
  }
  if (s.type === 'integer' || s.type === 'number') {
    // Path params are always HTTP string segments. Keeping the type as string avoids
    // mismatches with the generated service interface (which always types path params as string).
    return 'z.string()'
  }
  if (s.type !== 'string') return 'z.string()'
  const format = s.format as string | undefined
  if (format === 'uuid') return 'z.uuid()'
  if (format === 'email') return 'z.email()'
  if (format === 'uri' || format === 'url') return 'z.url()'
  if (format === 'date-time') return 'z.iso.datetime()'
  return 'z.string()'
}

function buildParamsSchemaExpr(op: RouteOperation, spec: OpenAPIV3_1.Document): string | undefined {
  if (op.pathParams.length === 0) return undefined

  const paramByName = new Map<string, ParameterObject>()
  const parameters = op.rawOperation.parameters as (ParameterObject | ReferenceObject)[] | undefined
  if (parameters !== undefined) {
    for (const p of parameters) {
      const resolved = resolveParam(p, spec)
      if (resolved !== undefined && resolved.in === 'path') {
        paramByName.set(resolved.name, resolved)
      }
    }
  }

  const fields = op.pathParams
    .map((rawName) => {
      const resolved = paramByName.get(rawName)
      const zodExpr = resolved !== undefined ? pathParamSchemaExpr(resolved) : 'z.string()'
      const key = /[^a-zA-Z0-9_$]/.test(rawName) ? JSON.stringify(rawName) : rawName
      return `${key}: ${zodExpr}`
    })
    .join(', ')
  return `z.object({ ${fields} })`
}

// ── preValidation hook builder ────────────────────────────────────────────────

/**
 * Build preValidation hook lines for routes with deepObject or delimiter-style query params.
 * The hook mutates (req as any).query before the validatorCompiler runs, reshaping flat
 * bracket-notation keys into nested objects and splitting delimited strings into arrays.
 * Returns undefined when no complex query params are present.
 */
function buildPreValidationLines(queryParams: QueryParam[]): string[] | undefined {
  const hasComplex = queryParams.some(
    (q) => q.isDeepObject === true || q.delimiterStyle !== undefined
  )
  if (!hasComplex) return undefined

  const lines: string[] = []
  lines.push(`      const _dq = req.query as unknown as Record<string, string | undefined>`)

  const reshapedFields: string[] = []
  for (const q of queryParams) {
    const key = /[^a-zA-Z0-9_$]/.test(q.name) ? JSON.stringify(q.name) : q.name
    if (q.isDeepObject === true) {
      const prefixLen = q.rawName.length + 1
      const bracketPrefix = q.rawName + '['
      reshapedFields.push(
        `        ${key}: Object.fromEntries(Object.entries(_dq).filter(([k]) => k.startsWith(${JSON.stringify(bracketPrefix)}) && k.endsWith(']')).map(([k, v]) => [k.slice(${prefixLen}, -1), v]))`
      )
    } else if (q.delimiterStyle !== undefined) {
      const delim = JSON.stringify(delimiterChar(q.delimiterStyle))
      reshapedFields.push(
        `        ${key}: typeof _dq[${JSON.stringify(q.rawName)}] === 'string' ? _dq[${JSON.stringify(q.rawName)}]!.split(${delim}) : undefined`
      )
    } else {
      reshapedFields.push(`        ${key}: _dq[${JSON.stringify(q.rawName)}]`)
    }
  }

  lines.push(`      ;(req as any).query = {`)
  lines.push(reshapedFields.join(',\n'))
  lines.push(`      }`)
  return lines
}

// ── Route options builder ─────────────────────────────────────────────────────

function buildRouteOptions(
  schemaParts: string[],
  preValidationLines: string[] | undefined,
  methodName: string,
  effectiveSecurity: Array<{ scheme: string; scopes: string[] }>
): string {
  const parts: string[] = []
  if (schemaParts.length > 0) {
    parts.push(`schema: { ${schemaParts.join(', ')} }`)
  }
  if (preValidationLines !== undefined) {
    parts.push(`preValidation: async (req) => {\n${preValidationLines.join('\n')}\n    }`)
  }
  // config.security surfaces the effective security metadata at runtime via
  // req.routeOptions.config.security so hooks and createContext can inspect it.
  if (effectiveSecurity.length > 0) {
    const securityJson = JSON.stringify(effectiveSecurity)
    parts.push(`config: { operationId: '${methodName}', security: ${securityJson} }`)
  } else {
    parts.push(`config: { operationId: '${methodName}' }`)
  }
  return `{ ${parts.join(', ')} }`
}

// ── Route handler builder ─────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function buildFastifyTypeProviderHandler(
  op: RouteOperation,
  indent: string,
  spec: OpenAPIV3_1.Document,
  schemaNames?: Set<string>,
  contextType?: string,
  zeroCast?: boolean,
  emitResponseValidation?: boolean,
  errorFormat?: ErrorFormat
): string {
  const lines: string[] = []
  const inner = `${indent}  `

  // ── Body schema ───────────────────────────────────────────────────────────
  // multipart/form-data and application/octet-stream bodies are not validated
  // by Fastify's schema.body slot (they use addContentTypeParser or raw stream).
  // Skip the body schema lookup for those content types to avoid assigning a
  // synthesized schema name that may also be used as a response schema (C1 naming).
  const isNonJsonBody =
    op.bodyInfo?.contentType === 'multipart/form-data' ||
    op.bodyInfo?.contentType === 'application/octet-stream'
  let bodySchemaExpr: string | undefined
  if (op.bodyInfo !== undefined && op.bodyInfo.typeName !== undefined && !isNonJsonBody) {
    const schemaName = `${op.bodyInfo.typeName}Schema`
    if (schemaNames !== undefined && schemaNames.has(schemaName)) {
      bodySchemaExpr = schemaName
    }
  }

  // ── Params schema (always includes all path params) ───────────────────────
  const paramsSchemaExpr = buildParamsSchemaExpr(op, spec)

  // ── Querystring schema ────────────────────────────────────────────────────
  // All query params are covered. deepObject/delimiter params use reshaped Zod types
  // (z.object/z.array) that match the shape after preValidation mutates req.query.
  let querystringSchemaExpr: string | undefined
  if (op.queryParams.length > 0) {
    const fields = op.queryParams
      .map((q) => {
        const key = /[^a-zA-Z0-9_$]/.test(q.name) ? JSON.stringify(q.name) : q.name
        return `${key}: ${queryParamZodExpr(q)}`
      })
      .join(', ')
    querystringSchemaExpr = `z.object({ ${fields} })`
  }

  // ── Headers schema ────────────────────────────────────────────────────────
  // Header keys MUST be lowercase in schema.headers: Fastify normalizes header names to lowercase.
  let headersSchemaExpr: string | undefined
  if (op.headerParams.length > 0) {
    const fields = op.headerParams
      .map((h) => {
        const key = JSON.stringify(h.rawName.toLowerCase())
        const expr = headerParamZodExpr(h)
        return `${key}: ${expr}`
      })
      .join(', ')
    headersSchemaExpr = `z.object({ ${fields} })`
  }

  // ── Response schema (#308) ────────────────────────────────────────────────
  let responseSchemaExpr: string | undefined
  if (
    schemaNames !== undefined &&
    op.responseTypeName !== undefined &&
    op.responseStatus.isMultiStatus !== true &&
    !op.responseStatus.isVoid
  ) {
    const schemaName = `${op.responseTypeName}Schema`
    if (schemaNames.has(schemaName)) {
      responseSchemaExpr = op.responseIsArray === true ? `z.array(${schemaName})` : schemaName
    }
  }

  // ── Synthesized response schema (emit_response_validation opt-in) ─────────
  // When emitResponseValidation is true and no named schema was found, synthesize
  // an inline Zod expression from the first 2xx JSON response schema. Only flat
  // schemas produce useful output: $ref, allOf, oneOf, anyOf, and nested objects
  // fall back to z.unknown(). Use input_schema for those.
  if (
    emitResponseValidation === true &&
    responseSchemaExpr === undefined &&
    op.responseStatus.isMultiStatus !== true &&
    !op.responseStatus.isVoid
  ) {
    const responses = op.rawOperation.responses as
      Record<string, ResponseObject | ReferenceObject> | undefined
    if (responses !== undefined) {
      // The priority-ordered 2xx response scan mirrors the one in fastify-service.ts
      // getReturnInfo. Both emitters must independently walk the same responses object:
      // fastify-service.ts resolves type names, this emitter synthesizes Zod expressions.
      // They cannot share a helper without coupling two separate generation passes.
      // fallow-ignore-next-line code-duplication
      const priority = [
        '200',
        '201',
        ...Object.keys(responses).filter(
          (k) => /^2\d\d$/.test(k) && k !== '200' && k !== '201' && k !== '204'
        ),
      ]
      for (const code of priority) {
        const response = responses[code]
        if (response === undefined || isRef(response)) continue
        const content = (response as ResponseObject).content as
          Record<string, { schema?: OpenAPIV3_1.SchemaObject | ReferenceObject }> | undefined
        if (content === undefined) continue
        const jsonContent = content['application/json']
        if (jsonContent?.schema === undefined) continue
        // Only synthesize for inline schemas: $ref responses are handled via named schema lookup.
        if (!isRef(jsonContent.schema)) {
          responseSchemaExpr = synthesizeResponseSchemaExpr(jsonContent.schema)
        }
        break
      }
    }
  }

  // ── preValidation hook for complex query params ───────────────────────────
  const preValidationLines = buildPreValidationLines(op.queryParams)

  // ── Assemble schema block ─────────────────────────────────────────────────
  const schemaParts: string[] = []
  if (bodySchemaExpr !== undefined) schemaParts.push(`body: ${bodySchemaExpr}`)
  if (paramsSchemaExpr !== undefined) schemaParts.push(`params: ${paramsSchemaExpr}`)
  if (querystringSchemaExpr !== undefined) schemaParts.push(`querystring: ${querystringSchemaExpr}`)
  if (headersSchemaExpr !== undefined) schemaParts.push(`headers: ${headersSchemaExpr}`)
  if (responseSchemaExpr !== undefined) {
    schemaParts.push(`response: { ${op.responseStatus.status}: ${responseSchemaExpr} }`)
  }

  const routeOpts = buildRouteOptions(
    schemaParts,
    preValidationLines,
    op.methodName,
    op.effectiveSecurity
  )
  lines.push(
    `${indent}app.${op.httpMethod}(${JSON.stringify(op.honoPath)}, ${routeOpts}, async (req, reply) => {`
  )

  // ── Context creation (createContext seam): when contextType is set, call
  //    options.createContext(req) first so auth rejection short-circuits before
  //    any other handler work. The result is passed as the last service arg.
  if (contextType !== undefined) {
    lines.push(`${inner}const ctx = await options.createContext(req)`)
  }

  // ── Cookie validation (manual _ckv: Fastify 5's FastifySchema has no cookie slot,
  //    so cookie params cannot go through the type-provider path. Read via a guarded
  //    local so that a missing @fastify/cookie plugin yields {} and a required cookie
  //    is simply absent, producing a clean 422 instead of a TypeError 500.) ─────
  if (op.cookieParams.length > 0) {
    const fieldIndent = `${indent}    `
    const schemaFields = op.cookieParams
      .map((ck) => `${fieldIndent}${JSON.stringify(ck.rawName)}: ${cookieParamZodExpr(ck)}`)
      .join(',\n')
    const rawFields = op.cookieParams
      .map(
        (ck) =>
          `${fieldIndent}${JSON.stringify(ck.rawName)}: _cookies[${JSON.stringify(ck.rawName)}]`
      )
      .join(',\n')
    lines.push(
      `${inner}const _cookies = (req as { cookies?: Record<string, string | undefined> }).cookies ?? {}`
    )
    lines.push(`${inner}// Validate request cookies: returns 422 with Zod issues on failure`)
    lines.push(`${inner}const _ckv = z.object({`)
    lines.push(schemaFields)
    lines.push(`${inner}}).safeParse({`)
    lines.push(rawFields)
    lines.push(`${inner}})`)
    lines.push(`${inner}if (!_ckv.success) {`)
    lines.push(
      `${inner}  ${fastifyErrorReturn(422, 'Invalid request cookies', '_ckv.error.issues', errorFormat)}`
    )
    lines.push(`${inner}}`)
  }

  // ── Service call: build a single input object from the present facets, ctx separate ──
  // Each facet key mirrors the Fastify request object. Only include facets the op has.
  // This matches the `input: { params; body; query; headers; cookies }` shape emitted
  // by the service signature builder, eliminating the required-after-optional TS1016.

  const inputFacets: string[] = []

  // params facet: pass req.params (typed by schema.params via ZodTypeProvider).
  if (op.pathParams.length > 0) {
    inputFacets.push('params: req.params')
  }

  // body facet: pass req.body with the same cast logic as before.
  //
  // Zero-cast path (zeroCast=true, enabled when framework=fastify + input_schema configured):
  // The service parameter is z.infer of the body schema, which is exactly what ZodTypeProvider
  // infers for req.body after the validatorCompiler validates it. No cast needed.
  //
  // Legacy path (zeroCast=false): The service parameter is a TypeScript interface from models.ts
  // which may differ structurally from z.infer (e.g. passthrough adds an index signature). We cast
  // to the named model type (safe: validation already ran) or fall back to `any` for synthesized.
  if (op.bodyInfo !== undefined) {
    let bodyExpr: string
    if (zeroCast === true) {
      // Zero-cast: req.body aligns with z.infer<BodySchema> which aligns with service param.
      // For content types without Zod validation (octet-stream, multipart), fall back to unknown.
      const hasBodySchema = bodySchemaExpr !== undefined
      if (
        hasBodySchema ||
        (op.bodyInfo.contentType !== 'application/octet-stream' &&
          op.bodyInfo.contentType !== 'multipart/form-data')
      ) {
        bodyExpr = 'req.body'
      } else {
        bodyExpr = 'req.body as unknown'
      }
    } else if (op.bodyInfo.typeName !== undefined && !op.bodyInfo.isSynthesized) {
      bodyExpr = `req.body as ${op.bodyInfo.typeName}`
    } else if (bodySchemaExpr !== undefined) {
      bodyExpr = 'req.body as any'
    } else {
      bodyExpr = 'req.body as unknown'
    }
    inputFacets.push(`body: ${bodyExpr}`)
  }

  // query facet: typed via schema.querystring. preValidation has already reshaped req.query
  // for deepObject/delimiter routes, and the validatorCompiler validated the shape (#344).
  if (op.queryParams.length > 0) {
    inputFacets.push('query: req.query')
  }

  // headers facet: construct a fresh object from the declared header fields.
  // ZodTypeProvider narrows req.headers['x'] to string (required) or string | undefined (optional)
  // for each field in schema.headers. We build a fresh object to match the precise service type.
  // No `as` cast: each property access is correctly typed by ZodTypeProvider.
  if (op.headerParams.length > 0) {
    const fields = op.headerParams
      .map((h) => {
        const key = JSON.stringify(h.rawName.toLowerCase())
        return `${key}: req.headers[${key}]`
      })
      .join(', ')
    inputFacets.push(`headers: { ${fields} }`)
  }

  // cookies facet: _ckv.data is the validated cookie object, available here because the
  // _ckv.success guard above returns early on failure.
  if (op.cookieParams.length > 0) {
    inputFacets.push('cookies: _ckv.data')
  }

  // Assemble the service call: (input, ctx) when facets present, (ctx) or () when not.
  const inputArg = inputFacets.length > 0 ? `{ ${inputFacets.join(', ')} }` : undefined
  const ctxArg = contextType !== undefined ? 'ctx' : undefined
  const callArgs = [inputArg, ctxArg].filter((a): a is string => a !== undefined)

  const serviceCall = `service.${op.methodName}(${callArgs.join(', ')})`

  // Response cast: the serializerCompiler validates the response at runtime against the response
  // schema. At compile time the ZodTypeProvider constrains reply.send() to the schema's inferred
  // type, which can diverge structurally from the service's return (model) type (e.g. a passthrough
  // object adds an index signature).
  //
  // Zero-cast path: both service.ts and router.ts use z.infer aliases so they align exactly.
  // No cast needed.
  //
  // Legacy path: when the response schema is a named schema we assert to its inferred type (safe:
  // serializerCompiler validates at runtime); inline response schemas fall back to `any`.
  let responseCast: string
  if (zeroCast === true) {
    responseCast = ''
  } else if (responseSchemaExpr === undefined) {
    responseCast = ''
  } else if (/^[A-Za-z_$][\w$]*$/.test(responseSchemaExpr)) {
    responseCast = ` as z.infer<typeof ${responseSchemaExpr}>`
  } else {
    responseCast = ' as any'
  }

  // ── Response (no per-route try/catch: setErrorHandler handles HttpError) ──

  // Use the robust content-type detector so that $ref'd requestBodies and operations with
  // multiple declared content types (e.g. both json and multipart) are handled correctly.
  const isMultipartRoute = operationHasBodyContentType(op.rawOperation, 'multipart/form-data', spec)
  const isOctetRoute = operationHasBodyContentType(
    op.rawOperation,
    'application/octet-stream',
    spec
  )
  if (isMultipartRoute) {
    // multipart/form-data: requires @fastify/multipart registered with { attachFieldsToBody: 'keyValues' }.
    lines.push(
      `${inner}// multipart/form-data: req.body has field values directly (and file fields as @fastify/multipart file objects) via { attachFieldsToBody: 'keyValues' }.`
    )
  } else if (isOctetRoute) {
    // application/octet-stream: req.body is a Buffer from the registered content-type parser.
    lines.push(
      `${inner}// application/octet-stream: req.body is a Buffer from the registered content-type parser.`
    )
  }

  if (op.responseStatus.isVoid) {
    lines.push(`${inner}await ${serviceCall}`)
    lines.push(`${inner}reply.status(${op.responseStatus.status}).send()`)
  } else if (op.responseStatus.isMultiStatus === true) {
    lines.push(`${inner}const _envelope = await ${serviceCall}`)
    lines.push(`${inner}return reply.status(_envelope.status).send(_envelope.body)`)
  } else if (op.responseStatus.responseContentType === 'text/plain') {
    if (op.responseStatus.status === 200) {
      lines.push(`${inner}return reply.type('text/plain').send(await ${serviceCall})`)
    } else {
      lines.push(
        `${inner}return reply.status(${op.responseStatus.status}).type('text/plain').send(await ${serviceCall})`
      )
    }
  } else if (op.responseStatus.responseContentType === 'application/octet-stream') {
    if (op.responseStatus.status === 200) {
      lines.push(
        `${inner}return reply.type('application/octet-stream').send(Buffer.from(await ${serviceCall}))`
      )
    } else {
      lines.push(
        `${inner}return reply.status(${op.responseStatus.status}).type('application/octet-stream').send(Buffer.from(await ${serviceCall}))`
      )
    }
  } else if (op.responseStatus.status === 200) {
    lines.push(`${inner}return reply.send((await ${serviceCall})${responseCast})`)
  } else {
    lines.push(
      `${inner}return reply.status(${op.responseStatus.status}).send((await ${serviceCall})${responseCast})`
    )
  }

  lines.push(`${indent}})`)
  return lines.join('\n')
}

// ── Body content-type detector ────────────────────────────────────────────────

/**
 * Resolve a requestBody object, following a $ref into spec.components.requestBodies when needed.
 * Returns the resolved RequestBodyObject or undefined when the ref cannot be resolved.
 */
function resolveRequestBody(
  requestBody: OpenAPIV3_1.RequestBodyObject | OpenAPIV3_1.ReferenceObject | undefined,
  spec: OpenAPIV3_1.Document
): OpenAPIV3_1.RequestBodyObject | undefined {
  if (requestBody === undefined) return undefined
  if (!isRef(requestBody)) return requestBody as OpenAPIV3_1.RequestBodyObject
  const refStr = (requestBody as OpenAPIV3_1.ReferenceObject).$ref
  // Only support inline #/components/requestBodies/<Name> refs.
  const match = /^#\/components\/requestBodies\/(.+)$/.exec(refStr)
  if (match === null) return undefined
  const name = match[1]
  const components = spec.components as OpenAPIV3_1.ComponentsObject | undefined
  const rb = (
    components?.requestBodies as
      Record<string, OpenAPIV3_1.RequestBodyObject | OpenAPIV3_1.ReferenceObject> | undefined
  )?.[name ?? '']
  if (rb === undefined || isRef(rb)) return undefined
  return rb as OpenAPIV3_1.RequestBodyObject
}

/**
 * Return true if ANY declared content type in the operation's requestBody matches the given
 * content type string. Resolves $ref'd requestBodies so that multipart-via-$ref is detected.
 * This is used to gate parser-registration and per-route markers independently of getBodyInfo's
 * json-priority logic, which only picks ONE content type even when multiple are declared.
 */
function operationHasBodyContentType(
  operation: OperationObject,
  contentType: string,
  spec: OpenAPIV3_1.Document
): boolean {
  const raw = operation.requestBody as
    OpenAPIV3_1.RequestBodyObject | OpenAPIV3_1.ReferenceObject | undefined
  const rb = resolveRequestBody(raw, spec)
  if (rb === undefined) return false
  const content = rb.content as Record<string, unknown> | undefined
  return content !== undefined && Object.prototype.hasOwnProperty.call(content, contentType)
}

// ── Main generator export ─────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function generateFastifyRouter(
  spec: OpenAPIV3_1.Document,
  options?: RouterOptions
): GeneratedFile {
  const serviceName = deriveServiceName(spec)
  const operations = collectOperations(spec, options?.schemaNames)

  // Collect schema names used for body and response wiring.
  const usedSchemaNames =
    options?.schemaNames !== undefined
      ? collectUsedSchemaNames(operations, options.schemaNames)
      : new Set<string>()
  const usedResponseSchemaNames =
    options?.schemaNames !== undefined
      ? collectUsedResponseSchemaNames(operations, options.schemaNames)
      : new Set<string>()
  const allUsedSchemaNames = new Set([...usedSchemaNames, ...usedResponseSchemaNames])

  // Collect body type names for model imports. Only needed in the legacy (non-zero-cast) path.
  // When zeroCast=true, models.ts is skipped and schema-types.js is used instead.
  const zeroCast = options?.zeroCast === true
  const sortedBodyTypes = zeroCast ? [] : collectSortedBodyTypes(operations)

  // z is always needed: schema.params/querystring/headers/response use z.object/z.array/z.string.
  // Even with no operations, the cookie _ckv block uses z.
  //
  // Detection scans ALL declared content types on each operation's requestBody, resolving $refs,
  // so multipart/formbody routes are found even when the requestBody is a $ref'd component or
  // when the operation declares multiple content types (e.g. both json and multipart). This is
  // independent of getBodyInfo's json-priority logic which only returns ONE content type.
  const hasOctetStreamRequestBody = operations.some((op) =>
    operationHasBodyContentType(op.rawOperation, 'application/octet-stream', spec)
  )
  const hasFormUrlencodedBody = operations.some((op) =>
    operationHasBodyContentType(op.rawOperation, 'application/x-www-form-urlencoded', spec)
  )
  const hasMultipartBody = operations.some((op) =>
    operationHasBodyContentType(op.rawOperation, 'multipart/form-data', spec)
  )
  const hasAnyParserNeeded = hasOctetStreamRequestBody || hasFormUrlencodedBody || hasMultipartBody

  // When context_type is configured the router becomes generic over Ctx. The concrete
  // principal type is inferred at the call site (from the service implementation and
  // createContext), so no unresolved context type name is baked into the generated file.
  const ctx = options?.contextType
  const serviceRef = ctx !== undefined ? `${serviceName}<Ctx>` : serviceName

  const lines: string[] = []
  lines.push('// This file is auto-generated. Do not edit manually.')
  lines.push(
    '// @fastify/formbody and @fastify/multipart are auto-registered inside the plugin for the content types your spec uses.'
  )
  lines.push(
    '// Pass multipart.limits in CreateRouterOptions to raise upload-size caps, or registerParsers: false to opt out entirely.'
  )
  lines.push('')
  lines.push("import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'")
  lines.push("import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'")
  lines.push(
    "import type { FastifyRequest, FastifyReply, onRequestHookHandler, preHandlerHookHandler, onSendHookHandler, onErrorHookHandler } from 'fastify'"
  )
  if (sortedBodyTypes.length > 0) {
    lines.push(`import type { ${sortedBodyTypes.join(', ')} } from './models.js'`)
  }
  lines.push(`import type { ${serviceName} } from './service.js'`)
  // z is always imported for schema.params/querystring/headers/response and cookie _ckv blocks.
  lines.push(`import { z } from 'zod'`)
  if (allUsedSchemaNames.size > 0 && options?.schemaImportPath !== undefined) {
    const specifiers = formatSchemaImportSpecifiers(allUsedSchemaNames, options.schemaImportAliases)
    lines.push(`import { ${specifiers} } from '${options.schemaImportPath}'`)
  }
  lines.push('')
  // Augment FastifyContextConfig so that config: { operationId, security } on each route is type-safe.
  lines.push("declare module 'fastify' {")
  lines.push('  interface FastifyContextConfig {')
  lines.push('    operationId?: string')
  lines.push('    security?: Array<{ scheme: string; scopes: string[] }>')
  lines.push('  }')
  lines.push('}')
  const errorsImportPath = options?.errorsImportPath ?? './_shared/errors.js'
  lines.push('')
  lines.push(`import { HttpError } from '${errorsImportPath}'`)
  lines.push(`export { HttpError } from '${errorsImportPath}'`)
  lines.push('')
  const problemJson = isProblemJson(options?.errorFormat)
  if (problemJson) lines.push(...fastifyProblemHelperLines())
  // Emit the CreateRouterOptions escape hatch so callers can override compilers/errorHandler
  // and control parser registration without having to re-implement the whole plugin.
  // When context_type is set, the interface is generic and adds the required createContext field.
  const optionsInterfaceDecl =
    ctx !== undefined
      ? 'export interface CreateRouterOptions<Ctx = never> {'
      : 'export interface CreateRouterOptions {'
  lines.push(optionsInterfaceDecl)
  if (ctx !== undefined) {
    lines.push('  /**')
    lines.push('   * Produce a typed request context from the raw Fastify request.')
    lines.push('   * Called at the start of every route handler, before param extraction.')
    lines.push('   * Throw an HttpError(401) (or any error) here to reject the request.')
    lines.push(
      '   * The returned value is passed as the final ctx argument to every service method.'
    )
    lines.push('   *')
    lines.push('   * Operation security metadata is available on')
    lines.push('   * req.routeOptions.config.security so you can inspect required scopes here.')
    lines.push('   */')
    lines.push('  createContext: (req: FastifyRequest) => Ctx | Promise<Ctx>')
  }
  lines.push('  errorHandler?: (err: Error, req: FastifyRequest, reply: FastifyReply) => void')
  // fastify-type-provider-zod exports the compilers as values, not as named types; deriving the
  // option types via `typeof` keeps the generated file self-contained and always type-correct.
  lines.push('  validatorCompiler?: typeof validatorCompiler')
  lines.push('  serializerCompiler?: typeof serializerCompiler')
  lines.push('  /** Set to false to skip automatic parser registration (default: true). */')
  lines.push('  registerParsers?: boolean')
  if (hasMultipartBody) {
    lines.push('  /**')
    lines.push('   * Options forwarded to @fastify/multipart when it is auto-registered.')
    lines.push("   * Merged over the generated defaults (attachFieldsToBody stays 'keyValues').")
    lines.push('   * Use limits.fileSize to raise the per-file upload cap without setting')
    lines.push('   * registerParsers: false.')
    lines.push('   *')
    lines.push("   * Note: @fastify/multipart's fileSize caps the multipart stream, but Fastify")
    lines.push('   * core bodyLimit (default 1 MiB) caps the raw request body first. For large')
    lines.push(
      '   * uploads also raise it at instance creation, e.g. Fastify({ bodyLimit: 20_000_000 }).'
    )
    lines.push('   */')
    lines.push('  multipart?: {')
    lines.push('    limits?: {')
    lines.push('      fieldNameSize?: number')
    lines.push('      fieldSize?: number')
    lines.push('      fields?: number')
    lines.push('      fileSize?: number')
    lines.push('      files?: number')
    lines.push('      headerPairs?: number')
    lines.push('      parts?: number')
    lines.push('    }')
    lines.push('  }')
  }
  lines.push('  /**')
  lines.push('   * Register additional routes on the Fastify instance after the ZodTypeProvider')
  lines.push('   * compilers, error handler, and body parsers are set up. Custom routes registered')
  lines.push('   * here inherit the ZodTypeProvider context and the HttpError error handler.')
  lines.push('   */')
  lines.push(
    "  registerCustomRoutes?: (app: import('fastify').FastifyInstance) => void | Promise<void>"
  )
  // Global hook fields: single handler or array, plugin-scoped so they cover all routes.
  lines.push('  /**')
  lines.push('   * Lifecycle hooks registered via app.addHook inside the plugin scope.')
  lines.push('   * Hooks are plugin-scoped: they apply to all generated routes and any routes')
  lines.push('   * added via registerCustomRoutes, but NOT to the parent Fastify instance.')
  lines.push('   *')
  lines.push('   * Hook execution order per request:')
  lines.push('   *   onRequest -> preHandler -> route handler -> onSend')
  lines.push('   *')
  lines.push('   * onError fires when a route handler or hook throws; it is an observability hook.')
  lines.push('   * The errorHandler (setErrorHandler) is the single response-producer and coexists')
  lines.push('   * with onError hooks: both fire, but only errorHandler writes the response.')
  lines.push('   *')
  lines.push('   * Pass a single handler or an array of handlers; both are accepted.')
  lines.push('   */')
  lines.push('  onRequest?: onRequestHookHandler | onRequestHookHandler[]')
  lines.push('  preHandler?: preHandlerHookHandler | preHandlerHookHandler[]')
  lines.push('  onSend?: onSendHookHandler | onSendHookHandler[]')
  lines.push('  onError?: onErrorHookHandler | onErrorHookHandler[]')
  lines.push('}')
  lines.push('')
  // When context_type is set, createRouter is generic over Ctx and options is required
  // (createContext is required inside it). When not set, options stays optional for
  // backward compatibility.
  const typeParam = ctx !== undefined ? '<Ctx = never>' : ''
  const optionsParam =
    ctx !== undefined ? 'options: CreateRouterOptions<Ctx>' : 'options?: CreateRouterOptions'
  lines.push(
    `export function createRouter${typeParam}(service: ${serviceRef}, ${optionsParam}): FastifyPluginAsyncZod {`
  )
  lines.push('  return async (app) => {')

  // FastifyPluginAsyncZod carries ZodTypeProvider: no withTypeProvider() call needed.
  // Compilers and error handler are scoped to the plugin instance, not the root app.
  lines.push('    app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)')
  lines.push('    app.setSerializerCompiler(options?.serializerCompiler ?? serializerCompiler)')
  // Error handler: use caller-supplied handler when provided; otherwise use the built-in
  // FST_ERR_VALIDATION-aligned envelope for HttpError responses.
  lines.push('    if (options?.errorHandler !== undefined) {')
  lines.push('      app.setErrorHandler(options.errorHandler)')
  lines.push('    } else {')
  if (problemJson) {
    // error_format: 'problem+json': one handler maps HttpError, validation, serialization and
    // other 4xx framework errors to application/problem+json; anything else is re-thrown.
    lines.push('      app.setErrorHandler((err, req, reply) => {')
    lines.push(...fastifyProblemErrorHandlerLines('        '))
    lines.push('      })')
    lines.push('    }')
  } else {
    // Emit a small status-code-to-code lookup for the error envelope. This mirrors the
    // FST_ERR_VALIDATION shape (statusCode, code, error, message) so HttpError responses
    // are structurally consistent with Fastify's built-in validation errors.
    lines.push('      const _HTTP_CODES: Record<number, string> = {')
    lines.push("        400: 'BAD_REQUEST',")
    lines.push("        401: 'UNAUTHORIZED',")
    lines.push("        403: 'FORBIDDEN',")
    lines.push("        404: 'NOT_FOUND',")
    lines.push("        409: 'CONFLICT',")
    lines.push("        410: 'GONE',")
    lines.push("        422: 'UNPROCESSABLE_ENTITY',")
    lines.push("        429: 'TOO_MANY_REQUESTS',")
    lines.push("        500: 'INTERNAL_ERROR',")
    lines.push('      }')
    lines.push('      app.setErrorHandler((err, _req, reply) => {')
    lines.push('        if (err instanceof HttpError) {')
    lines.push("          const _errCode = _HTTP_CODES[err.status] ?? 'APP_ERROR'")
    lines.push('          const _errReply = reply.status(err.status)')
    lines.push(
      '          return _errReply.send({ statusCode: err.status, code: _errCode, error: err.message, message: err.message })'
    )
    lines.push('        }')
    lines.push('        throw err')
    lines.push('      })')
    lines.push('    }')
  }

  // Global lifecycle hooks: registered after setErrorHandler, before body parsers.
  // _asHookArray normalizes single-handler and array forms into a plain array.
  lines.push(
    '    const _asHookArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])'
  )
  lines.push("    for (const _h of _asHookArray(options?.onRequest)) app.addHook('onRequest', _h)")
  lines.push(
    "    for (const _h of _asHookArray(options?.preHandler)) app.addHook('preHandler', _h)"
  )
  lines.push("    for (const _h of _asHookArray(options?.onSend)) app.addHook('onSend', _h)")
  lines.push("    for (const _h of _asHookArray(options?.onError)) app.addHook('onError', _h)")

  // Auto-register body parsers for content types the spec uses, gated on registerParsers !== false.
  // Callers can raise upload size limits via multipart.limits in CreateRouterOptions without opting out.
  // To take full control of @fastify/multipart options, pass registerParsers: false and register the plugin manually.
  if (hasAnyParserNeeded) {
    // Registrations are guarded by hasContentTypeParser so they are idempotent and order-safe:
    // if the caller already registered the parser on a parent scope (the child inherits it), we skip.
    // app.register is intentionally not awaited — awaiting a register inside an async plugin can
    // stall boot; avvio loads queued registrations before the plugin is considered ready.
    lines.push('    if (options?.registerParsers !== false) {')
    if (hasFormUrlencodedBody) {
      lines.push("      if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {")
      lines.push("        const _formbody = await import('@fastify/formbody')")
      lines.push('        app.register(_formbody.default ?? _formbody)')
      lines.push('      }')
    }
    if (hasMultipartBody) {
      lines.push("      if (!app.hasContentTypeParser('multipart/form-data')) {")
      lines.push("        const _multipart = await import('@fastify/multipart')")
      // attachFieldsToBody: 'keyValues' puts each field's value directly on req.body
      // (file fields become @fastify/multipart file objects), which is what handlers and
      // body validators expect. The previous `true` wrapped every field in a busboy object.
      lines.push(
        "        app.register(_multipart.default ?? _multipart, { attachFieldsToBody: 'keyValues', ...options?.multipart })"
      )
      lines.push('      }')
    }
    if (hasOctetStreamRequestBody) {
      lines.push("      if (!app.hasContentTypeParser('application/octet-stream')) {")
      lines.push(
        "        app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => done(null, body))"
      )
      lines.push('      }')
    }
    lines.push('    }')
  }

  // registerCustomRoutes: invoked after compilers, error handler, and parsers are set up
  // so custom routes inherit the ZodTypeProvider context and HttpError handling.
  lines.push('    if (options?.registerCustomRoutes !== undefined) {')
  lines.push('      await options.registerCustomRoutes(app)')
  lines.push('    }')

  for (const op of operations) {
    lines.push('')
    lines.push(
      buildFastifyTypeProviderHandler(
        op,
        '    ',
        spec,
        options?.schemaNames,
        ctx,
        zeroCast,
        options?.emitResponseValidation,
        options?.errorFormat
      )
    )
  }

  lines.push('  }')
  lines.push('}')
  lines.push('')

  return {
    filename: 'router.ts',
    content: lines.join('\n'),
  }
}
