import type { OpenAPIV3_1 } from 'openapi-types'
import type { GeneratedFile } from 'openapi-zod-ts'
import { buildWritableVariantMap } from 'openapi-zod-ts'
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
import {
  type HeaderParam,
  type CookieParam,
  type ResponseStatus,
  getHeaderParams,
  getCookieParams,
  getResponseStatus,
  collectSortedBodyTypes,
  collectUsedResponseSchemaNames,
} from './operation-ir.js'
import { formatSchemaImportSpecifiers } from './schema-prefix.js'
import {
  type ErrorFormat,
  isProblemJson,
  honoErrorReturn,
  honoHttpErrorReturn,
  honoProblemHelperLines,
  expressErrorReturn,
  expressHttpErrorReturn,
  expressProblemHelperLines,
} from './problem-details.js'
// Fastify emitter: delegates to the dedicated type-provider module.
export { generateFastifyRouter } from './fastify-type-provider.js'
import {
  findPrimaryJsonResponseSchema,
  synthesizeResponseSchemaExpr,
} from './fastify-type-provider.js'

type OperationObject = OpenAPIV3_1.OperationObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type ParameterObject = OpenAPIV3_1.ParameterObject
type ResponseObject = OpenAPIV3_1.ResponseObject

/** Convert OpenAPI path to Hono path: {id} -> :id */
function toHonoPath(openapiPath: string): string {
  return openapiPath.replace(/\{([^}]+)\}/g, ':$1')
}

// ── Param validation helpers ──────────────────────────────────────────────────

/** Represents a path parameter that needs Zod format validation. */
interface PathParamValidation {
  /** Raw name as it appears in the URL path (e.g. 'job-id'). */
  rawName: string
  /** Zod chain expression for the value (e.g. 'z.string().uuid()'). */
  zodExpr: string
}

/**
 * Map a schema format string to a Zod 4 top-level format expression.
 * Returns undefined when no specific format validation is needed.
 * Known formats replace z.string() entirely (e.g. z.uuid() not z.string().uuid()).
 */
function formatToZodModifier(format: string): string | undefined {
  switch (format) {
    case 'uuid':
      return 'z.uuid()'
    case 'email':
      return 'z.email()'
    case 'uri':
    case 'url':
      return 'z.url()'
    case 'date-time':
      return 'z.iso.datetime()'
    default:
      return undefined
  }
}

/**
 * Build a Zod expression for a path parameter based on its schema.
 * Returns undefined when the parameter does not need validation.
 *
 * String params: validates format (uuid, email, url, date-time) via top-level Zod 4 forms.
 * Integer/number params: validates range (minimum/maximum) via z.coerce.number().min().max().
 * z.coerce.number() is used for path params because c.req.param() always returns a string;
 * coercion converts the URL string to a number before the min/max check.
 */
// fallow-ignore-next-line complexity
function pathParamZodExpr(
  schema: OpenAPIV3_1.SchemaObject | ReferenceObject | undefined
): string | undefined {
  if (schema === undefined || isRef(schema)) return undefined
  const s = schema as OpenAPIV3_1.SchemaObject & {
    exclusiveMinimum?: number | boolean
    exclusiveMaximum?: number | boolean
  }

  // Integer / number path params with range constraints
  if (s.type === 'integer' || s.type === 'number') {
    const hasMin = typeof s.minimum === 'number'
    const hasMax = typeof s.maximum === 'number'
    const hasExcMin = typeof s.exclusiveMinimum === 'number'
    const hasExcMax = typeof s.exclusiveMaximum === 'number'
    if (hasMin || hasMax || hasExcMin || hasExcMax) {
      let expr = 'z.coerce.number()'
      if (hasMin) expr += `.min(${s.minimum})`
      if (hasMax) expr += `.max(${s.maximum})`
      if (hasExcMin) expr += `.gt(${s.exclusiveMinimum})`
      if (hasExcMax) expr += `.lt(${s.exclusiveMaximum})`
      return expr
    }
    return undefined
  }

  // String path params: only validated when a known format expression exists
  if (s.type !== 'string') return undefined
  const format = s.format as string | undefined
  if (format === undefined) return undefined
  return formatToZodModifier(format)
}

// ── queryParamZodExpr helpers (one per param kind) ───────────────────────────

/** Delimited array param: value has been split into string[] by the extraction layer. */
function queryParamDelimitedZodBase(_param: QueryParam): string {
  return 'z.array(z.string())'
}

/**
 * DeepObject param: assembled into Record<string, string>.
 * Emits z.object({...}) with per-property coercion; all properties are .optional()
 * because their presence is governed by the outer object's required flag.
 */
function queryParamDeepObjectZodBase(param: QueryParam): string {
  const propFields = (param.deepObjectProperties ?? []).map((p) => {
    const coerced = p.tsType === 'number' ? 'z.coerce.number()' : 'z.string()'
    return `${p.key}: ${coerced}.optional()`
  })
  return `z.object({ ${propFields.join(', ')} })`
}

/** Coerce a single array item's Zod expression based on its item type. Mirrors the
 * Fastify emitter's queryParamItemExpr so hono/express validate the same shape. */
function queryParamItemZodExpr(itemsTsType: string | undefined): string {
  if (itemsTsType === 'number') return 'z.coerce.number()'
  if (itemsTsType === 'boolean') return 'z.boolean()'
  return 'z.string()'
}

/** Plain repeated-key array param (type:array, explode:true): value has been collected
 * into an array by the extraction layer; emits z.array(<itemExpr>) so the querystring
 * schema matches the service T[] signature instead of falling through to z.string(). */
function queryParamArrayZodBase(param: QueryParam): string {
  return `z.array(${queryParamItemZodExpr(param.itemsTsType)})`
}

/** Number/integer param: z.coerce.number() with optional range modifiers.
 * Uses coerce so that Fastify's raw string values (fast-querystring never converts types)
 * are accepted alongside the already-coerced numbers from Express/Hono extraction. */
function queryParamNumberZodBase(param: QueryParam): string {
  let base = 'z.coerce.number()'
  if (param.minimum !== undefined) base += `.min(${param.minimum})`
  if (param.maximum !== undefined) base += `.max(${param.maximum})`
  if (param.exclusiveMinimum !== undefined) base += `.gt(${param.exclusiveMinimum})`
  if (param.exclusiveMaximum !== undefined) base += `.lt(${param.exclusiveMaximum})`
  return base
}

/** String param: z.string() or z.enum([...]) with optional length/pattern modifiers. */
function queryParamStringZodBase(param: QueryParam): string {
  let base: string
  if (param.enum !== undefined && param.enum.length > 0) {
    const members = param.enum.map((v) => JSON.stringify(v)).join(', ')
    base = `z.enum([${members}])`
  } else {
    base = 'z.string()'
  }
  if (param.minLength !== undefined) base += `.min(${param.minLength})`
  if (param.maxLength !== undefined) base += `.max(${param.maxLength})`
  if (param.pattern !== undefined) base += `.regex(/${param.pattern}/)`
  return base
}

/**
 * Build a Zod expression for a query parameter based on its captured constraints.
 * Number/integer types use z.number() (after coercion by extraction code).
 * String types use z.string() with optional format/enum/pattern/length modifiers.
 * Delimited array params use z.array(z.string()).
 * DeepObject params use z.object({...}) with per-property coercion.
 * Plain repeated-key array params (explode:true) use z.array(<itemExpr>).
 * Appends .optional() for non-required params.
 */
function queryParamZodExpr(param: QueryParam): string {
  let base: string
  if (param.delimiterStyle !== undefined) {
    base = queryParamDelimitedZodBase(param)
  } else if (param.isDeepObject === true && param.deepObjectProperties !== undefined) {
    base = queryParamDeepObjectZodBase(param)
  } else if (param.isArray === true) {
    base = queryParamArrayZodBase(param)
  } else if (param.tsType === 'number') {
    base = queryParamNumberZodBase(param)
  } else if (param.tsType === 'boolean') {
    base = 'z.boolean()'
  } else {
    base = queryParamStringZodBase(param)
  }
  return param.required ? base : `${base}.optional()`
}

/**
 * Build a Zod expression for a header parameter based on its captured constraints.
 * Header values are always strings; emits z.string() or z.enum([...]) with optional
 * pattern/length modifiers. Appends .optional() for non-required params.
 */
function headerParamZodExpr(param: HeaderParam): string {
  let base: string
  if (param.enum !== undefined && param.enum.length > 0) {
    const members = param.enum.map((v) => JSON.stringify(v)).join(', ')
    base = `z.enum([${members}])`
  } else {
    base = 'z.string()'
  }
  if (param.minLength !== undefined) base += `.min(${param.minLength})`
  if (param.maxLength !== undefined) base += `.max(${param.maxLength})`
  if (param.pattern !== undefined) base += `.regex(/${param.pattern}/)`
  return param.required ? base : `${base}.optional()`
}

/**
 * Collect path parameters that have Zod format constraints.
 * Only returns entries for params that need format validation (e.g. uuid).
 * Simple string params with no format constraint are excluded.
 */
function getPathParamValidations(
  operation: OperationObject,
  spec: OpenAPIV3_1.Document,
  rawPathParamNames: string[]
): PathParamValidation[] {
  const parameters = operation.parameters as (ParameterObject | ReferenceObject)[] | undefined
  if (parameters === undefined) return []

  // Build a name-to-zodExpr map from path params to avoid nested loops.
  const zodByName = new Map<string, string>()
  for (const p of parameters) {
    const resolved = resolveParam(p, spec)
    if (resolved === undefined || resolved.in !== 'path') continue
    const schema = resolved.schema as OpenAPIV3_1.SchemaObject | ReferenceObject | undefined
    const zodExpr = pathParamZodExpr(schema)
    if (zodExpr !== undefined) zodByName.set(resolved.name, zodExpr)
  }

  const result: PathParamValidation[] = []
  for (const rawName of rawPathParamNames) {
    const zodExpr = zodByName.get(rawName)
    if (zodExpr !== undefined) result.push({ rawName, zodExpr })
  }
  return result
}

/**
 * Build a Zod expression for a cookie parameter based on its captured constraints.
 * Cookie values are always strings; emits z.string() or z.enum([...]) with optional
 * pattern/length modifiers. Appends .optional() for non-required params.
 */
function cookieParamZodExpr(param: CookieParam): string {
  let base: string
  if (param.enum !== undefined && param.enum.length > 0) {
    const members = param.enum.map((v) => JSON.stringify(v)).join(', ')
    base = `z.enum([${members}])`
  } else {
    base = 'z.string()'
  }
  if (param.minLength !== undefined) base += `.min(${param.minLength})`
  if (param.maxLength !== undefined) base += `.max(${param.maxLength})`
  if (param.pattern !== undefined) base += `.regex(/${param.pattern}/)`
  return param.required ? base : `${base}.optional()`
}

/**
 * Returns true when a query param carries schema constraints beyond basic type/required.
 * These constraints require a Zod validation block even if the param is optional or string.
 */
function queryParamHasConstraints(q: QueryParam): boolean {
  // Fields that, when defined, indicate schema constraints are present.
  const constraintFields: unknown[] = [
    q.enum,
    q.minimum,
    q.maximum,
    q.exclusiveMinimum,
    q.exclusiveMaximum,
    q.minLength,
    q.maxLength,
    q.pattern,
    q.delimiterStyle,
  ]
  return constraintFields.some((f) => f !== undefined) || q.isDeepObject === true
}

/**
 * Determine whether query params need a Zod validation block.
 * Triggered when any param is required, has a non-string type (to catch NaN/invalid input),
 * or carries schema constraints (enum, min/max, pattern, etc.).
 */
function queryParamsNeedValidation(queryParams: QueryParam[]): boolean {
  return queryParams.some((q) => q.required || q.tsType !== 'string' || queryParamHasConstraints(q))
}

/** Returns the delimiter character for a delimited-style array query param. */
function delimiterChar(style: 'csv' | 'ssv' | 'psv'): string {
  if (style === 'ssv') return ' '
  if (style === 'psv') return '|'
  return ','
}

/**
 * Build the Hono extraction expression for a plain repeated-key array query param
 * (explode:true). c.req.queries(name) collects every occurrence of the key into
 * string[] | undefined; items are coerced to match queryParamArrayZodBase's item
 * expression so the extracted value and the Zod validation agree on the runtime type.
 */
function honoArrayQueryExpr(q: QueryParam): string {
  const base = `c.req.queries('${q.rawName}')`
  if (q.itemsTsType === 'number') return `${base}?.map(Number)`
  if (q.itemsTsType === 'boolean') return `${base}?.map((v) => v === 'true')`
  return base
}

/**
 * Build the Express extraction expression for a plain repeated-key array query param
 * (explode:true). Express (via qs) gives a REPEATED key (?ids=1&ids=2) as string[], but a
 * SINGLE occurrence (?ids=1) as a bare string and an absent key as undefined; _toQueryArray
 * (emitted once per file, see generateExpressRouter) normalizes all three cases to
 * string[] | undefined before item coercion, mirroring queryParamArrayZodBase's item expression.
 */
/**
 * Source of the `_toQueryBool` helper emitted once per Hono/Express router file when any
 * operation declares a scalar boolean query param. Query values are strings on the wire:
 * 'true'/'false' are coerced to booleans, every other value (including undefined) is
 * returned unchanged so the z.boolean() validation rejects garbage with a 422 and an absent
 * optional param stays undefined.
 */
const TO_QUERY_BOOL_HELPER = [
  'function _toQueryBool(v: unknown): unknown {',
  "  return v === 'true' ? true : v === 'false' ? false : v",
  '}',
  '',
]

/** True when any operation declares a scalar (non-array) boolean query param. */
function needsQueryBoolHelper(operations: RouteOperation[]): boolean {
  return operations.some((op) =>
    op.queryParams.some(
      (q) =>
        q.tsType === 'boolean' &&
        q.isArray !== true &&
        q.delimiterStyle === undefined &&
        q.isDeepObject !== true
    )
  )
}

function expressArrayQueryExpr(q: QueryParam): string {
  const base = `_toQueryArray(req.query['${q.rawName}'] as string | string[] | undefined)`
  if (q.itemsTsType === 'number') return `${base}?.map(Number)`
  if (q.itemsTsType === 'boolean') return `${base}?.map((v) => v === 'true')`
  return base
}

/**
 * Emit Zod validation lines for query parameters into the handler line buffer.
 * Uses the already-extracted params object (after Number() coercion).
 * Uses short variable name _qv to keep the 422 return line under Prettier's print width.
 * @param indent - outer handler indent (e.g. '  ')
 */
function emitQueryValidation(lines: string[], queryParams: QueryParam[], indent: string): void {
  const inner = `${indent}  `
  const fieldIndent = `${indent}    `
  const fields = queryParams
    .map((q) => {
      const expr = queryParamZodExpr(q)
      return `${fieldIndent}${q.name}: ${expr}`
    })
    .join(',\n')
  lines.push(`${inner}// Validate query parameters: returns 422 with Zod issues on failure`)
  lines.push(`${inner}const _qv = z.object({`)
  lines.push(fields)
  lines.push(`${inner}}).safeParse(params)`)
}

/**
 * Emit Zod validation lines for path parameters (format constraints) into the handler line buffer.
 * Uses short variable name _pv to keep the 422 return line under Prettier's print width.
 * @param indent - outer handler indent (e.g. '  ')
 * @param framework - used to generate the correct param accessor syntax
 */
function emitPathValidation(
  lines: string[],
  validations: PathParamValidation[],
  indent: string,
  framework: 'hono' | 'express' | 'fastify'
): void {
  const inner = `${indent}  `
  const fieldIndent = `${indent}    `
  const schemaFields = validations
    .map((v) => {
      const key = /[^a-zA-Z0-9_$]/.test(v.rawName) ? JSON.stringify(v.rawName) : v.rawName
      return `${fieldIndent}${key}: ${v.zodExpr}`
    })
    .join(',\n')
  const rawFields = validations
    .map((v) => {
      const key = /[^a-zA-Z0-9_$]/.test(v.rawName) ? JSON.stringify(v.rawName) : v.rawName
      let access: string
      if (framework === 'hono') {
        access = `c.req.param(${JSON.stringify(v.rawName)})`
      } else if (framework === 'express') {
        // Cast to string: Express 5 types req.params values as string | string[],
        // but path params are always single strings in practice.
        access = `req.params[${JSON.stringify(v.rawName)}] as string`
      } else {
        access = /[^a-zA-Z0-9_$]/.test(v.rawName)
          ? `req.params[${JSON.stringify(v.rawName)}]`
          : `req.params.${v.rawName}`
      }
      return `${fieldIndent}${key}: ${access}`
    })
    .join(',\n')
  lines.push(`${inner}// Validate path parameters: returns 422 with Zod issues on failure`)
  lines.push(`${inner}const _pv = z.object({`)
  lines.push(schemaFields)
  lines.push(`${inner}}).safeParse({`)
  lines.push(rawFields)
  lines.push(`${inner}})`)
}

/**
 * Emit Zod validation lines for header parameters into the handler line buffer.
 * Uses short variable name _hv to keep the 422 return line under Prettier's print width.
 * @param indent - outer handler indent (e.g. '  ')
 * @param framework - used to generate the correct header accessor syntax
 */
function emitHeaderValidation(
  lines: string[],
  headerParams: HeaderParam[],
  indent: string,
  framework: 'hono' | 'express' | 'fastify'
): void {
  const inner = `${indent}  `
  const fieldIndent = `${indent}    `
  const schemaFields = headerParams
    .map((h) => {
      const key = JSON.stringify(h.rawName)
      const expr = headerParamZodExpr(h)
      return `${fieldIndent}${key}: ${expr}`
    })
    .join(',\n')
  const rawFields = headerParams
    .map((h) => {
      const key = JSON.stringify(h.rawName)
      const lookupKey = JSON.stringify(h.rawName.toLowerCase())
      let access: string
      if (framework === 'hono') {
        access = `c.req.header(${key})`
      } else if (framework === 'express') {
        access = `req.headers[${lookupKey}] as string | undefined`
      } else {
        access = `req.headers[${lookupKey}]`
      }
      return `${fieldIndent}${key}: ${access}`
    })
    .join(',\n')
  lines.push(`${inner}// Validate request headers: returns 422 with Zod issues on failure`)
  lines.push(`${inner}const _hv = z.object({`)
  lines.push(schemaFields)
  lines.push(`${inner}}).safeParse({`)
  lines.push(rawFields)
  lines.push(`${inner}})`)
}

/**
 * Emit Zod validation lines for cookie parameters into the handler line buffer.
 * Cookie names are case-sensitive: the exact name is used for both the Zod field key and
 * the value lookup (unlike headers, which are lowercased for lookup on Express/Fastify).
 *
 * Required plugins per framework:
 *   Fastify: register @fastify/cookie before creating the router.
 *   Express: apply cookie-parser middleware before mounting this router.
 *   Hono:    getCookie is imported from 'hono/cookie' (added to generated output automatically).
 *
 * Uses short variable name _ckv to keep the 422 return line under Prettier's print width.
 * @param indent - outer handler indent (e.g. '  ')
 * @param framework - used to generate the correct cookie accessor syntax
 */
function emitCookieValidation(
  lines: string[],
  cookieParams: CookieParam[],
  indent: string,
  framework: 'hono' | 'express' | 'fastify'
): void {
  const inner = `${indent}  `
  const fieldIndent = `${indent}    `
  const schemaFields = cookieParams
    .map((ck) => {
      const key = JSON.stringify(ck.rawName)
      const expr = cookieParamZodExpr(ck)
      return `${fieldIndent}${key}: ${expr}`
    })
    .join(',\n')
  const rawFields = cookieParams
    .map((ck) => {
      const key = JSON.stringify(ck.rawName)
      let access: string
      if (framework === 'hono') {
        // getCookie is imported from 'hono/cookie' when cookie params are present.
        access = `getCookie(c, ${key})`
      } else if (framework === 'express') {
        // Requires cookie-parser middleware: req.cookies['name']
        access = `req.cookies[${key}] as string | undefined`
      } else {
        // Requires @fastify/cookie plugin: req.cookies['name']
        access = `req.cookies[${key}]`
      }
      return `${fieldIndent}${key}: ${access}`
    })
    .join(',\n')
  lines.push(`${inner}// Validate request cookies: returns 422 with Zod issues on failure`)
  lines.push(`${inner}const _ckv = z.object({`)
  lines.push(schemaFields)
  lines.push(`${inner}}).safeParse({`)
  lines.push(rawFields)
  lines.push(`${inner}})`)
}

/**
 * Resolve the response type name and shape for Fastify schema.response wiring.
 * Returns the PascalCase type name of the first JSON 2xx response if it is a
 * direct $ref or an array-of-$ref. Returns undefined for inline schemas, void,
 * text/plain, or octet-stream responses.
 *
 * Priority order mirrors service.ts getReturnInfo: 200, 201, then other 2xx codes.
 */
// fallow-ignore-next-line complexity
function getResponseTypeName(
  operation: OperationObject
): { typeName: string; isArray: boolean } | undefined {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined
  if (responses === undefined) return undefined

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
      return { typeName: refToName((schema as ReferenceObject).$ref), isArray: false }
    }
    const s = schema as OpenAPIV3_1.SchemaObject
    if (s.type === 'array' && s.items !== undefined && isRef(s.items)) {
      return {
        typeName: refToName((s.items as ReferenceObject).$ref),
        isArray: true,
      }
    }
  }

  return undefined
}

interface RouteOperation {
  methodName: string
  httpMethod: SupportedMethod
  path: string
  honoPath: string
  pathParams: string[]
  pathParamValidations: PathParamValidation[]
  queryParams: QueryParam[]
  headerParams: HeaderParam[]
  cookieParams: CookieParam[]
  bodyInfo: BodyInfo | undefined
  responseStatus: ResponseStatus
  /**
   * The PascalCase type name of the primary JSON response schema, if it is a
   * direct component $ref (e.g. 'Pet' for schema: { $ref: '#/components/schemas/Pet' }).
   * Undefined for inline schemas, void responses, text/plain, or octet-stream.
   * Used by the Fastify generator to wire schema.response validation.
   */
  responseTypeName?: string
  /**
   * True when the primary JSON response is an array whose items are a component $ref.
   * In this case responseTypeName holds the items type name, not the array wrapper.
   */
  responseIsArray?: boolean
  /** Primary 2xx application/json response schema (may be a $ref); used by emit_response_validation. */
  primaryResponseSchema?: OpenAPIV3_1.SchemaObject | ReferenceObject
}

function collectOperations(spec: OpenAPIV3_1.Document): RouteOperation[] {
  const writableVariantMap = buildWritableVariantMap(spec)
  // fallow-ignore-next-line code-duplication
  const operations: RouteOperation[] = []

  for (const [path, pathItem] of objectPathItemEntries(spec)) {
    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method] as OperationObject | undefined
      if (operation === undefined) continue

      const methodName = deriveMethodName(operation.operationId, method, path)
      const pathParams = extractPathParamsFromPath(path)
      const pathParamValidations = getPathParamValidations(operation, spec, pathParams)
      const queryParams = getQueryParams(operation, spec)
      const headerParams = getHeaderParams(operation, spec)
      const cookieParams = getCookieParams(operation, spec)
      const bodyInfo = getBodyInfo(operation, writableVariantMap)
      const responseStatus = getResponseStatus(operation, method)
      const responseTypeInfo = getResponseTypeName(operation)

      operations.push({
        methodName,
        httpMethod: method,
        path,
        honoPath: toHonoPath(path),
        pathParams,
        pathParamValidations,
        queryParams,
        headerParams,
        cookieParams,
        bodyInfo,
        responseStatus,
        responseTypeName: responseTypeInfo?.typeName,
        responseIsArray: responseTypeInfo?.isArray,
        primaryResponseSchema: findPrimaryJsonResponseSchema(operation),
      })
    }
  }

  return operations
}

// ── Response validation (emit_response_validation) ───────────────────────────

/**
 * Zod expression the Hono/Express router validates a JSON service result against when
 * emit_response_validation is on, mirroring the Fastify schema.response semantics:
 *
 * 1. A named schema from input_schema for a $ref / array-of-$ref response (`PetSchema`,
 *    `z.array(PetSchema)`).
 * 2. Otherwise an inline response schema synthesized by the shared synthesizer.
 * 3. Otherwise (a $ref with no named schema, or a shape the synthesizer cannot express)
 *    undefined: Fastify would attach z.unknown(), which accepts anything, so no check is
 *    emitted at all.
 *
 * Only plain JSON responses are validated: void, multi-status envelopes, text/plain and
 * application/octet-stream responses are skipped (as on Fastify).
 */
function responseValidationExpr(
  op: RouteOperation,
  schemaNames: Set<string> | undefined,
  emitResponseValidation: boolean | undefined
): string | undefined {
  if (emitResponseValidation !== true || !isPlainJsonResponse(op.responseStatus)) return undefined
  if (op.responseTypeName !== undefined && schemaNames?.has(`${op.responseTypeName}Schema`)) {
    const name = `${op.responseTypeName}Schema`
    return op.responseIsArray === true ? `z.array(${name})` : name
  }
  if (op.primaryResponseSchema === undefined || isRef(op.primaryResponseSchema)) return undefined
  const expr = synthesizeResponseSchemaExpr(op.primaryResponseSchema)
  return expr === 'z.unknown()' ? undefined : expr
}

/** True for a single-status JSON response body (not void, multi-status, text or binary). */
function isPlainJsonResponse(rs: ResponseStatus): boolean {
  if (rs.isVoid || rs.isMultiStatus === true) return false
  return (
    rs.responseContentType !== 'text/plain' && rs.responseContentType !== 'application/octet-stream'
  )
}

/** Push the `z` import and the input_schema import (aliased for spec_prefix) when needed. */
function pushZodAndSchemaImports(
  lines: string[],
  needsZod: boolean,
  importSchemaNames: Set<string>,
  options: RouterOptions | undefined
): void {
  if (needsZod) {
    lines.push(`import { z } from 'zod'`)
  }
  if (importSchemaNames.size > 0 && options?.schemaImportPath !== undefined) {
    const specifiers = formatSchemaImportSpecifiers(importSchemaNames, options.schemaImportAliases)
    lines.push(`import { ${specifiers} } from '${options.schemaImportPath}'`)
  }
}

/** Response schema names actually referenced by the response-validation blocks. */
function collectResponseValidationSchemaNames(
  operations: RouteOperation[],
  options: RouterOptions | undefined
): Set<string> {
  const used = new Set<string>()
  if (options?.emitResponseValidation !== true || options.schemaNames === undefined) return used
  for (const op of operations) {
    const expr = responseValidationExpr(op, options.schemaNames, true)
    if (expr !== undefined && op.responseTypeName !== undefined) {
      const name = `${op.responseTypeName}Schema`
      if (options.schemaNames.has(name)) used.add(name)
    }
  }
  return used
}

// ── Shared options interface ──────────────────────────────────────────────────

interface RouterOptions {
  schemaNames?: Set<string>
  schemaImportPath?: string
  /**
   * Bare schema name -> actual exported name, for spec_prefix (#334). Prefixed exports are
   * imported under their bare name (`PublicApiGetUserSchema as GetUserSchema`).
   */
  schemaImportAliases?: Map<string, string>
  /**
   * Shape of router-produced error responses. 'problem+json' emits RFC 9457 / RFC 7807
   * `application/problem+json` bodies; 'default' (or unset) keeps `{ error, issues? }`.
   */
  errorFormat?: ErrorFormat
  /**
   * When true, safeParse each JSON service result against its response schema before sending
   * (a named schema from input_schema, else a synthesized inline schema). On failure the
   * router responds 500 without the result. Same fallback semantics as the Fastify emitter.
   */
  emitResponseValidation?: boolean
  /**
   * When set, matches the `contextType` from ServiceOptions. The generated router
   * handlers extract a context value from the framework's native channel and pass
   * it as the final argument to every service call.
   *
   * Framework channels used:
   *   Hono:    `c` (the Hono Context object)
   *   Express: `req` (the Express Request object)
   *   Fastify: `req` (the Fastify Request object)
   *
   * Must match the value set in ServiceOptions so service call signatures align.
   */
  contextType?: string
  /**
   * Relative import path (from the generated router.ts) to the shared `_shared/errors.js`
   * module. Defaults to `./_shared/errors.js` when not provided.
   * The generator always passes the correct path based on the shared dir derivation logic.
   */
  errorsImportPath?: string
}

interface GeneratorSetup {
  sortedBodyTypes: string[]
  usedSchemaNames: Set<string>
  usedResponseSchemaNames: Set<string>
  /** Schema names to import from input_schema: body schemas + response-validation schemas. */
  importSchemaNames: Set<string>
  needsZod: boolean
}

/** Collect the subset of schemaNames actually used by the given operations. */
function collectUsedSchemaNames(
  operations: RouteOperation[],
  schemaNames: Set<string>
): Set<string> {
  const used = new Set<string>()
  for (const op of operations) {
    // multipart/form-data and application/octet-stream bodies are never validated against a
    // JSON schema. A same-named schema may exist for the operation's response (C1 naming);
    // excluding these content types prevents that schema from being imported as a body schema.
    const isNonJsonBody =
      op.bodyInfo?.contentType === 'multipart/form-data' ||
      op.bodyInfo?.contentType === 'application/octet-stream'
    if (isNonJsonBody) continue
    const typeName = op.bodyInfo?.typeName
    if (typeName === undefined) continue
    const schemaName = `${typeName}Schema`
    if (schemaNames.has(schemaName)) used.add(schemaName)
  }
  return used
}

/**
 * Collect body type names, used schema names, and whether Zod is needed.
 * Shared by all three generator functions to avoid duplication.
 */
// fallow-ignore-next-line complexity
function collectGeneratorSetup(
  operations: RouteOperation[],
  options?: RouterOptions
): GeneratorSetup {
  const sortedBodyTypes = collectSortedBodyTypes(operations)
  const usedSchemaNames =
    options?.schemaNames !== undefined
      ? collectUsedSchemaNames(operations, options.schemaNames)
      : new Set<string>()
  const usedResponseSchemaNames =
    options?.schemaNames !== undefined
      ? collectUsedResponseSchemaNames(operations, options.schemaNames)
      : new Set<string>()
  // Zod is needed for param validation, body schema validation, or array response schemas.
  // Array response schemas emit z.array(XSchema) which requires the z import.
  const hasArrayResponseSchema =
    usedResponseSchemaNames.size > 0 &&
    operations.some(
      (op) =>
        op.responseIsArray === true &&
        op.responseTypeName !== undefined &&
        usedResponseSchemaNames.has(`${op.responseTypeName}Schema`)
    )
  // emit_response_validation: z.array(...) wrappers and synthesized inline schemas need z;
  // a bare named schema (PetSchema.safeParse) does not.
  const responseValidationNeedsZod = operations.some((op) =>
    responseValidationExpr(op, options?.schemaNames, options?.emitResponseValidation)?.startsWith(
      'z.'
    )
  )
  const needsZod =
    (usedSchemaNames.size > 0 && options?.schemaImportPath !== undefined) ||
    operationsNeedZodForParams(operations) ||
    (usedResponseSchemaNames.size > 0 &&
      options?.schemaImportPath !== undefined &&
      hasArrayResponseSchema) ||
    responseValidationNeedsZod
  const importSchemaNames = new Set([
    ...usedSchemaNames,
    ...collectResponseValidationSchemaNames(operations, options),
  ])
  return { sortedBodyTypes, usedSchemaNames, usedResponseSchemaNames, importSchemaNames, needsZod }
}

// ── Hono route handler ────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function buildRouteHandler(
  op: RouteOperation,
  indent: string,
  schemaNames?: Set<string>,
  contextType?: string,
  errorFormat?: ErrorFormat,
  emitResponseValidation?: boolean
): string {
  const lines: string[] = []
  lines.push(`${indent}app.${op.httpMethod}(${JSON.stringify(op.honoPath)}, async (c) => {`)

  // Path param format validation (e.g. uuid)
  if (op.pathParamValidations.length > 0) {
    emitPathValidation(lines, op.pathParamValidations, indent, 'hono')
    lines.push(`${indent}  if (!_pv.success) {`)
    lines.push(
      `${indent}    ${honoErrorReturn(422, 'Invalid path parameters', '_pv.error.issues', errorFormat)}`
    )
    lines.push(`${indent}  }`)
  }

  // Query params extraction
  if (op.queryParams.length > 0) {
    // Emit deepObject assembly blocks before the params object.
    // c.req.queries() returns Record<string, string[]> with raw bracket-notation keys.
    const deepObjectParams = op.queryParams.filter((q) => q.isDeepObject === true)
    if (deepObjectParams.length > 0) {
      lines.push(`${indent}  const _dq = c.req.queries()`)
      for (const q of deepObjectParams) {
        const prefixLen = q.rawName.length + 1 // e.g. 'filter['.length
        const bracketPrefix = q.rawName + '['
        lines.push(`${indent}  const ${q.name} = Object.fromEntries(`)
        lines.push(
          `${indent}    Object.entries(_dq).filter(([k]) => k.startsWith('${bracketPrefix}') && k.endsWith(']')).map(([k, vs]) => [k.slice(${prefixLen}, -1), vs[0]])`
        )
        lines.push(`${indent}  )`)
      }
    }

    const fields = op.queryParams
      .map((q) => {
        if (q.isDeepObject === true) {
          // Already assembled above as a local variable
          return `    ${q.name}`
        }
        if (q.delimiterStyle !== undefined) {
          // Use rawName to match the actual URL query key (e.g. 'csv', 'ssv', 'psv').
          const delim = JSON.stringify(delimiterChar(q.delimiterStyle))
          return `    ${q.name}: c.req.query('${q.rawName}') !== undefined ? c.req.query('${q.rawName}')!.split(${delim}) : undefined`
        }
        if (q.isArray === true) {
          return `    ${q.name}: ${honoArrayQueryExpr(q)}`
        }
        if (q.tsType === 'number') {
          return `    ${q.name}: c.req.query('${q.rawName}') !== undefined ? Number(c.req.query('${q.rawName}')) : undefined`
        }
        if (q.tsType === 'boolean') {
          // 'true'/'false' become booleans; anything else is passed through unchanged so the
          // z.boolean() validation below still rejects it with 422 (absent stays undefined).
          return `    ${q.name}: _toQueryBool(c.req.query('${q.rawName}'))`
        }
        return `    ${q.name}: c.req.query('${q.rawName}') ?? undefined`
      })
      .join(',\n')
    lines.push(`${indent}  const params = {`)
    lines.push(fields)
    lines.push(`${indent}  }`)

    // Validate query params when there are required or typed (non-string) params
    if (queryParamsNeedValidation(op.queryParams)) {
      emitQueryValidation(lines, op.queryParams, indent)
      lines.push(`${indent}  if (!_qv.success) {`)
      lines.push(
        `${indent}    ${honoErrorReturn(422, 'Invalid query parameters', '_qv.error.issues', errorFormat)}`
      )
      lines.push(`${indent}  }`)
    }
  }

  // Header param validation
  if (op.headerParams.length > 0) {
    emitHeaderValidation(lines, op.headerParams, indent, 'hono')
    lines.push(`${indent}  if (!_hv.success) {`)
    lines.push(
      `${indent}    ${honoErrorReturn(422, 'Invalid request headers', '_hv.error.issues', errorFormat)}`
    )
    lines.push(`${indent}  }`)
  }

  // Cookie param validation
  // Requires @fastify/cookie on Fastify, cookie-parser on Express, getCookie from hono/cookie on Hono.
  if (op.cookieParams.length > 0) {
    emitCookieValidation(lines, op.cookieParams, indent, 'hono')
    lines.push(`${indent}  if (!_ckv.success) {`)
    lines.push(
      `${indent}    ${honoErrorReturn(422, 'Invalid request cookies', '_ckv.error.issues', errorFormat)}`
    )
    lines.push(`${indent}  }`)
  }

  // Body extraction
  let bodyVarName = 'body'
  if (op.bodyInfo !== undefined) {
    // Synthesized names (inline schemas) are schema-only; the TS type is unknown.
    // A request body uses the XWritable variant when the schema has readOnly/writeOnly props
    // (direct or transitive); the validation schema name below stays ${typeName}Schema.
    const typeDecl =
      op.bodyInfo.typeName !== undefined && !op.bodyInfo.isSynthesized
        ? (op.bodyInfo.writableTypeName ?? op.bodyInfo.typeName)
        : 'unknown'

    if (op.bodyInfo.contentType === 'application/x-www-form-urlencoded') {
      // Form-urlencoded: check Content-Type then decode with parseBody().
      // Values arrive as strings; Zod coercion handles type conversion (e.g. z.coerce.number()).
      lines.push(`${indent}  const _ct = c.req.header('content-type') ?? ''`)
      lines.push(
        `${indent}  if (!_ct.toLowerCase().startsWith('application/x-www-form-urlencoded')) {`
      )
      lines.push(
        `${indent}    ${honoErrorReturn(415, 'Unsupported Media Type', undefined, errorFormat)}`
      )
      lines.push(`${indent}  }`)
      lines.push(`${indent}  const body: unknown = await c.req.parseBody()`)
    } else if (op.bodyInfo.contentType === 'multipart/form-data') {
      // Multipart: decode with parseBody({ all: true }) so repeated file fields arrive as arrays.
      // File fields are web-standard File objects; text fields are strings.
      // No manual Content-Type check needed: parseBody handles multipart natively in Hono.
      lines.push(
        `${indent}  // multipart/form-data: parseBody({ all: true }) collects repeated keys into arrays.`
      )
      lines.push(`${indent}  const body: unknown = await c.req.parseBody({ all: true })`)
    } else {
      // JSON body: check Content-Type then parse with JSON.parse (not c.req.json()).
      // c.req.text() + JSON.parse() is used instead of c.req.json() because Hono's
      // c.req.json() silently returns null for an empty body instead of throwing,
      // which would pass the try/catch and reach Zod as null, causing a 422 rather
      // than the correct 400. JSON.parse('') always throws SyntaxError.
      lines.push(`${indent}  const _ct = c.req.header('content-type') ?? ''`)
      lines.push(`${indent}  if (!_ct.toLowerCase().startsWith('application/json')) {`)
      lines.push(
        `${indent}    ${honoErrorReturn(415, 'Unsupported Media Type', undefined, errorFormat)}`
      )
      lines.push(`${indent}  }`)
      lines.push(`${indent}  let body: ${typeDecl}`)
      lines.push(`${indent}  try {`)
      lines.push(`${indent}    body = JSON.parse(await c.req.text()) as ${typeDecl}`)
      lines.push(`${indent}  } catch {`)
      lines.push(
        `${indent}    ${honoErrorReturn(400, 'Invalid JSON body', undefined, errorFormat)}`
      )
      lines.push(`${indent}  }`)
    }

    // Zod validation when schema is available.
    // multipart/form-data and application/octet-stream are never validated against a JSON schema:
    // they carry binary/mixed payloads that no Zod schema can describe at the body level.
    const isNonJsonBody =
      op.bodyInfo.contentType === 'multipart/form-data' ||
      op.bodyInfo.contentType === 'application/octet-stream'
    const schemaName =
      !isNonJsonBody && op.bodyInfo.typeName !== undefined
        ? `${op.bodyInfo.typeName}Schema`
        : undefined
    if (schemaName !== undefined && schemaNames !== undefined && schemaNames.has(schemaName)) {
      lines.push(`${indent}  // Validate request body: returns 422 with Zod issues on failure`)
      lines.push(`${indent}  const parseResult = ${schemaName}.safeParse(body)`)
      lines.push(`${indent}  if (!parseResult.success) {`)
      lines.push(
        `${indent}    ${honoErrorReturn(422, 'Invalid request body', 'parseResult.error.issues', errorFormat)}`
      )
      lines.push(`${indent}  }`)
      // Forward the validated/coerced data (parseResult.data), NOT the raw parsed body,
      // so Zod coercion is preserved (e.g. form-urlencoded numeric fields via
      // z.coerce.number()). Cast to the declared model type so the service-call type
      // stays correct even when the schema infers a narrower shape (e.g. z.unknown()
      // for inline-union properties); safeParse above guarantees runtime safety.
      lines.push(`${indent}  const validatedBody = parseResult.data as ${typeDecl}`)
      bodyVarName = 'validatedBody'
    }
  }

  // Build service call args
  const serviceArgs: string[] = []
  for (const p of op.pathParams) {
    serviceArgs.push(`c.req.param(${JSON.stringify(p)})`)
  }
  if (op.bodyInfo !== undefined) {
    serviceArgs.push(bodyVarName)
  }
  if (op.queryParams.length > 0) {
    // After successful Zod validation _qv.data carries the correct required/typed
    // values (e.g. string[] for delimited arrays, object shape for deepObject params,
    // and non-optional values for required scalar params). Use _qv.data when validation
    // was applied; fall back to params when no validation is needed.
    serviceArgs.push(queryParamsNeedValidation(op.queryParams) ? '_qv.data' : 'params')
  }
  // Context arg: pass the Hono Context object (c) as the final argument when contextType is set.
  if (contextType !== undefined) {
    serviceArgs.push('c')
  }

  const serviceCall = `service.${op.methodName}(${serviceArgs.join(', ')})`

  // Response — wrap in try/catch to map HttpError to its status
  lines.push(`${indent}  try {`)
  if (op.responseStatus.isVoid) {
    lines.push(`${indent}    await ${serviceCall}`)
    lines.push(`${indent}    return new Response(null, { status: ${op.responseStatus.status} })`)
  } else if (op.responseStatus.isMultiStatus === true) {
    // Multi-status: service returns { status: number; body: T }; router forwards both.
    lines.push(`${indent}    const _envelope = await ${serviceCall}`)
    lines.push(`${indent}    return c.json(_envelope.body, _envelope.status as any)`)
  } else if (op.responseStatus.responseContentType === 'text/plain') {
    if (op.responseStatus.status === 200) {
      lines.push(`${indent}    return c.text(await ${serviceCall})`)
    } else {
      lines.push(`${indent}    return c.text(await ${serviceCall}, ${op.responseStatus.status})`)
    }
  } else if (op.responseStatus.responseContentType === 'application/octet-stream') {
    if (op.responseStatus.status === 200) {
      lines.push(`${indent}    const _result = await ${serviceCall}`)
      lines.push(
        `${indent}    return new Response(_result as BodyInit, { headers: { 'content-type': 'application/octet-stream' } })`
      )
    } else {
      lines.push(`${indent}    const _result = await ${serviceCall}`)
      lines.push(
        `${indent}    return new Response(_result as BodyInit, { status: ${op.responseStatus.status}, headers: { 'content-type': 'application/octet-stream' } })`
      )
    }
  } else if (responseValidationExpr(op, schemaNames, emitResponseValidation) !== undefined) {
    // emit_response_validation: send only a result that matches the response schema
    // (parsed data, so undeclared keys are stripped); otherwise 500 without the result.
    const rvExpr = responseValidationExpr(op, schemaNames, emitResponseValidation)!
    const statusArg = op.responseStatus.status === 200 ? '' : `, ${op.responseStatus.status}`
    lines.push(`${indent}    const _rv = ${rvExpr}.safeParse(await ${serviceCall})`)
    lines.push(`${indent}    if (!_rv.success) {`)
    lines.push(
      `${indent}      ${honoErrorReturn(500, 'Response validation failed', undefined, errorFormat)}`
    )
    lines.push(`${indent}    }`)
    lines.push(`${indent}    return c.json(_rv.data${statusArg})`)
  } else if (op.responseStatus.status === 200) {
    lines.push(`${indent}    return c.json(await ${serviceCall})`)
  } else {
    lines.push(`${indent}    return c.json(await ${serviceCall}, ${op.responseStatus.status})`)
  }
  lines.push(`${indent}  } catch (err) {`)
  lines.push(`${indent}    if (err instanceof HttpError) {`)
  lines.push(`${indent}      ${honoHttpErrorReturn(errorFormat)}`)
  lines.push(`${indent}    }`)
  lines.push(`${indent}    throw err`)
  lines.push(`${indent}  }`)

  lines.push(`${indent}})`)
  return lines.join('\n')
}

// ── Express route handler ─────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function buildExpressRouteHandler(
  op: RouteOperation,
  indent: string,
  schemaNames?: Set<string>,
  contextType?: string,
  errorFormat?: ErrorFormat,
  emitResponseValidation?: boolean
): string {
  const lines: string[] = []
  lines.push(
    `${indent}router.${op.httpMethod}(${JSON.stringify(op.honoPath)}, async (req: Request, res: Response) => {`
  )

  // Path param format validation (e.g. uuid)
  if (op.pathParamValidations.length > 0) {
    emitPathValidation(lines, op.pathParamValidations, indent, 'express')
    lines.push(`${indent}  if (!_pv.success) {`)
    lines.push(
      `${indent}    ${expressErrorReturn(422, 'Invalid path parameters', '_pv.error.issues', errorFormat)}`
    )
    lines.push(`${indent}  }`)
  }

  // Query params extraction
  if (op.queryParams.length > 0) {
    // Express (qs, extended:true) parses bracket-notation automatically:
    // filter[gte]=10 → req.query.filter = { gte: '10' }.
    // DeepObject params are already assembled; just cast the nested object.
    const fields = op.queryParams
      .map((q) => {
        if (q.isDeepObject === true) {
          // Express with qs: req.query['filter'] is already { gte: '10', lte: '20' }
          return `    ${q.name}: (req.query['${q.rawName}'] ?? {}) as Record<string, string | undefined>`
        }
        if (q.delimiterStyle !== undefined) {
          const delim = JSON.stringify(delimiterChar(q.delimiterStyle))
          return `    ${q.name}: typeof req.query['${q.rawName}'] === 'string' ? (req.query['${q.rawName}'] as string).split(${delim}) : undefined`
        }
        if (q.isArray === true) {
          return `    ${q.name}: ${expressArrayQueryExpr(q)}`
        }
        if (q.tsType === 'number') {
          // Guard undefined so an absent optional param stays undefined instead of NaN (→ 422).
          return `    ${q.name}: req.query['${q.rawName}'] !== undefined ? Number(req.query['${q.rawName}'] as string) : undefined`
        }
        if (q.tsType === 'boolean') {
          // Absent stays undefined; values other than 'true'/'false' still fail z.boolean().
          return `    ${q.name}: _toQueryBool(req.query['${q.rawName}'])`
        }
        return `    ${q.name}: req.query['${q.rawName}'] as string | undefined`
      })
      .join(',\n')
    lines.push(`${indent}  const params = {`)
    lines.push(fields)
    lines.push(`${indent}  }`)

    // Validate query params when there are required or typed (non-string) params
    if (queryParamsNeedValidation(op.queryParams)) {
      emitQueryValidation(lines, op.queryParams, indent)
      lines.push(`${indent}  if (!_qv.success) {`)
      lines.push(
        `${indent}    ${expressErrorReturn(422, 'Invalid query parameters', '_qv.error.issues', errorFormat)}`
      )
      lines.push(`${indent}  }`)
    }
  }

  // Header param validation
  if (op.headerParams.length > 0) {
    emitHeaderValidation(lines, op.headerParams, indent, 'express')
    lines.push(`${indent}  if (!_hv.success) {`)
    lines.push(
      `${indent}    ${expressErrorReturn(422, 'Invalid request headers', '_hv.error.issues', errorFormat)}`
    )
    lines.push(`${indent}  }`)
  }

  // Cookie param validation
  // Requires cookie-parser middleware: app.use(cookieParser()) before mounting this router.
  if (op.cookieParams.length > 0) {
    emitCookieValidation(lines, op.cookieParams, indent, 'express')
    lines.push(`${indent}  if (!_ckv.success) {`)
    lines.push(
      `${indent}    ${expressErrorReturn(422, 'Invalid request cookies', '_ckv.error.issues', errorFormat)}`
    )
    lines.push(`${indent}  }`)
  }

  // Body extraction, with optional Zod validation.
  // For both JSON and form-urlencoded bodies Express pre-populates req.body via middleware
  // (express.json() for JSON, express.urlencoded() for form). The router just reads req.body.
  // For multipart/form-data: assumes multer (or equivalent) middleware is applied before this
  // router, populating req.files and req.body with the parsed multipart fields.
  let bodyVarName = 'body'
  if (op.bodyInfo !== undefined) {
    if (op.bodyInfo.contentType === 'multipart/form-data') {
      // Multipart assumption: multer middleware populates req.files (file fields) and
      // req.body (text fields) before this handler runs. Merge them for service consumption.
      lines.push(
        `${indent}  // multipart/form-data: assumes multer middleware has populated req.files + req.body.`
      )
      lines.push(`${indent}  const body = { ...req.body, ...(req as any).files } as unknown`)
    } else {
      const schemaName =
        op.bodyInfo.typeName !== undefined ? `${op.bodyInfo.typeName}Schema` : undefined
      const useZod =
        schemaName !== undefined && schemaNames !== undefined && schemaNames.has(schemaName)

      if (useZod) {
        lines.push(`${indent}  // Validate request body: returns 422 with Zod issues on failure`)
        lines.push(`${indent}  const parseResult = ${schemaName}.safeParse(req.body)`)
        lines.push(`${indent}  if (!parseResult.success) {`)
        lines.push(
          `${indent}    ${expressErrorReturn(422, 'Invalid request body', 'parseResult.error.issues', errorFormat)}`
        )
        lines.push(`${indent}  }`)
        // Cast parseResult.data to the declared model type so the service call receives
        // the correct TypeScript type even when the Zod schema infers a narrower or
        // different shape (e.g. z.unknown() for inline-union properties). The cast is
        // safe because safeParse already confirmed the value is structurally valid.
        const typeDecl =
          op.bodyInfo.typeName !== undefined && !op.bodyInfo.isSynthesized
            ? (op.bodyInfo.writableTypeName ?? op.bodyInfo.typeName)
            : 'unknown'
        lines.push(`${indent}  const validatedBody = parseResult.data as ${typeDecl}`)
        bodyVarName = 'validatedBody'
      } else {
        // Synthesized names (inline schemas) have no model type — use plain cast to unknown.
        const typeAnnotation =
          op.bodyInfo.typeName !== undefined && !op.bodyInfo.isSynthesized
            ? ` as ${op.bodyInfo.writableTypeName ?? op.bodyInfo.typeName}`
            : ''
        lines.push(`${indent}  const body = req.body${typeAnnotation}`)
      }
    }
  }

  // Build service call args
  const serviceArgs: string[] = []
  for (const p of op.pathParams) {
    // Cast to string: Express 5 types req.params values as string | string[],
    // but path params are always single strings in practice.
    serviceArgs.push(`(req.params['${p}'] as string)`)
  }
  if (op.bodyInfo !== undefined) {
    serviceArgs.push(bodyVarName)
  }
  if (op.queryParams.length > 0) {
    // After successful Zod validation _qv.data carries the correct required/typed
    // values (e.g. string[] for delimited arrays, object shape for deepObject params,
    // and non-optional values for required scalar params). Use _qv.data when validation
    // was applied; fall back to params when no validation is needed.
    serviceArgs.push(queryParamsNeedValidation(op.queryParams) ? '_qv.data' : 'params')
  }
  // Context arg: pass the Express Request object (req) as the final argument when contextType is set.
  if (contextType !== undefined) {
    serviceArgs.push('req')
  }

  const serviceCall = `service.${op.methodName}(${serviceArgs.join(', ')})`

  // Response — wrap in try/catch to map HttpError to its status
  lines.push(`${indent}  try {`)
  if (op.responseStatus.isVoid) {
    lines.push(`${indent}    await ${serviceCall}`)
    lines.push(`${indent}    res.status(${op.responseStatus.status}).end()`)
  } else if (op.responseStatus.isMultiStatus === true) {
    // Multi-status: service returns { status: number; body: T }; router forwards both.
    lines.push(`${indent}    const _envelope = await ${serviceCall}`)
    lines.push(`${indent}    res.status(_envelope.status).json(_envelope.body)`)
  } else if (op.responseStatus.responseContentType === 'text/plain') {
    if (op.responseStatus.status === 200) {
      lines.push(`${indent}    res.type('text/plain').send(await ${serviceCall})`)
    } else {
      lines.push(
        `${indent}    res.status(${op.responseStatus.status}).type('text/plain').send(await ${serviceCall})`
      )
    }
  } else if (op.responseStatus.responseContentType === 'application/octet-stream') {
    if (op.responseStatus.status === 200) {
      lines.push(
        `${indent}    res.setHeader('Content-Type', 'application/octet-stream').send(Buffer.from(await ${serviceCall}))`
      )
    } else {
      lines.push(
        `${indent}    res.status(${op.responseStatus.status}).setHeader('Content-Type', 'application/octet-stream').send(Buffer.from(await ${serviceCall}))`
      )
    }
  } else if (responseValidationExpr(op, schemaNames, emitResponseValidation) !== undefined) {
    // emit_response_validation: send only a result that matches the response schema
    // (parsed data, so undeclared keys are stripped); otherwise 500 without the result.
    const rvExpr = responseValidationExpr(op, schemaNames, emitResponseValidation)!
    const statusPrefix =
      op.responseStatus.status === 200 ? 'res' : `res.status(${op.responseStatus.status})`
    lines.push(`${indent}    const _rv = ${rvExpr}.safeParse(await ${serviceCall})`)
    lines.push(`${indent}    if (!_rv.success) {`)
    lines.push(
      `${indent}      ${expressErrorReturn(500, 'Response validation failed', undefined, errorFormat)}`
    )
    lines.push(`${indent}    }`)
    lines.push(`${indent}    ${statusPrefix}.json(_rv.data)`)
  } else if (op.responseStatus.status === 200) {
    lines.push(`${indent}    res.json(await ${serviceCall})`)
  } else {
    lines.push(`${indent}    res.status(${op.responseStatus.status}).json(await ${serviceCall})`)
  }
  lines.push(`${indent}  } catch (err) {`)
  lines.push(`${indent}    if (err instanceof HttpError) {`)
  lines.push(`${indent}      ${expressHttpErrorReturn(errorFormat)}`)
  lines.push(`${indent}    }`)
  lines.push(`${indent}    throw err`)
  lines.push(`${indent}  }`)

  lines.push(`${indent}})`)
  return lines.join('\n')
}

// ── Zod import helpers ────────────────────────────────────────────────────────

/**
 * Returns true when any operation in the list generates param validation code
 * that requires Zod (path format validation, required/typed query params, header params,
 * or cookie params).
 */
function operationsNeedZodForParams(operations: RouteOperation[]): boolean {
  for (const op of operations) {
    if (op.pathParamValidations.length > 0) return true
    if (queryParamsNeedValidation(op.queryParams)) return true
    if (op.headerParams.length > 0) return true
    if (op.cookieParams.length > 0) return true
  }
  return false
}

// ── Express router generator ──────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function generateExpressRouter(
  spec: OpenAPIV3_1.Document,
  options?: RouterOptions
): GeneratedFile {
  const serviceName = deriveServiceName(spec)
  const operations = collectOperations(spec)
  const { sortedBodyTypes, importSchemaNames, needsZod } = collectGeneratorSetup(
    operations,
    options
  )
  // usedResponseSchemaNames is Fastify-only; Express imports response schemas only for the
  // emit_response_validation blocks (see collectResponseValidationSchemaNames).

  const lines: string[] = []
  lines.push('// This file is auto-generated. Do not edit manually.')
  lines.push(
    '// Express: apply express.json() middleware before mounting this router so req.body is populated.'
  )
  lines.push('')
  lines.push("import { Router } from 'express'")
  lines.push("import type { Request, Response } from 'express'")
  if (sortedBodyTypes.length > 0) {
    lines.push(`import type { ${sortedBodyTypes.join(', ')} } from './models.js'`)
  }
  const ctx = options?.contextType
  const serviceRef = ctx !== undefined ? `${serviceName}<${ctx}>` : serviceName
  lines.push(`import type { ${serviceName} } from './service.js'`)
  pushZodAndSchemaImports(lines, needsZod, importSchemaNames, options)
  const expressErrorsPath = options?.errorsImportPath ?? './_shared/errors.js'
  lines.push('')
  lines.push(`import { HttpError } from '${expressErrorsPath}'`)
  lines.push(`export { HttpError } from '${expressErrorsPath}'`)
  lines.push('')

  // Plain repeated-key array query params (explode:true) need this normalizer: qs gives a
  // repeated key (?ids=1&ids=2) as string[], but a single occurrence (?ids=1) as a bare
  // string and an absent key as undefined. Emitted once per file, only when needed.
  const needsArrayQueryHelper = operations.some((op) =>
    op.queryParams.some((q) => q.isArray === true)
  )
  if (needsArrayQueryHelper) {
    lines.push('function _toQueryArray(v: string | string[] | undefined): string[] | undefined {')
    lines.push('  return v === undefined ? undefined : Array.isArray(v) ? v : [v]')
    lines.push('}')
    lines.push('')
  }

  if (needsQueryBoolHelper(operations)) lines.push(...TO_QUERY_BOOL_HELPER)
  if (isProblemJson(options?.errorFormat)) lines.push(...expressProblemHelperLines())
  lines.push(`export function createRouter(service: ${serviceRef}): Router {`)
  lines.push('  const router = Router()')
  lines.push('')

  for (const op of operations) {
    lines.push(
      buildExpressRouteHandler(
        op,
        '  ',
        options?.schemaNames,
        ctx,
        options?.errorFormat,
        options?.emitResponseValidation
      )
    )
    lines.push('')
  }

  lines.push('  return router')
  lines.push('}')
  lines.push('')

  return {
    filename: 'router.ts',
    content: lines.join('\n'),
  }
}

// ── Hono router generator ─────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function generateRouter(spec: OpenAPIV3_1.Document, options?: RouterOptions): GeneratedFile {
  const serviceName = deriveServiceName(spec)
  const operations = collectOperations(spec)
  const { sortedBodyTypes, importSchemaNames, needsZod } = collectGeneratorSetup(
    operations,
    options
  )

  const lines: string[] = []
  lines.push('// This file is auto-generated. Do not edit manually.')
  lines.push('')
  const ctx = options?.contextType
  const serviceRef = ctx !== undefined ? `${serviceName}<${ctx}>` : serviceName
  // getCookie from hono/cookie is needed when any operation declares cookie params.
  const needsGetCookie = operations.some((op) => op.cookieParams.length > 0)
  lines.push("import { Hono } from 'hono'")
  if (needsGetCookie) {
    lines.push("import { getCookie } from 'hono/cookie'")
  }
  if (sortedBodyTypes.length > 0) {
    lines.push(`import type { ${sortedBodyTypes.join(', ')} } from './models.js'`)
  }
  lines.push(`import type { ${serviceName} } from './service.js'`)
  pushZodAndSchemaImports(lines, needsZod, importSchemaNames, options)
  const honoErrorsPath = options?.errorsImportPath ?? './_shared/errors.js'
  lines.push('')
  lines.push(`import { HttpError } from '${honoErrorsPath}'`)
  lines.push(`export { HttpError } from '${honoErrorsPath}'`)
  lines.push('')
  if (needsQueryBoolHelper(operations)) lines.push(...TO_QUERY_BOOL_HELPER)
  if (isProblemJson(options?.errorFormat)) lines.push(...honoProblemHelperLines())
  lines.push(`export function createRouter(service: ${serviceRef}): Hono {`)
  lines.push('  const app = new Hono()')
  lines.push('')

  for (const op of operations) {
    lines.push(
      buildRouteHandler(
        op,
        '  ',
        options?.schemaNames,
        ctx,
        options?.errorFormat,
        options?.emitResponseValidation
      )
    )
    lines.push('')
  }

  lines.push('  return app')
  lines.push('}')
  lines.push('')

  return {
    filename: 'router.ts',
    content: lines.join('\n'),
  }
}
