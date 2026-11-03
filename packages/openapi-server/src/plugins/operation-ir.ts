// Shared operation IR helpers consumed by the framework router emitters (router.ts, fastify-type-provider.ts). Framework-divergent logic stays in each emitter.
import type { OpenAPIV3_1 } from 'openapi-types'
import { type SupportedMethod, isRef, resolveParam, type BodyInfo } from './shared.js'

type OperationObject = OpenAPIV3_1.OperationObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type ParameterObject = OpenAPIV3_1.ParameterObject
type ResponseObject = OpenAPIV3_1.ResponseObject

/** Represents a header parameter to validate. */
export interface HeaderParam {
  /** Header name as defined in the spec (e.g. 'x-api-key'). */
  rawName: string
  /** Whether the header is required. */
  required: boolean
  /** Allowed values from the schema enum constraint. */
  enum?: string[]
  /** Minimum string length from schema.minLength. */
  minLength?: number
  /** Maximum string length from schema.maxLength. */
  maxLength?: number
  /** Regex pattern from schema.pattern. */
  pattern?: string
}

/** Represents a cookie parameter to validate (in: cookie). */
export interface CookieParam {
  /** Cookie name as defined in the spec. Cookie names are case-sensitive. */
  rawName: string
  /** Whether the cookie is required. */
  required: boolean
  /** Allowed values from the schema enum constraint. */
  enum?: string[]
  /** Minimum string length from schema.minLength. */
  minLength?: number
  /** Maximum string length from schema.maxLength. */
  maxLength?: number
  /** Regex pattern from schema.pattern. */
  pattern?: string
}

export interface ResponseStatus {
  status: number
  isVoid: boolean
  /**
   * The content type declared by the success response.
   * Drives the framework-specific response emit (c.json / c.text / c.body).
   * Defaults to 'application/json' for JSON and void responses.
   */
  responseContentType: 'application/json' | 'text/plain' | 'application/octet-stream'
  /**
   * True when the operation declares more than one 2xx success response.
   * The service method returns { status: number; body: T } and the router
   * forwards result.status and result.body verbatim, letting the handler
   * choose the appropriate status code at runtime.
   */
  isMultiStatus?: boolean
}

/**
 * Minimal operation shape required by collectSortedBodyTypes and collectUsedResponseSchemaNames.
 * Both RouteOperation local types in router.ts and fastify-type-provider.ts satisfy this
 * interface structurally.
 */
export interface OperationBase {
  bodyInfo: BodyInfo | undefined
  responseTypeName?: string
  responseStatus: ResponseStatus
}

/**
 * Collect header parameters from an operation, including schema constraints.
 */
// fallow-ignore-next-line complexity
export function getHeaderParams(
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): HeaderParam[] {
  const parameters = operation.parameters as (ParameterObject | ReferenceObject)[] | undefined
  if (parameters === undefined) return []

  const result: HeaderParam[] = []
  for (const p of parameters) {
    const resolved = resolveParam(p, spec)
    if (resolved === undefined || resolved.in !== 'header') continue
    const param: HeaderParam = {
      rawName: resolved.name,
      required: resolved.required === true,
    }
    const schema = resolved.schema as OpenAPIV3_1.SchemaObject | undefined
    if (schema !== undefined && !isRef(schema)) {
      const s = schema as OpenAPIV3_1.SchemaObject
      if (Array.isArray(s.enum)) param.enum = s.enum as string[]
      if (typeof s.minLength === 'number') param.minLength = s.minLength
      if (typeof s.maxLength === 'number') param.maxLength = s.maxLength
      if (typeof s.pattern === 'string') param.pattern = s.pattern
    }
    result.push(param)
  }
  return result
}

/**
 * Collect cookie parameters (in: cookie) from an operation, including schema constraints.
 * Cookie names are case-sensitive and are used as-is for both the Zod field key and value lookup.
 */
// fallow-ignore-next-line complexity
export function getCookieParams(
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): CookieParam[] {
  const parameters = operation.parameters as (ParameterObject | ReferenceObject)[] | undefined
  if (parameters === undefined) return []

  const result: CookieParam[] = []
  for (const p of parameters) {
    const resolved = resolveParam(p, spec)
    if (resolved === undefined || resolved.in !== 'cookie') continue
    const param: CookieParam = {
      rawName: resolved.name,
      required: resolved.required === true,
    }
    const schema = resolved.schema as OpenAPIV3_1.SchemaObject | undefined
    if (schema !== undefined && !isRef(schema)) {
      const s = schema as OpenAPIV3_1.SchemaObject
      if (Array.isArray(s.enum)) param.enum = s.enum as string[]
      if (typeof s.minLength === 'number') param.minLength = s.minLength
      if (typeof s.maxLength === 'number') param.maxLength = s.maxLength
      if (typeof s.pattern === 'string') param.pattern = s.pattern
    }
    result.push(param)
  }
  return result
}

function response200IsVoid(resp: ResponseObject | ReferenceObject): boolean {
  if (isRef(resp)) return false
  const r = resp as ResponseObject
  const content = r.content as Record<string, unknown> | undefined
  return content === undefined || Object.keys(content).length === 0
}

/**
 * Detect the success response content type from a ResponseObject.
 * Returns 'text/plain' or 'application/octet-stream' for non-JSON responses,
 * or 'application/json' as the default.
 */
function detectResponseContentType(
  resp: ResponseObject | ReferenceObject
): 'application/json' | 'text/plain' | 'application/octet-stream' {
  if (isRef(resp)) return 'application/json'
  const r = resp as ResponseObject
  const content = r.content as Record<string, unknown> | undefined
  if (content === undefined) return 'application/json'
  if ('text/plain' in content) return 'text/plain'
  if ('application/octet-stream' in content) return 'application/octet-stream'
  return 'application/json'
}

// fallow-ignore-next-line complexity
export function getResponseStatus(
  operation: OperationObject,
  httpMethod: SupportedMethod
): ResponseStatus {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined

  if (responses === undefined) {
    return httpMethod === 'delete'
      ? { status: 204, isVoid: true, responseContentType: 'application/json' }
      : { status: 200, isVoid: false, responseContentType: 'application/json' }
  }

  // Multi-status: more than one 2xx response with a body (excluding 204/void).
  // Must be checked before individual 200/201/204 branches so that e.g. 200+202
  // is not absorbed by the responses['200'] early return.
  // The handler selects the status at runtime via a { status, body } envelope.
  const contentfulTwoxxKeys = Object.keys(responses)
    .filter((k) => /^2\d\d$/.test(k) && k !== '204')
    .sort()
  if (contentfulTwoxxKeys.length > 1) {
    return {
      status: 200,
      isVoid: false,
      responseContentType: 'application/json',
      isMultiStatus: true,
    }
  }

  if (responses['201'] !== undefined) {
    return {
      status: 201,
      isVoid: false,
      responseContentType: detectResponseContentType(responses['201']),
    }
  }
  if (responses['204'] !== undefined) {
    return { status: 204, isVoid: true, responseContentType: 'application/json' }
  }

  if (responses['200'] !== undefined) {
    if (response200IsVoid(responses['200'])) {
      return { status: 204, isVoid: true, responseContentType: 'application/json' }
    }
    return {
      status: 200,
      isVoid: false,
      responseContentType: detectResponseContentType(responses['200']),
    }
  }

  // Single non-200/201/204 2xx declared: honor that exact status code.
  const twoxxKeys = Object.keys(responses).filter(
    (k) => /^2\d\d$/.test(k) && k !== '200' && k !== '201' && k !== '204'
  )
  if (twoxxKeys.length === 1) {
    const code = parseInt(twoxxKeys[0], 10)
    const resp = responses[twoxxKeys[0]]
    const isVoid = isRef(resp)
      ? false
      : (() => {
          const r = resp as ResponseObject
          const content = r.content as Record<string, unknown> | undefined
          return content === undefined || Object.keys(content).length === 0
        })()
    return { status: code, isVoid, responseContentType: detectResponseContentType(resp) }
  }

  // Default: delete -> 204, otherwise 200
  return httpMethod === 'delete'
    ? { status: 204, isVoid: true, responseContentType: 'application/json' }
    : { status: 200, isVoid: false, responseContentType: 'application/json' }
}

/**
 * Collect the subset of schemaNames used as body schemas for the given operations.
 * Used by the Fastify emitter, which handles non-JSON body content types (multipart,
 * octet-stream) separately at the route level rather than at the schema collection level.
 * Router-specific collection (with isNonJsonBody guard) stays in router.ts.
 */
export function collectUsedSchemaNames(
  operations: OperationBase[],
  schemaNames: Set<string>
): Set<string> {
  const used = new Set<string>()
  for (const op of operations) {
    const typeName = op.bodyInfo?.typeName
    if (typeName === undefined) continue
    const schemaName = `${typeName}Schema`
    if (schemaNames.has(schemaName)) used.add(schemaName)
  }
  return used
}

/** Collect sorted body type names from all operations.
 * Synthesized names (inline schema, no $ref) are excluded because they have no
 * corresponding entry in models.ts and must not appear in the model import.
 */
export function collectSortedBodyTypes(operations: OperationBase[]): string[] {
  const bodyTypes = new Set<string>()
  for (const op of operations) {
    if (op.bodyInfo?.typeName !== undefined && !op.bodyInfo.isSynthesized) {
      // Import the XWritable variant when the body has one, matching the body type/cast the
      // router emits; the base read type is only needed by responses (inferred, not imported here).
      bodyTypes.add(op.bodyInfo.writableTypeName ?? op.bodyInfo.typeName)
    }
  }
  return Array.from(bodyTypes).sort()
}

/**
 * Collect the subset of schemaNames used as Fastify response schemas.
 * Only operations with a resolvable $ref response type (direct or array-of-$ref)
 * and a matching schema in schemaNames are included.
 * Multi-status operations are excluded because they cannot be mapped to a single
 * status code in schema.response at generation time.
 */
export function collectUsedResponseSchemaNames(
  operations: OperationBase[],
  schemaNames: Set<string>
): Set<string> {
  const used = new Set<string>()
  for (const op of operations) {
    if (op.responseTypeName === undefined) continue
    if (op.responseStatus.isMultiStatus === true) continue
    const schemaName = `${op.responseTypeName}Schema`
    if (schemaNames.has(schemaName)) used.add(schemaName)
  }
  return used
}
