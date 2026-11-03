import type { OpenAPIV3_1 } from 'openapi-types'
import {
  toPropertyKey,
  uniquifyName,
  refToTypeName,
  sanitizeOperationId,
  deriveOperationName,
} from '../utils/naming.js'
import { isDeepRef, resolveJsonPointer } from '../utils/ref-resolver.js'
import {
  buildWritableVariantMap,
  resolveBodyRefToWritableName,
} from '../utils/writable-variants.js'
import type { GeneratedFile } from './types.js'

type OperationObject = OpenAPIV3_1.OperationObject
type ParameterObject = OpenAPIV3_1.ParameterObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type SchemaObject = OpenAPIV3_1.SchemaObject
type RequestBodyObject = OpenAPIV3_1.RequestBodyObject
type ResponseObject = OpenAPIV3_1.ResponseObject

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type _SupportedMethod = (typeof SUPPORTED_METHODS)[number]

function isRef(obj: unknown): obj is ReferenceObject {
  return typeof obj === 'object' && obj !== null && '$ref' in obj
}

/**
 * Convert an inline schema to a TypeScript type string (for use in return/param positions).
 * When `spec` is provided, deep $refs are resolved inline rather than using the last-segment name.
 */
/**
 * Resolve a deep $ref via JSON pointer and render its target schema inline.
 * Tracks visited pointers to break cycles (returns 'unknown' on a cycle or an
 * unresolvable pointer). Shared by inlineSchemaToTs and resolveSchema.
 */
function resolveDeepRefToTs(
  ref: string,
  spec: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  const visitedSet = visited ?? new Set<string>()
  if (visitedSet.has(ref)) return 'unknown'
  visitedSet.add(ref)
  const resolved = resolveJsonPointer(spec, ref)
  const result = resolved === undefined ? 'unknown' : inlineSchemaToTs(resolved, spec, visitedSet)
  visitedSet.delete(ref)
  return result
}

/**
 * Resolve the TypeScript type for an inline object schema.
 *
 * Priority:
 * 1. When the schema has explicit `properties`, expand them to an inline object
 *    type respecting the `required` array (missing from required -> optional `?`).
 * 2. When the schema has only `additionalProperties` (no explicit properties),
 *    produce Record<string, T> where T is the value schema.
 * 3. Fall back to Record<string, unknown>.
 */
function inlineObjectSchemaToTs(
  s: SchemaObject,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  const props = s.properties as Record<string, SchemaObject | ReferenceObject> | undefined
  if (props !== undefined && Object.keys(props).length > 0) {
    const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : [])
    const fields = Object.entries(props).map(([key, propSchema]) => {
      const optional = !required.has(key)
      const propKey = toPropertyKey(key)
      const typStr = inlineSchemaToTs(propSchema, spec, visited)
      return `${propKey}${optional ? '?' : ''}: ${typStr}`
    })
    return `{ ${fields.join('; ')} }`
  }
  if (
    s.additionalProperties !== undefined &&
    s.additionalProperties !== true &&
    s.additionalProperties !== false
  ) {
    const valueType = inlineSchemaToTs(
      s.additionalProperties as SchemaObject | ReferenceObject,
      spec,
      visited
    )
    return `Record<string, ${valueType}>`
  }
  return 'Record<string, unknown>'
}

function inlineSchemaToTs(
  schema: SchemaObject | ReferenceObject,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  if (isRef(schema)) {
    const ref = (schema as ReferenceObject).$ref
    if (spec !== undefined && isDeepRef(ref)) return resolveDeepRefToTs(ref, spec, visited)
    return refToTypeName(ref)
  }
  const s = schema as SchemaObject
  if (Array.isArray(s.type)) {
    return (s.type as string[]).map((t) => (t === 'null' ? 'null' : primitiveToTs(t))).join(' | ')
  }
  if (s.type === 'array') {
    const items = (s as OpenAPIV3_1.ArraySchemaObject).items as
      SchemaObject | ReferenceObject | undefined
    if (items !== undefined) return `${inlineSchemaToTs(items, spec, visited)}[]`
    return 'unknown[]'
  }
  if (s.type === 'object') return inlineObjectSchemaToTs(s, spec, visited)
  if (s.type !== undefined) return primitiveToTs(s.type as string)
  return 'unknown'
}

/**
 * Render a $ref to a type name: deep refs are resolved + inlined (when spec is
 * available), component refs use their last-segment name.
 */
function refTypeNameOrInline(ref: string, spec?: OpenAPIV3_1.Document): string {
  if (spec !== undefined && isDeepRef(ref)) return resolveDeepRefToTs(ref, spec)
  return refToTypeName(ref)
}

function resolveSchema(
  schema: SchemaObject | ReferenceObject,
  spec?: OpenAPIV3_1.Document
): {
  typeName: string
  isArray: boolean
} {
  if (isRef(schema)) {
    return { typeName: refTypeNameOrInline((schema as ReferenceObject).$ref, spec), isArray: false }
  }
  const s = schema as SchemaObject
  if (s.type === 'array') {
    const items = (s as OpenAPIV3_1.ArraySchemaObject).items as
      SchemaObject | ReferenceObject | undefined
    if (items !== undefined) {
      if (isRef(items)) {
        return {
          typeName: refTypeNameOrInline((items as ReferenceObject).$ref, spec),
          isArray: true,
        }
      }
      // primitive array
      return { typeName: primitiveToTs((items as SchemaObject).type as string), isArray: true }
    }
  }
  // For inline objects and primitives, emit the full inline type string
  return { typeName: inlineSchemaToTs(s, spec), isArray: false }
}

/**
 * Walk a schema tree and collect the names of every component schema $ref
 * (#/components/schemas/X), mapped through refToTypeName. These are the named
 * types the generated client must import from ./models.js when a response type
 * is an inline-expanded object or array that references component schemas
 * (e.g. an envelope { data: User[]; total?: number }).
 *
 * Mirrors the traversal in inlineSchemaToTs so the collected set matches exactly
 * what the rendered type string references: deep (non-component) refs are
 * resolved inline by inlineSchemaToTs, so we follow them here too in case their
 * targets contain component refs. A visited set breaks ref cycles.
 */
// fallow-ignore-next-line complexity
function collectComponentRefNames(
  schema: SchemaObject | ReferenceObject | undefined,
  spec: OpenAPIV3_1.Document,
  out: Set<string>,
  visited?: Set<string>
): void {
  if (schema === undefined) return
  const visitedSet = visited ?? new Set<string>()
  if (isRef(schema)) {
    const ref = (schema as ReferenceObject).$ref
    if (isDeepRef(ref)) {
      if (visitedSet.has(ref)) return
      visitedSet.add(ref)
      const resolved = resolveJsonPointer(spec, ref) as SchemaObject | ReferenceObject | undefined
      collectComponentRefNames(resolved, spec, out, visitedSet)
      visitedSet.delete(ref)
      return
    }
    const name = refToTypeName(ref)
    if (isImportableType(name)) out.add(name)
    return
  }
  const s = schema as SchemaObject
  if (s.type === 'array') {
    const items = (s as OpenAPIV3_1.ArraySchemaObject).items as
      SchemaObject | ReferenceObject | undefined
    collectComponentRefNames(items, spec, out, visitedSet)
    return
  }
  const props = s.properties as Record<string, SchemaObject | ReferenceObject> | undefined
  if (props !== undefined) {
    for (const propSchema of Object.values(props)) {
      collectComponentRefNames(propSchema, spec, out, visitedSet)
    }
  }
  if (
    s.additionalProperties !== undefined &&
    s.additionalProperties !== true &&
    s.additionalProperties !== false
  ) {
    collectComponentRefNames(
      s.additionalProperties as SchemaObject | ReferenceObject,
      spec,
      out,
      visitedSet
    )
  }
}

function primitiveToTs(type: string | undefined): string {
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'unknown'
  }
}

// fallow-ignore-next-line complexity
function queryParamType(schema: SchemaObject | ReferenceObject | undefined): string {
  if (schema === undefined) return 'string'
  if (isRef(schema)) return 'string'
  const s = schema as SchemaObject
  // 3.1 null-union form, e.g. type: ['string', 'null'] (a nullable query param).
  // A query value is always serialized as a string, so render the underlying
  // non-null primitive and drop the null member.
  if (Array.isArray(s.type)) {
    const nonNull = (s.type as string[]).filter((t) => t !== 'null')
    if (nonNull.length === 1) {
      // type: ['array', 'null'] — nullable array: treat identically to type: 'array'
      if (nonNull[0] === 'array') {
        const items = (s as OpenAPIV3_1.ArraySchemaObject).items as SchemaObject | undefined
        if (items !== undefined && (items.type === 'integer' || items.type === 'number')) {
          return 'number[]'
        }
        return 'string[]'
      }
      return primitiveToTs(nonNull[0])
    }
    return 'string'
  }
  if (s.type === 'array') {
    const items = (s as OpenAPIV3_1.ArraySchemaObject).items as SchemaObject | undefined
    if (items !== undefined && (items.type === 'integer' || items.type === 'number')) {
      return 'number[]'
    }
    return 'string[]'
  }
  // String enum → union literal type (e.g. 'active' | 'inactive')
  if (s.type === 'string' && Array.isArray(s.enum) && s.enum.length > 0) {
    return (s.enum as string[]).map((v) => JSON.stringify(v)).join(' | ')
  }
  return primitiveToTs(s.type as string | undefined)
}

/**
 * Escape static text for safe embedding inside a template literal.
 * Escapes backticks, `${` interpolation starts, and backslashes.
 */
function escapeTemplateLiteralText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/**
 * Strip the query-string portion from an OpenAPI path string, if any.
 * Some malformed specs embed query parameters directly in the path key,
 * e.g. "/search/articles?query={query}". The generator handles query params
 * via URLSearchParams; the embedded literal query string must be dropped so
 * it does not appear as a verbatim fragment in the generated URL template.
 */
function stripPathQueryString(path: string): string {
  const qIndex = path.indexOf('?')
  return qIndex === -1 ? path : path.slice(0, qIndex)
}

/** Convert a path like /api/v1/tasks/{id} to a template literal string with encodeURIComponent calls */
function pathToUrlExpression(path: string): string {
  // Strip any embedded query string before processing path params.
  // Some specs (e.g. /uploads?convert={convert}) embed query params in the path key;
  // those are handled separately via URLSearchParams.
  const cleanPath = stripPathQueryString(path)
  // Replace {param} with ${encodeURIComponent(sanitizedParam)}
  // Sanitize param names like 'change-set-id' → 'changeSetId' for valid TS identifiers
  // Static segments are escaped so backticks, ${, and backslashes in spec paths cannot break out.
  return cleanPath
    .split(/\{([^}]+)\}/)
    .map((segment, index) => {
      if (index % 2 === 0) {
        // Static path segment — escape for template literal embedding
        return escapeTemplateLiteralText(segment)
      }
      // Parameter name segment
      return `\${encodeURIComponent(${sanitizeOperationId(segment)})}`
    })
    .join('')
}

/** Discriminator for how the generated client should parse the success response body. */
type ResponseBodyKind = 'json' | 'text' | 'binary' | 'event-stream' | 'void'

/**
 * Classify a single media type string into a ResponseBodyKind.
 * - json: application/json or any *+json suffix
 * - event-stream: text/event-stream (excluded from the text category)
 * - text: any other text/* media type
 * - binary: everything else (octet-stream, pdf, images, sdp, zip, etc.)
 */
function classifyMediaType(mediaType: string): ResponseBodyKind {
  const mt = mediaType.toLowerCase().split(';')[0]!.trim()
  if (mt === 'application/json' || mt.endsWith('+json')) return 'json'
  if (mt === 'text/event-stream') return 'event-stream'
  if (mt.startsWith('text/')) return 'text'
  return 'binary'
}

/**
 * Given a response content map, pick the best media type using priority:
 * json > text > binary > event-stream.
 * Returns the chosen kind and the matching media type string, or null when content is empty.
 */
function pickResponseContent(
  content: Record<string, { schema?: SchemaObject | ReferenceObject }>
): {
  kind: ResponseBodyKind
  mediaType: string
  entry: { schema?: SchemaObject | ReferenceObject }
} | null {
  const order: ResponseBodyKind[] = ['json', 'text', 'binary', 'event-stream']
  const byKind = new Map<
    ResponseBodyKind,
    { mediaType: string; entry: { schema?: SchemaObject | ReferenceObject } }
  >()

  for (const [mt, entry] of Object.entries(content)) {
    const kind = classifyMediaType(mt)
    if (!byKind.has(kind)) {
      byKind.set(kind, { mediaType: mt, entry })
    }
  }

  for (const kind of order) {
    const found = byKind.get(kind)
    if (found !== undefined) return { kind, ...found }
  }
  return null
}

// fallow-ignore-next-line complexity
function getReturnType(
  operation: OperationObject,
  spec?: OpenAPIV3_1.Document,
  importsOut?: Set<string>
): {
  typeName: string
  isArray: boolean
  isVoid: boolean
  bodyKind: ResponseBodyKind
  mayBeEmpty: boolean
} {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined
  if (responses === undefined)
    return {
      typeName: 'unknown',
      isArray: false,
      isVoid: false,
      bodyKind: 'json',
      mayBeEmpty: false,
    }

  // When a 204 response is also present alongside a 200/201 body response, the
  // operation can return an empty body at runtime. Flag this so callers can emit
  // a no-content guard before parsing JSON.
  const has204 = responses['204'] !== undefined

  // Check 200 first, then 201
  for (const code of ['200', '201']) {
    const response = responses[code]
    if (response === undefined) continue
    if (isRef(response)) continue

    const resp = response as ResponseObject
    const content = resp.content as
      Record<string, { schema?: SchemaObject | ReferenceObject }> | undefined
    if (content === undefined) continue

    const picked = pickResponseContent(content)
    if (picked === null) continue

    if (picked.kind === 'json') {
      if (picked.entry.schema === undefined) continue
      // Collect component schema names referenced anywhere in the response type so
      // inline-expanded objects/arrays (e.g. { data: User[] }) import their members.
      if (importsOut !== undefined && spec !== undefined) {
        collectComponentRefNames(picked.entry.schema, spec, importsOut)
      }
      const resolved = resolveSchema(picked.entry.schema, spec)
      return { ...resolved, isVoid: false, bodyKind: 'json', mayBeEmpty: has204 }
    }

    if (picked.kind === 'text') {
      return {
        typeName: 'string',
        isArray: false,
        isVoid: false,
        bodyKind: 'text',
        mayBeEmpty: has204,
      }
    }

    if (picked.kind === 'event-stream') {
      return {
        typeName: 'ReadableStream<Uint8Array> | null',
        isArray: false,
        isVoid: false,
        bodyKind: 'event-stream',
        mayBeEmpty: has204,
      }
    }

    // binary: application/octet-stream, application/pdf, image/*, application/sdp, etc.
    return {
      typeName: 'Blob',
      isArray: false,
      isVoid: false,
      bodyKind: 'binary',
      mayBeEmpty: has204,
    }
  }

  // Check for 204 (no content) or no successful response
  if (has204 || Object.keys(responses).length === 0) {
    return { typeName: 'void', isArray: false, isVoid: true, bodyKind: 'void', mayBeEmpty: false }
  }

  // No recognized success response body
  return { typeName: 'void', isArray: false, isVoid: true, bodyKind: 'void', mayBeEmpty: false }
}

function resolveParamRef(
  p: ParameterObject | ReferenceObject,
  spec: OpenAPIV3_1.Document,
  visited?: Set<string>
): ParameterObject | null {
  if (!isRef(p)) return p as ParameterObject
  const ref = (p as ReferenceObject).$ref

  // Guard against ref cycles (a parameter ref that resolves back to itself).
  const visitedSet = visited ?? new Set<string>()
  if (visitedSet.has(ref)) return null
  visitedSet.add(ref)

  // Local component ref: #/components/parameters/Name
  const match = /^#\/components\/parameters\/(.+)$/.exec(ref)
  if (match !== null) {
    const name = match[1]!
    const params = spec.components?.parameters as
      Record<string, ParameterObject | ReferenceObject> | undefined
    const resolved = params?.[name]
    if (resolved === undefined) return null
    // The target may itself be a ref (chained), so resolve recursively.
    return resolveParamRef(resolved, spec, visitedSet)
  }

  // Deep / non-component parameter ref, e.g.
  // #/paths/~1.../get/parameters/0 (one operation reusing another's param).
  // resolveParamRef only handled component refs, so these were dropped and the
  // path placeholder was emitted without a matching signature param (TS2304).
  // Resolve the JSON pointer and recurse in case the target is another ref.
  const target = resolveJsonPointer(spec, ref) as ParameterObject | ReferenceObject | undefined
  if (target === undefined) return null
  return resolveParamRef(target, spec, visitedSet)
}

type PathItemObject = OpenAPIV3_1.PathItemObject

/**
 * Merge path-item and operation parameters per the OpenAPI spec:
 * "These parameters can be overridden at the operation level, but cannot be removed there."
 * Operation-level params win when the same (name, in) pair appears at both levels.
 */
function mergeParams(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): ParameterObject[] {
  const pathItemParams = (pathItem.parameters ?? []) as (ParameterObject | ReferenceObject)[]
  const operationParams = (operation.parameters ?? []) as (ParameterObject | ReferenceObject)[]

  const resolved = [
    ...pathItemParams.map((p) => resolveParamRef(p, spec)),
    ...operationParams.map((p) => resolveParamRef(p, spec)),
  ].filter((p): p is ParameterObject => p !== null)

  // Deduplicate: operation-level params override path-item params with the same (name, in)
  const seen = new Map<string, ParameterObject>()
  for (const p of resolved) {
    seen.set(`${p.name}::${p.in}`, p)
  }
  return Array.from(seen.values())
}

interface PathParam {
  name: string // sanitized camelCase TS identifier (e.g. 'changeSetId' from 'change-set-id')
  urlName: string // original name for URL template (e.g. 'change-set-id')
  type: string // TypeScript type derived from the parameter schema (default: 'string')
}

/**
 * Map a path parameter schema to its TypeScript type.
 * Path params are always required positional values; only primitives make sense here.
 * Defaults to 'string' when the schema is absent, a $ref, or has no recognised type.
 */
function pathParamType(schema: SchemaObject | ReferenceObject | undefined): string {
  if (schema === undefined || isRef(schema)) return 'string'
  const s = schema as SchemaObject
  const type = s.type as string | undefined
  if (type === 'integer' || type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  return 'string'
}

function getPathParams(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): PathParam[] {
  return mergeParams(pathItem, operation, spec)
    .filter((p) => p.in === 'path')
    .map((p) => ({
      name: sanitizeOperationId(p.name),
      urlName: p.name,
      type: pathParamType(p.schema as SchemaObject | ReferenceObject | undefined),
    }))
}

interface QueryParam {
  name: string // sanitized TS property name (e.g. 'project_ids' from 'project_ids[]')
  urlName: string // original wire name for URL query string (e.g. 'project_ids[]')
  type: string
  required: boolean
}

/** Returns true when c is an ASCII letter (a-z, A-Z). */
function isAsciiLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

/** Returns true when c is an ASCII letter or digit (a-z, A-Z, 0-9). */
function isAlphanumeric(c: string): boolean {
  return isAsciiLetter(c) || (c >= '0' && c <= '9')
}

/** Returns true when c is a valid identifier-start character (letter, _, $). */
function isIdentStart(c: string): boolean {
  return isAsciiLetter(c) || c === '_' || c === '$'
}

/**
 * CamelCase a pre-processed string in a single linear pass.
 *
 * Finds each run of non-alphanumeric characters (separators). If the run is
 * immediately followed by a letter it is discarded and that letter is
 * uppercased. Otherwise the separator characters are kept verbatim, which
 * lets a later trailing-strip step remove any that end up at the tail.
 *
 * This is the linear-time equivalent of the one-step regex
 * `/[^a-zA-Z0-9]+([a-zA-Z])/g` which is vulnerable to polynomial
 * backtracking (CodeQL js/polynomial-redos) when the input ends in a long
 * separator run not followed by a letter.
 */
function camelCaseSeparators(s: string): string {
  let result = ''
  let i = 0
  while (i < s.length) {
    if (isAlphanumeric(s[i])) {
      result += s[i++]
      continue
    }
    // Locate the end of this separator run.
    let j = i + 1
    while (j < s.length && !isAlphanumeric(s[j])) j++
    // Separator run followed by a letter: discard separators, uppercase the letter.
    if (j < s.length && isAsciiLetter(s[j])) {
      result += s[j].toUpperCase()
      i = j + 1
    } else {
      // Separator run NOT followed by a letter: keep as-is (trailing strip handles it).
      result += s.slice(i, j)
      i = j
    }
  }
  return result
}

/**
 * Normalize a query parameter name to a valid TypeScript identifier.
 * - Strips the [] suffix used by some APIs (PHP/Rails array convention): 'ids[]' -> 'ids'
 * - Converts dot/hyphen-separated names to camelCase: 'place.fields' -> 'placeFields'
 * The original name is preserved separately (as urlName) for URL query string building.
 *
 * Uses a linear character scan (via camelCaseSeparators) instead of the
 * regex `/[^a-zA-Z0-9]+([a-zA-Z])/g` which is polynomial-backtracking
 * vulnerable (CodeQL js/polynomial-redos, issue #261).
 */
export function normalizeQueryParamName(name: string): string {
  // Strip trailing [] (array marker) and apostrophes.
  const s = (name.endsWith('[]') ? name.slice(0, -2) : name).replace(/'/g, '')

  // CamelCase: discard separator runs followed by a letter, uppercase that letter.
  let result = camelCaseSeparators(s)

  // Strip trailing non-alphanumeric characters.
  let end = result.length
  while (end > 0 && !isAlphanumeric(result[end - 1])) end--
  result = result.slice(0, end)

  // Ensure valid identifier start: replace the first character if it is not a letter, _, or $.
  if (result.length > 0 && !isIdentStart(result[0])) {
    result = '_' + result.slice(1)
  }

  return result
}

function getQueryParams(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): QueryParam[] {
  // De-duplicate normalized param names within this operation.
  // Some specs encode multiple wire params that sanitize to the same TS identifier
  // (e.g. 'StartTime', 'StartTime<', 'StartTime>' all become 'StartTime').
  // The first occurrence keeps the base name; subsequent ones get _2, _3, etc.
  const usedParamNames = new Set<string>()
  const raw = mergeParams(pathItem, operation, spec)
    .filter((p) => p.in === 'query')
    .map((p) => ({
      name: normalizeQueryParamName(p.name),
      urlName: p.name,
      type: queryParamType(p.schema as SchemaObject | ReferenceObject | undefined),
      required: p.required === true,
    }))
    .filter((p) => p.name.length > 0) // skip params that reduce to empty string after normalization
  return raw.map((p) => ({
    ...p,
    name: uniquifyName(p.name, usedParamNames),
  }))
}

// Feature 2: Header parameters
interface HeaderParam {
  name: string // camelCase JS identifier (e.g. xStripeSignature)
  headerName: string // original HTTP header name (e.g. 'X-Stripe-Signature')
  required: boolean
  type: string
}

function headerNameToCamelCase(headerName: string): string {
  const parts = headerName.split('-')
  return parts
    .map((part, i) => {
      const lower = part.toLowerCase()
      if (i === 0) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

/**
 * Convert a header name to a safe JS identifier.
 * Uses `headerNameToCamelCase` as the primary conversion (preserves existing public API
 * for standard `X-Foo-Bar` headers) then strips any remaining non-identifier characters
 * that could appear in unusual header names (e.g. apostrophes in "User's-Token").
 */
function safeHeaderIdentifier(headerName: string): string {
  const camel = headerNameToCamelCase(headerName)
  // Strip any characters that are not valid in a JS identifier (keeps letters, digits, $, _)
  const stripped = camel.replace(/[^a-zA-Z0-9_$]/g, '')
  // Ensure the result doesn't start with a digit
  if (/^[0-9]/.test(stripped)) return `_${stripped}`
  return stripped.length > 0 ? stripped : '_'
}

function getHeaderParams(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): HeaderParam[] {
  return mergeParams(pathItem, operation, spec)
    .filter((p) => p.in === 'header' && p.name.length > 0) // skip params with empty names
    .map((p) => ({
      name: safeHeaderIdentifier(p.name),
      headerName: p.name,
      required: p.required === true,
      type: queryParamType(p.schema as SchemaObject | ReferenceObject | undefined),
    }))
}

/**
 * Returns flags indicating whether an operation has a `params` object in its
 * client function signature, and whether that object is required.
 *
 * Mirrors the client generator's exact rule: params is present when the
 * operation has at least one query or header parameter; it is required when at
 * least one of those parameters is required. Resolves $ref parameters and
 * merges path-item level parameters so the result is accurate for specs that
 * define parameters via $ref.
 *
 * Exported so the hooks generator can reuse this single source of truth
 * instead of forking a subtly-different copy.
 */
export function getParamPresence(
  pathItem: PathItemObject,
  operation: OperationObject,
  spec: OpenAPIV3_1.Document
): { hasParams: boolean; hasRequiredParams: boolean } {
  const queryParams = getQueryParams(pathItem, operation, spec)
  const headerParams = getHeaderParams(pathItem, operation, spec)
  const hasParams = queryParams.length > 0 || headerParams.length > 0
  const hasRequiredParams =
    queryParams.some((qp) => qp.required) || headerParams.some((hp) => hp.required)
  return { hasParams, hasRequiredParams }
}

// Feature 4: Multipart/form-data request body info
interface MultipartField {
  name: string
  required: boolean
  isBinary: boolean
}

interface RequestBodyInfo {
  typeName: string
  kind: 'json' | 'multipart' | 'form'
  multipartFields?: MultipartField[]
}

// fallow-ignore-next-line complexity
function getRequestBodyInfo(
  operation: OperationObject,
  spec?: OpenAPIV3_1.Document,
  writableVariantMap?: Map<string, string>,
  importsOut?: Set<string>
): RequestBodyInfo | undefined {
  const requestBody = operation.requestBody as RequestBodyObject | ReferenceObject | undefined
  if (requestBody === undefined) return undefined
  if (isRef(requestBody)) return undefined

  const rb = requestBody as RequestBodyObject
  const content = rb.content as
    Record<string, { schema?: SchemaObject | ReferenceObject }> | undefined
  if (content === undefined) return undefined

  // Check for multipart/form-data first
  const multipartContent = content['multipart/form-data']
  if (multipartContent !== undefined && multipartContent.schema !== undefined) {
    const schema = multipartContent.schema
    if (!isRef(schema)) {
      const s = schema as SchemaObject
      const properties = s.properties as Record<string, SchemaObject | ReferenceObject> | undefined
      const required = (s.required as string[]) ?? []

      const fields: MultipartField[] = []
      const tsParts: string[] = []

      if (properties !== undefined) {
        for (const [fieldName, fieldSchema] of Object.entries(properties)) {
          const isRequired = required.includes(fieldName)
          let isBinary = false
          let tsType = 'string'

          if (!isRef(fieldSchema)) {
            const fs = fieldSchema as SchemaObject
            if (fs.format === 'binary') {
              isBinary = true
              // Use Blob (not File | Blob): Blob is a safe global that is never
              // shadowed by spec-defined schema names. DOM File extends Blob, so
              // callers can still pass File objects. Using File directly risks a
              // collision when the spec defines a schema also named "File" (e.g. box).
              tsType = 'Blob'
            } else {
              tsType = primitiveToTs(fs.type as string | undefined)
            }
          }

          fields.push({ name: fieldName, required: isRequired, isBinary })
          tsParts.push(`  ${toPropertyKey(fieldName)}${isRequired ? '' : '?'}: ${tsType}`)
        }
      }

      const typeName = `{ ${tsParts.map((p) => p.trim()).join('; ')} }`
      return { typeName, kind: 'multipart', multipartFields: fields }
    }
  }

  // Fall back to JSON
  const jsonContent = content['application/json']
  if (jsonContent !== undefined && jsonContent.schema !== undefined) {
    const schema = jsonContent.schema
    // When a component schema $ref has a writable variant, point the request body
    // at XWritable instead of X (the read shape). This ensures callers do not
    // accidentally include readOnly-only fields and are not required to supply
    // writeOnly-only fields that only exist on the response side.
    if (isRef(schema) && writableVariantMap !== undefined) {
      const writableName = resolveBodyRefToWritableName(
        (schema as ReferenceObject).$ref,
        writableVariantMap
      )
      if (writableName !== undefined) {
        return { typeName: writableName, kind: 'json' }
      }
    }
    // No writable redirect on this path, so the rendered inline type references the
    // read-shape component names. Collect them so inline-expanded objects/arrays
    // (e.g. { push: Push }) import their members from ./models.js (#298).
    if (importsOut !== undefined && spec !== undefined) {
      collectComponentRefNames(schema, spec, importsOut)
    }
    return { typeName: inlineSchemaToTs(schema, spec), kind: 'json' }
  }

  // Fall back to application/x-www-form-urlencoded
  const formContent = content['application/x-www-form-urlencoded']
  if (formContent === undefined || formContent.schema === undefined) return undefined

  const formSchema = formContent.schema
  // Apply writable variant redirect for form bodies with component $refs as well
  if (isRef(formSchema) && writableVariantMap !== undefined) {
    const writableName = resolveBodyRefToWritableName(
      (formSchema as ReferenceObject).$ref,
      writableVariantMap
    )
    if (writableName !== undefined) {
      return { typeName: writableName, kind: 'form' }
    }
  }
  if (importsOut !== undefined && spec !== undefined) {
    collectComponentRefNames(formSchema, spec, importsOut)
  }
  return { typeName: inlineSchemaToTs(formSchema, spec), kind: 'form' }
}

/** Feature 4: Collect non-2xx error responses that have a JSON $ref schema and return @throws tags */
// fallow-ignore-next-line complexity
function getThrowsTags(operation: OperationObject): string[] {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined
  if (responses === undefined) return []

  const errorStatusCodes = ['400', '401', '403', '404', '409', '422', '429', '500']
  const tags: string[] = []

  for (const code of errorStatusCodes) {
    const response = responses[code]
    if (response === undefined) continue
    if (isRef(response)) continue

    const resp = response as ResponseObject
    const content = resp.content as
      Record<string, { schema?: SchemaObject | ReferenceObject }> | undefined
    if (content === undefined) continue

    const jsonContent = content['application/json']
    if (jsonContent === undefined || jsonContent.schema === undefined) continue

    const schema = jsonContent.schema
    // Only include $ref-based schemas (inline schemas are too complex to name)
    if (!isRef(schema)) continue

    const typeName = refToTypeName((schema as ReferenceObject).$ref)
    tags.push(` * @throws {ApiError<${code}, ${typeName}>}`)
  }

  return tags
}

/** Get the $ref schema name from an operation's JSON request body, if any. */
function getRequestBodySchemaName(operation: OperationObject): string | undefined {
  const requestBody = operation.requestBody as RequestBodyObject | ReferenceObject | undefined
  if (requestBody === undefined || isRef(requestBody)) return undefined
  const rb = requestBody as RequestBodyObject
  const content = rb.content as
    Record<string, { schema?: SchemaObject | ReferenceObject }> | undefined
  if (content === undefined) return undefined
  const jsonContent = content['application/json']
  if (jsonContent === undefined || jsonContent.schema === undefined) return undefined
  if (!isRef(jsonContent.schema)) return undefined
  return refToTypeName((jsonContent.schema as ReferenceObject).$ref)
}

/** Get the $ref schema name and isArray from a 200/201 response, if any. */
// fallow-ignore-next-line complexity
function getResponseSchemaName(
  operation: OperationObject
): { name: string; isArray: boolean } | undefined {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined
  if (responses === undefined) return undefined
  for (const code of ['200', '201']) {
    const response = responses[code]
    if (response === undefined || isRef(response)) continue
    const resp = response as ResponseObject
    const content = resp.content as
      Record<string, { schema?: SchemaObject | ReferenceObject }> | undefined
    if (content === undefined) continue
    const jsonContent = content['application/json']
    if (jsonContent === undefined || jsonContent.schema === undefined) continue
    const schema = jsonContent.schema
    if (isRef(schema)) {
      return { name: refToTypeName((schema as ReferenceObject).$ref), isArray: false }
    }
    // Array of $ref items
    const s = schema as SchemaObject
    if (s.type === 'array') {
      const items = (s as OpenAPIV3_1.ArraySchemaObject).items as
        SchemaObject | ReferenceObject | undefined
      if (items !== undefined && isRef(items)) {
        return { name: refToTypeName((items as ReferenceObject).$ref), isArray: true }
      }
    }
  }
  return undefined
}

/**
 * Structured description of the auth schemes declared in a spec.
 * Drives conditional code-gen in both the request helpers and ClientConfig.
 */
export interface AuthSchemes {
  /** Spec declares http bearer, OAuth 2, or any unrecognized http scheme. */
  hasBearerOrOAuth: boolean
  /** Spec declares http basic authentication. */
  hasBasicAuth: boolean
  /**
   * Header names for apiKey-in-header schemes (e.g. ["X-API-Key"]).
   * Populated from the `name` field of each apiKey scheme with `in: header`.
   */
  apiKeyHeaderNames: string[]
  /**
   * Query parameter names for apiKey-in-query schemes (e.g. ["api_key"]).
   * Populated from the `name` field of each apiKey scheme with `in: query`.
   */
  apiKeyQueryNames: string[]
}

/** Features derived from the spec that drive conditional code-gen in the helpers. */
interface HelperFeatures {
  /** Structured auth scheme info derived from the spec. */
  authSchemes: AuthSchemes
  /** Spec declares apiKey-in-cookie auth. Emits `credentials` in fetch. */
  hasCookieAuth: boolean
  /** Any endpoint has `in: header` parameters. Emits `extraHeaders` in opts. */
  hasHeaderParams: boolean
  /** Any endpoint is multipart/form-data. Emits `_requestForm` helper. */
  hasMultipart: boolean
  /** Any endpoint uses application/x-www-form-urlencoded. Emits bodyEncoding branch in `_request`. */
  hasFormUrlencoded: boolean
  /**
   * When set, schema-less error bodies are cast to this type name in the generated error handler.
   * Use 'laravel' for the built-in LaravelValidationError type or any other string for an
   * ambient/imported type (see ClientOptions.errorBodyTypeImport for the import path).
   */
  errorBodyType?: string
}

/**
 * Collects all scheme names referenced in global and per-operation security requirements.
 * Used by detectAuthSchemes to decide which defined schemes are active.
 */
function collectReferencedSchemeNames(spec: OpenAPIV3_1.Document): Set<string> {
  const names = new Set<string>()
  const addFromRequirements = (reqs: OpenAPIV3_1.SecurityRequirementObject[]): void => {
    for (const req of reqs) {
      for (const name of Object.keys(req)) names.add(name)
    }
  }
  if (Array.isArray(spec.security)) addFromRequirements(spec.security)
  const paths = spec.paths as Record<string, Record<string, OperationObject>> | undefined
  if (paths !== undefined) {
    for (const pathItem of Object.values(paths)) {
      for (const method of SUPPORTED_METHODS) {
        const op = pathItem[method] as OperationObject | undefined
        if (op !== undefined && Array.isArray(op.security)) addFromRequirements(op.security)
      }
    }
  }
  return names
}

/** Classifies an apiKey scheme: populates header or query name lists (cookie is skipped). */
function classifyApiKeyScheme(scheme: { in?: string; name?: string }, result: AuthSchemes): void {
  if (scheme.in === 'header' && typeof scheme.name === 'string') {
    result.apiKeyHeaderNames.push(scheme.name)
  } else if (scheme.in === 'query' && typeof scheme.name === 'string') {
    result.apiKeyQueryNames.push(scheme.name)
  }
  // cookie apiKey is handled by hasCookieAuth separately — no action here
}

/** Classifies a single (non-$ref) security scheme into the AuthSchemes result. */
function classifyScheme(
  scheme: { type?: string; in?: string; scheme?: string; name?: string },
  result: AuthSchemes
): void {
  if (scheme.type === 'apiKey') return classifyApiKeyScheme(scheme, result)
  if (scheme.type === 'http') {
    if (scheme.scheme === 'basic') result.hasBasicAuth = true
    // bearer, digest, or any other http scheme: treat as bearer-style token
    else result.hasBearerOrOAuth = true
    return
  }
  if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') result.hasBearerOrOAuth = true
}

/**
 * Detects the auth schemes declared in a spec and returns a structured description.
 * Skips $ref security scheme entries and cookie apiKey (handled separately via hasCookieAuth).
 *
 * Fallback: when a security requirement references a scheme name that is NOT defined in
 * components/securitySchemes (or has no scheme definitions at all), we treat it as
 * bearer-style auth. Cookie-only specs are NOT treated as bearer.
 */
export function detectAuthSchemes(spec: OpenAPIV3_1.Document): AuthSchemes {
  const result: AuthSchemes = {
    hasBearerOrOAuth: false,
    hasBasicAuth: false,
    apiKeyHeaderNames: [],
    apiKeyQueryNames: [],
  }

  const rawSchemes = spec.components?.securitySchemes
  const referenced = collectReferencedSchemeNames(spec)

  if (!rawSchemes) {
    // No scheme definitions: if any schemes are referenced, assume bearer-style.
    if (referenced.size > 0) result.hasBearerOrOAuth = true
    return result
  }

  const defined = new Set(Object.keys(rawSchemes))

  for (const [name, s] of Object.entries(rawSchemes)) {
    if (isRef(s)) continue
    // Only classify schemes that are actually referenced in a security requirement.
    if (referenced.size > 0 && !referenced.has(name)) continue
    classifyScheme(s as { type?: string; in?: string; scheme?: string; name?: string }, result)
  }

  // If any referenced scheme is NOT defined locally, fall back to bearer-style.
  // This handles external/referenced schemes without local definitions.
  for (const name of referenced) {
    if (!defined.has(name)) {
      result.hasBearerOrOAuth = true
      break
    }
  }

  return result
}

/** Returns true when the auth schemes require a `token` field in ClientConfig. */
function needsTokenField(auth: AuthSchemes): boolean {
  return auth.hasBearerOrOAuth
}

/** Returns true when the auth schemes require an `apiKey` field in ClientConfig. */
function needsApiKeyField(auth: AuthSchemes): boolean {
  return auth.apiKeyHeaderNames.length > 0 || auth.apiKeyQueryNames.length > 0
}

/** Returns true when the auth schemes require a `basicAuth` field in ClientConfig. */
function needsBasicAuthField(auth: AuthSchemes): boolean {
  return auth.hasBasicAuth
}

/** Emits credential resolution lines for token, basicAuth, and apiKey config fields. */
function emitCredentialResolution(
  lines: string[],
  hasToken: boolean,
  hasBasic: boolean,
  hasApiKey: boolean
): void {
  if (hasToken)
    lines.push(`  const resolvedToken = typeof token === 'function' ? await token() : token`)
  if (hasBasic)
    lines.push(
      `  const resolvedBasic = typeof basicAuth === 'function' ? await basicAuth() : basicAuth`
    )
  if (hasApiKey)
    lines.push(`  const resolvedApiKey = typeof apiKey === 'function' ? await apiKey() : apiKey`)
}

/** Emits URL construction, injecting apiKey query params when the spec declares them. */
function emitUrlBuilding(lines: string[], queryNames: string[], searchParamsExpr: string): void {
  if (queryNames.length > 0) {
    lines.push(`  const _sp = new URLSearchParams(${searchParamsExpr})`)
    for (const qName of queryNames) {
      lines.push(`  if (resolvedApiKey) _sp.set(${JSON.stringify(qName)}, resolvedApiKey)`)
    }
    lines.push(`  const base = baseUrl ? baseUrl.replace(/\\/$/, '') : ''`)
    lines.push(`  const qs = _sp.toString()`)
  } else {
    lines.push(`  const base = baseUrl ? baseUrl.replace(/\\/$/, '') : ''`)
    lines.push(`  const qs = ${searchParamsExpr}?.toString() ?? ''`)
  }
  lines.push(`  const url = qs ? \`\${base}\${path}?\${qs}\` : \`\${base}\${path}\``)
}

/** Emits the auth header spreads inside a headers block (bearer, basic, apiKey-header). */
function emitAuthHeaderSpreads(
  lines: string[],
  hasToken: boolean,
  hasBasic: boolean,
  apiKeyHeaderNames: string[]
): void {
  if (hasToken) {
    lines.push(`      ...(resolvedToken ? { Authorization: \`Bearer \${resolvedToken}\` } : {}),`)
  }
  if (hasBasic) {
    lines.push(
      `      ...(resolvedBasic ? { Authorization: \`Basic \${btoa(\`\${resolvedBasic.username}:\${resolvedBasic.password}\`)}\` } : {}),`
    )
  }
  for (const headerName of apiKeyHeaderNames) {
    lines.push(
      `      ...(resolvedApiKey ? { ${JSON.stringify(headerName)}: resolvedApiKey } : {}),`
    )
  }
}

/**
 * Emits the shared error-check + return block at the end of a helper function.
 * When errorBodyType is provided, the error body is cast to that type so callers
 * get a typed body instead of unknown. The special value 'laravel' uses the built-in
 * LaravelValidationError type emitted alongside ApiError; any other value is used as-is
 * (caller is responsible for ensuring the type is in scope).
 */
function emitErrorCheckAndReturn(lines: string[], errorBodyType?: string): void {
  lines.push(`  if (!res.ok) {`)
  if (errorBodyType !== undefined) {
    lines.push(
      `    const err = new ApiError(res.status, await res.json().catch(() => null) as ${errorBodyType})`
    )
  } else {
    lines.push(`    const err = new ApiError(res.status, await res.json().catch(() => null))`)
  }
  lines.push(`    onError?.(err)`)
  lines.push(`    throw err`)
  lines.push(`  }`)
  lines.push(`  return res`)
  lines.push(`}`)
}

/** Emits the fetch override and url/init variable setup at the start of a fetch call block. */
function emitFetchSetup(lines: string[]): void {
  lines.push(`  const fetch = _configFetch ?? globalThis.fetch`)
  lines.push(`  let _url = url`)
}

/** Emits the onRequest interceptor call that may mutate url and init. */
function emitOnRequestBlock(lines: string[]): void {
  lines.push(`  if (onRequest) {`)
  lines.push(`    const _or = await onRequest({ url: _url, init: _init })`)
  lines.push(`    if (_or) {`)
  lines.push(`      if (_or.url !== undefined) _url = _or.url`)
  lines.push(`      if (_or.init !== undefined) _init = { ..._init, ..._or.init }`)
  lines.push(`    }`)
  lines.push(`  }`)
}

/** Emits the signal/timeout combining logic and the final fetch call. */
function emitSignalAndFetch(lines: string[]): void {
  lines.push(`  const _rawSignal = opts.signal ?? _cfgSignal`)
  lines.push(`  const _resolvedSignal = _buildSignal(_rawSignal, timeout)`)
  lines.push(`  if (_resolvedSignal !== undefined) _init = { ..._init, signal: _resolvedSignal }`)
  lines.push(`  const res = await fetch(_url, _init)`)
}

/** Emits the Content-Type header line inside a headers block for JSON or form-urlencoded body. */
function emitContentTypeHeader(lines: string[], hasFormUrlencoded: boolean): void {
  if (hasFormUrlencoded) {
    lines.push(
      `      ...(opts.body !== undefined ? { 'Content-Type': opts.bodyEncoding === 'form' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}),`
    )
  } else {
    lines.push(`      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),`)
  }
}

/** Emits the Accept: application/json header as the first entry in the headers block. */
function emitAcceptHeader(lines: string[]): void {
  lines.push(`      'Accept': 'application/json',`)
}

/** Emits the body field in the fetch options for JSON or form-urlencoded body. */
function emitBodyField(lines: string[], hasFormUrlencoded: boolean): void {
  if (hasFormUrlencoded) {
    lines.push(
      `    ...(opts.body !== undefined ? { body: opts.bodyEncoding === 'form' ? new URLSearchParams(Object.entries(opts.body as Record<string, unknown>).flatMap(([k, v]) => Array.isArray(v) ? v.map((e) => [k, String(e)] as [string, string]) : v == null ? [] : [[k, String(v)] as [string, string]])).toString() : JSON.stringify(opts.body) } : {}),`
    )
  } else {
    lines.push(`    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),`)
  }
}

/** Builds the ordered list of config fields to destructure in request helpers. */
function buildConfigFields(
  hasToken: boolean,
  hasApiKey: boolean,
  hasBasic: boolean,
  hasCookieAuth: boolean
): string[] {
  const fields = ['baseUrl']
  if (hasToken) fields.push('token')
  if (hasApiKey) fields.push('apiKey')
  if (hasBasic) fields.push('basicAuth')
  if (hasCookieAuth) fields.push('credentials')
  fields.push(
    'headers',
    'onError',
    'signal: _cfgSignal',
    'timeout',
    'onRequest',
    'fetch: _configFetch'
  )
  return fields
}

/** Emits the _request function into lines (up to and including the closing brace). */
function emitRequestFunction(
  lines: string[],
  features: HelperFeatures,
  configFields: string[],
  hasToken: boolean,
  hasBasic: boolean,
  hasApiKey: boolean
): void {
  const auth = features.authSchemes
  lines.push(`async function _request(`)
  lines.push(`  method: string,`)
  lines.push(`  path: string,`)
  lines.push(`  opts: {`)
  lines.push(`    searchParams?: URLSearchParams`)
  lines.push(`    body?: unknown`)
  if (features.hasFormUrlencoded) lines.push(`    bodyEncoding?: 'json' | 'form'`)
  if (features.hasHeaderParams) lines.push(`    extraHeaders?: Record<string, string>`)
  lines.push(`    signal?: AbortSignal`)
  lines.push(`  },`)
  lines.push(`  config?: Partial<ClientConfig>,`)
  lines.push(`): Promise<_FetchResponse> {`)
  lines.push(`  const { ${configFields.join(', ')} } = { ...getConfig(), ...config }`)
  emitCredentialResolution(lines, hasToken, hasBasic, hasApiKey)
  emitUrlBuilding(lines, auth.apiKeyQueryNames, 'opts.searchParams')
  emitFetchSetup(lines)
  lines.push(`  let _init: RequestInit = {`)
  lines.push(`    method,`)
  if (features.hasCookieAuth) lines.push(`    credentials,`)
  lines.push(`    headers: {`)
  emitAcceptHeader(lines)
  emitContentTypeHeader(lines, features.hasFormUrlencoded)
  lines.push(`      ...headers,`)
  emitAuthHeaderSpreads(lines, hasToken, hasBasic, auth.apiKeyHeaderNames)
  if (features.hasHeaderParams) lines.push(`      ...opts.extraHeaders,`)
  lines.push(`    },`)
  emitBodyField(lines, features.hasFormUrlencoded)
  lines.push(`  }`)
  emitOnRequestBlock(lines)
  emitSignalAndFetch(lines)
  emitErrorCheckAndReturn(lines, features.errorBodyType)
}

/** Emits the _requestForm function into lines (up to and including the closing brace). */
function emitRequestFormFunction(
  lines: string[],
  features: HelperFeatures,
  configFields: string[],
  hasToken: boolean,
  hasBasic: boolean,
  hasApiKey: boolean
): void {
  const auth = features.authSchemes
  lines.push(`async function _requestForm(`)
  lines.push(`  method: string,`)
  lines.push(`  path: string,`)
  lines.push(`  formData: FormData,`)
  lines.push(`  opts: {`)
  lines.push(`    searchParams?: URLSearchParams`)
  if (features.hasHeaderParams) lines.push(`    extraHeaders?: Record<string, string>`)
  lines.push(`    signal?: AbortSignal`)
  lines.push(`  },`)
  lines.push(`  config?: Partial<ClientConfig>,`)
  lines.push(`): Promise<_FetchResponse> {`)
  lines.push(`  const { ${configFields.join(', ')} } = { ...getConfig(), ...config }`)
  emitCredentialResolution(lines, hasToken, hasBasic, hasApiKey)
  emitUrlBuilding(lines, auth.apiKeyQueryNames, 'opts.searchParams')
  emitFetchSetup(lines)
  lines.push(`  let _init: RequestInit = {`)
  lines.push(`    method,`)
  if (features.hasCookieAuth) lines.push(`    credentials,`)
  lines.push(`    headers: {`)
  emitAcceptHeader(lines)
  lines.push(`      ...headers,`)
  emitAuthHeaderSpreads(lines, hasToken, hasBasic, auth.apiKeyHeaderNames)
  if (features.hasHeaderParams) lines.push(`      ...opts.extraHeaders,`)
  lines.push(`    },`)
  lines.push(`    body: formData,`)
  lines.push(`  }`)
  emitOnRequestBlock(lines)
  emitSignalAndFetch(lines)
  emitErrorCheckAndReturn(lines, features.errorBodyType)
}

/**
 * Emit the shared private request helpers that all generated endpoint functions delegate to.
 *
 * `_request`     — handles all JSON / no-body endpoints (always emitted when spec has endpoints).
 * `_requestForm` — handles multipart/form-data endpoints (only emitted when the spec has them).
 *
 * Both helpers are feature-conditional: code for auth, credentials, and extraHeaders is only
 * emitted when the spec actually declares those features, keeping the bundle lean for simple APIs.
 */
/** Emits the _buildSignal private helper that combines a user signal with a timeout. */
function emitBuildSignalHelper(lines: string[]): void {
  lines.push(`function _buildSignal(`)
  lines.push(`  signal: AbortSignal | undefined,`)
  lines.push(`  timeout: number | undefined,`)
  lines.push(`): AbortSignal | undefined {`)
  lines.push(`  if (timeout === undefined) return signal`)
  lines.push(`  const _ts = AbortSignal.timeout(timeout)`)
  lines.push(`  if (signal === undefined) return _ts`)
  lines.push(`  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, _ts])`)
  lines.push(`  const _ctrl = new AbortController()`)
  lines.push(
    `  const _abort = (s: AbortSignal) => () => { if (!_ctrl.signal.aborted) _ctrl.abort(s.reason) }`
  )
  lines.push(`  signal.addEventListener('abort', _abort(signal), { once: true })`)
  lines.push(`  _ts.addEventListener('abort', _abort(_ts), { once: true })`)
  lines.push(`  return _ctrl.signal`)
  lines.push(`}`)
}

function generateRequestHelpers(features: HelperFeatures): string {
  const auth = features.authSchemes
  const hasToken = needsTokenField(auth)
  const hasApiKey = needsApiKeyField(auth)
  const hasBasic = needsBasicAuthField(auth)
  const configFields = buildConfigFields(hasToken, hasApiKey, hasBasic, features.hasCookieAuth)

  const lines: string[] = []
  // Private type alias avoids shadowing when a spec defines a schema named 'Response'.
  lines.push(`type _FetchResponse = Awaited<ReturnType<typeof fetch>>`)
  lines.push(``)
  emitBuildSignalHelper(lines)
  lines.push(``)
  emitRequestFunction(lines, features, configFields, hasToken, hasBasic, hasApiKey)
  if (features.hasMultipart) {
    lines.push(``)
    emitRequestFormFunction(lines, features, configFields, hasToken, hasBasic, hasApiKey)
  }
  return lines.join('\n')
}

// fallow-ignore-next-line complexity
function generateFunctionCode(
  funcName: string,
  method: string,
  path: string,
  pathParams: PathParam[],
  queryParams: QueryParam[],
  headerParams: HeaderParam[],
  bodyInfo: RequestBodyInfo | undefined,
  returnType: {
    typeName: string
    isArray: boolean
    isVoid: boolean
    bodyKind: ResponseBodyKind
    mayBeEmpty: boolean
  },
  deprecated: boolean,
  throwsTags: string[],
  options?: ClientOptions,
  requestBodySchemaName?: string,
  responseSchemaName?: { name: string; isArray: boolean }
): string {
  const lines: string[] = []

  // Build function signature
  const sigParts: string[] = []
  // Path params first (positional) — use sanitized TS name with schema-derived type
  for (const param of pathParams) {
    sigParts.push(`${param.name}: ${param.type}`)
  }
  // Body param
  if (bodyInfo !== undefined) {
    sigParts.push(`body: ${bodyInfo.typeName}`)
  }

  // Query params + header params share the same params object.
  // When the wire name ends with '[]' (PHP/Rails bracket notation), preserve the wire
  // name as the interface key so callers see params["ids[]"] — the original API name.
  // For all other params, use the normalized camelCase identifier (qp.name).
  const allParamFields: string[] = []
  for (const qp of queryParams) {
    const fieldKey = qp.urlName.endsWith('[]') ? toPropertyKey(qp.urlName) : toPropertyKey(qp.name)
    allParamFields.push(`  ${fieldKey}${qp.required ? '' : '?'}: ${qp.type}`)
  }
  for (const hp of headerParams) {
    allParamFields.push(`  ${hp.name}${hp.required ? '' : '?'}: ${hp.type}`)
  }

  if (allParamFields.length > 0) {
    const hasRequired =
      queryParams.some((qp) => qp.required) || headerParams.some((hp) => hp.required)
    sigParts.push(`params${hasRequired ? '' : '?'}: {\n${allParamFields.join('\n')}\n}`)
  }

  // Per-request config override — enables SSR without mutating the global singleton
  sigParts.push(`config?: Partial<ClientConfig>`)

  // For non-json body kinds, isArray is always false; the typeName is the full type string.
  // When mayBeEmpty, the operation can return a 204 at runtime: union the body type with undefined.
  const returnTs = returnType.isVoid
    ? 'Promise<void>'
    : returnType.isArray
      ? returnType.mayBeEmpty
        ? `Promise<${returnType.typeName}[] | undefined>`
        : `Promise<${returnType.typeName}[]>`
      : returnType.mayBeEmpty
        ? `Promise<${returnType.typeName} | undefined>`
        : `Promise<${returnType.typeName}>`

  // Feature 1 + 4: JSDoc block with @deprecated and/or @throws tags
  const hasJsDoc = deprecated || throwsTags.length > 0
  if (hasJsDoc) {
    lines.push(`/**`)
    if (deprecated) {
      lines.push(` * @deprecated`)
    }
    for (const tag of throwsTags) {
      lines.push(tag)
    }
    lines.push(` */`)
  }

  lines.push(`export async function ${funcName}(${sigParts.join(', ')}): ${returnTs} {`)

  // Build URL path arg (template literal when path params present, plain string otherwise)
  const urlExpression = pathToUrlExpression(path)
  const hasPathParams = path.includes('{')
  const pathArg = hasPathParams ? '`' + urlExpression + '`' : JSON.stringify(path)

  // URLSearchParams (query params) — still built in caller, passed to helper
  if (queryParams.length > 0) {
    lines.push(`  const searchParams = new URLSearchParams()`)
    for (const qp of queryParams) {
      // When the wire name uses bracket notation (e.g. 'ids[]'), use bracket access in
      // the generated code so the property key matches the interface declaration.
      // For all other params, use dot notation with the normalized identifier.
      const isBracket = qp.urlName.endsWith('[]')
      const access = isBracket ? `params?.[${JSON.stringify(qp.urlName)}]` : `params?.${qp.name}`
      const valueAccess = isBracket ? `params[${JSON.stringify(qp.urlName)}]` : `params.${qp.name}`
      if (qp.type.endsWith('[]')) {
        // Array params: use append in a loop (not set) so multiple values are preserved.
        // urlName is used as the wire key (e.g. 'ids[]' -> searchParams.append('ids[]', ...)).
        lines.push(
          `  if (${access} != null) { for (const v of ${valueAccess}) searchParams.append('${qp.urlName}', String(v)) }`
        )
      } else {
        lines.push(
          `  if (${access} != null) searchParams.set('${qp.urlName}', String(${valueAccess}))`
        )
      }
    }
  }

  // FormData (multipart) — still built in caller, passed to _requestForm
  if (
    bodyInfo !== undefined &&
    bodyInfo.kind === 'multipart' &&
    bodyInfo.multipartFields !== undefined
  ) {
    lines.push(`  const formData = new FormData()`)
    for (const field of bodyInfo.multipartFields) {
      // Use bracket notation for field names with special chars (e.g. 'file.xml')
      const isSimple = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(field.name)
      const access = isSimple ? `body.${field.name}` : `body[${JSON.stringify(field.name)}]`
      if (field.isBinary) {
        lines.push(
          `  if (${access} != null) formData.append(${JSON.stringify(field.name)}, ${access})`
        )
      } else {
        lines.push(
          `  if (${access} != null) formData.append(${JSON.stringify(field.name)}, String(${access}))`
        )
      }
    }
  }

  // Header params → extraHeaders object (preserves the same conditional spread pattern)
  // HTTP headers are strings on the wire, so non-string param types (number, boolean,
  // string-literal unions) are coerced with String() to satisfy Record<string, string>.
  if (headerParams.length > 0) {
    const spreadParts = headerParams
      .map(
        (hp) =>
          `    ...(params?.${hp.name} != null ? { ${JSON.stringify(hp.headerName)}: String(params.${hp.name}) } : {}),`
      )
      .join('\n')
    lines.push(`  const extraHeaders: Record<string, string> = {`)
    lines.push(spreadParts)
    lines.push(`  }`)
  }

  // Schema-enhanced: request body validation before the fetch call
  if (
    options?.schemaNames !== undefined &&
    requestBodySchemaName !== undefined &&
    options.schemaNames.has(`${requestBodySchemaName}Schema`) &&
    bodyInfo !== undefined &&
    bodyInfo.kind === 'json'
  ) {
    // Validate the request body against the Zod schema before sending.
    // Note: we do not call .strip() because not all schemas are ZodObject
    // (allOf → ZodIntersection, oneOf/anyOf → ZodUnion — neither has .strip()).
    lines.push(`  ${requestBodySchemaName}Schema.parse(body)`)
  }

  // Build opts object for the helper call
  const isMultipart = bodyInfo !== undefined && bodyInfo.kind === 'multipart'

  if (isMultipart) {
    // _requestForm: formData is a positional arg; opts only carries searchParams + extraHeaders
    const formOptsParts: string[] = []
    if (queryParams.length > 0) formOptsParts.push('searchParams')
    if (headerParams.length > 0) formOptsParts.push('extraHeaders')
    const formOpts = formOptsParts.length > 0 ? `{ ${formOptsParts.join(', ')} }` : '{}'
    const call = `_requestForm('${method.toUpperCase()}', ${pathArg}, formData, ${formOpts}, config)`
    if (returnType.isVoid) {
      lines.push(`  await ${call}`)
    } else {
      lines.push(`  const res = await ${call}`)
    }
  } else {
    // _request: JSON or form body (if any) goes in opts.body; no FormData
    const optsParts: string[] = []
    if (queryParams.length > 0) optsParts.push('searchParams')
    if (bodyInfo !== undefined && (bodyInfo.kind === 'json' || bodyInfo.kind === 'form')) {
      optsParts.push('body')
    }
    if (bodyInfo !== undefined && bodyInfo.kind === 'form') {
      optsParts.push(`bodyEncoding: 'form'`)
    }
    if (headerParams.length > 0) optsParts.push('extraHeaders')
    const optsLiteral = optsParts.length > 0 ? `{ ${optsParts.join(', ')} }` : '{}'
    const call = `_request('${method.toUpperCase()}', ${pathArg}, ${optsLiteral}, config)`
    if (returnType.isVoid) {
      lines.push(`  await ${call}`)
    } else {
      lines.push(`  const res = await ${call}`)
    }
  }

  // Return / response parsing — switch on the body kind determined from the spec.
  if (!returnType.isVoid) {
    const kind = returnType.bodyKind
    if (kind === 'text') {
      // Guard against 204 no-content before reading the body
      if (returnType.mayBeEmpty) lines.push(`  if (res.status === 204) return undefined`)
      lines.push(`  return res.text()`)
    } else if (kind === 'binary') {
      if (returnType.mayBeEmpty) lines.push(`  if (res.status === 204) return undefined`)
      lines.push(`  return res.blob()`)
    } else if (kind === 'event-stream') {
      // Full SSE parsing (EventSource / TransformStream) is tracked separately.
      // Expose the raw ReadableStream so callers can implement their own consumer.
      if (returnType.mayBeEmpty) lines.push(`  if (res.status === 204) return undefined`)
      lines.push(`  return res.body`)
    } else {
      // json kind: apply Zod validation when schema-enhanced, otherwise plain res.json()
      // Guard against 204 no-content: calling res.json() on an empty body throws.
      if (returnType.mayBeEmpty) lines.push(`  if (res.status === 204) return undefined`)
      if (
        options?.schemaNames !== undefined &&
        responseSchemaName !== undefined &&
        options.schemaNames.has(`${responseSchemaName.name}Schema`)
      ) {
        if (responseSchemaName.isArray) {
          lines.push(`  return z.array(${responseSchemaName.name}Schema).parse(await res.json())`)
        } else {
          lines.push(`  return ${responseSchemaName.name}Schema.parse(await res.json())`)
        }
      } else {
        lines.push(`  return res.json()`)
      }
    }
  }

  lines.push(`}`)

  return lines.join('\n')
}

export interface ClientOptions {
  schemaNames?: Set<string>
  schemaImportPath?: string
  /**
   * When set, schema-less error bodies are cast to this type in the generated client.
   * Use 'laravel' to emit the built-in LaravelValidationError type
   * ({ message: string; errors: Record<string, string[]> }) alongside ApiError.
   * Any other string is used as-is; pair it with errorBodyTypeImport to emit an import,
   * or leave errorBodyTypeImport unset to treat it as an ambient/global type.
   */
  errorBodyType?: string
  /**
   * When errorBodyType is set to a custom type name (not 'laravel'), provide the module
   * path here and the generator will emit `import type { TypeName } from 'importPath'`
   * at the top of the generated client. Ignored when errorBodyType is 'laravel' or absent.
   */
  errorBodyTypeImport?: string
}

/** Built-in TypeScript types that must NOT be imported from ./models */
const BUILTIN_TS_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'unknown',
  'void',
  'null',
  'undefined',
  'any',
  'never',
  // Global platform types: never import from ./models
  'Blob',
  'ReadableStream',
  'Uint8Array',
])

/**
 * Returns true only for simple identifiers (e.g. "Task", "CreateTaskRequest") that are
 * safe to include in an `import type { … }` statement.
 * Filters out inline type expressions ("Record<string, unknown>"), arrays ("Task[]"),
 * union types ("string | null"), and built-in TS primitives.
 */
function isImportableType(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !BUILTIN_TS_TYPES.has(name)
}

// Feature 3: Cookie auth detection
export function hasCookieAuth(spec: OpenAPIV3_1.Document): boolean {
  const schemes = spec.components?.securitySchemes
  if (!schemes) return false
  return Object.values(schemes).some(
    (s) => !isRef(s) && (s as any).type === 'apiKey' && (s as any).in === 'cookie'
  )
}

/**
 * Names that are defined or imported at file scope in the generated client output.
 * Any spec-derived operation whose sanitized name matches one of these receives a
 * numeric suffix (_2, _3, ...) so it never shadows a client-internal identifier.
 *
 * Exported so the hooks generator can pre-seed its own uniquification pass with the
 * same set, keeping both generators in sync without duplicating this list.
 */
export const CLIENT_INTERNAL_NAMES: ReadonlySet<string> = new Set([
  'getConfig', // imported from ./client-config.js; called inside every request helper
  'fetch', // global built-in used in _request; typeof fetch drives _FetchResponse
  'ApiError', // exported class defined in the generated file
  'ClientConfig', // re-exported type from ./client-config.js
  '_request', // private helper
  '_requestForm', // private helper
  '_buildSignal', // private helper
  '_FetchResponse', // private type alias
])

// fallow-ignore-next-line complexity
export function generateClient(
  spec: OpenAPIV3_1.Document,
  options?: ClientOptions,
  writableVariantMap?: Map<string, string>
): GeneratedFile {
  const paths = spec.paths as Record<string, Record<string, OperationObject>> | undefined

  // Use the pre-computed map when provided (single source of truth via generator.ts).
  // Fall back to building it internally so existing callers without the map still work.
  const resolvedWritableVariantMap = writableVariantMap ?? buildWritableVariantMap(spec)

  const collectedTypeNames = new Set<string>()
  const collectedSchemaNames = new Set<string>()
  let needsZImport = false
  let hasMultipartEndpoints = false
  let hasFormUrlencodedEndpoints = false
  let hasHeaderParamEndpoints = false
  let hasAnyEndpoints = false
  const functionBlocks: string[] = []

  // Pre-seed used names with client-internal identifiers so that spec-derived
  // operation names cannot collide with them. Any spec operation whose sanitized
  // name matches a reserved identifier will receive a numeric suffix (_2, _3…).
  // The CLIENT_INTERNAL_NAMES set is defined at module level and exported so that
  // the hooks generator can reuse the same set (single source of truth).
  const usedFuncNames = new Set<string>(CLIENT_INTERNAL_NAMES)

  if (paths !== undefined) {
    for (const [path, pathItem] of Object.entries(paths)) {
      for (const method of SUPPORTED_METHODS) {
        const operation = pathItem[method] as OperationObject | undefined
        if (operation === undefined) continue

        hasAnyEndpoints = true

        // Derive function name and ensure it is unique across all operations.
        let funcName: string
        if (operation.operationId !== undefined) {
          funcName = sanitizeOperationId(operation.operationId)
        } else {
          funcName = deriveOperationName(method, path)
        }
        funcName = uniquifyName(funcName, usedFuncNames)

        const pathParams = getPathParams(pathItem, operation, spec)
        const queryParams = getQueryParams(pathItem, operation, spec)
        const headerParams = getHeaderParams(pathItem, operation, spec)
        const bodyInfo = getRequestBodyInfo(
          operation,
          spec,
          resolvedWritableVariantMap,
          collectedTypeNames
        )
        const returnType = getReturnType(operation, spec, collectedTypeNames)
        const deprecated = operation.deprecated === true
        const throwsTags = getThrowsTags(operation)

        // Track which features are used across the spec (drives conditional helper code-gen)
        if (bodyInfo !== undefined && bodyInfo.kind === 'multipart') hasMultipartEndpoints = true
        if (bodyInfo !== undefined && bodyInfo.kind === 'form') hasFormUrlencodedEndpoints = true
        if (headerParams.length > 0) hasHeaderParamEndpoints = true

        // Schema-enhanced: compute request body and response schema names for this operation
        const requestBodySchemaName =
          options?.schemaNames !== undefined ? getRequestBodySchemaName(operation) : undefined
        const responseSchemaName =
          options?.schemaNames !== undefined ? getResponseSchemaName(operation) : undefined

        // Collect type names for import — only simple schema identifiers (e.g. "Task"),
        // never inline type expressions (e.g. "Record<string, unknown>") or primitives.
        // Both JSON and form-urlencoded bodies may reference a named schema type that
        // must be imported from ./models.js (e.g. a $ref schema used as the form body).
        if (bodyInfo !== undefined && (bodyInfo.kind === 'json' || bodyInfo.kind === 'form')) {
          // Strip a trailing "[]" suffix so array-body types like "WannabeEnvVar[]"
          // still contribute their base name "WannabeEnvVar" to the import list.
          const bodyBaseName = bodyInfo.typeName.endsWith('[]')
            ? bodyInfo.typeName.slice(0, -2)
            : bodyInfo.typeName
          if (isImportableType(bodyBaseName)) {
            collectedTypeNames.add(bodyBaseName)
          }
        }
        if (!returnType.isVoid && isImportableType(returnType.typeName)) {
          collectedTypeNames.add(returnType.typeName)
        }

        // Collect schema names actually used (drift-safe: only if in schemaNames set)
        if (options?.schemaNames !== undefined) {
          if (
            requestBodySchemaName !== undefined &&
            options.schemaNames.has(`${requestBodySchemaName}Schema`)
          ) {
            collectedSchemaNames.add(`${requestBodySchemaName}Schema`)
          }
          if (
            responseSchemaName !== undefined &&
            options.schemaNames.has(`${responseSchemaName.name}Schema`)
          ) {
            collectedSchemaNames.add(`${responseSchemaName.name}Schema`)
            if (responseSchemaName.isArray) needsZImport = true
          }
        }

        const fnCode = generateFunctionCode(
          funcName,
          method,
          path,
          pathParams,
          queryParams,
          headerParams,
          bodyInfo,
          returnType,
          deprecated,
          throwsTags,
          options,
          requestBodySchemaName,
          responseSchemaName
        )
        functionBlocks.push(fnCode)
      }
    }
  }

  // Build file content
  const lines: string[] = []
  lines.push('// This file is auto-generated by openapi-zod-ts — do not edit')
  lines.push('')

  if (collectedTypeNames.size > 0) {
    const sortedTypes = Array.from(collectedTypeNames).sort()
    lines.push(`import type { ${sortedTypes.join(', ')} } from './models.js'`)
  }
  lines.push(`import { getConfig, type ClientConfig } from './client-config.js'`)

  // Schema-enhanced imports
  if (
    options?.schemaNames !== undefined &&
    collectedSchemaNames.size > 0 &&
    options.schemaImportPath !== undefined
  ) {
    if (needsZImport) {
      lines.push(`import { z } from 'zod'`)
    }
    const sortedSchemas = Array.from(collectedSchemaNames).sort()
    lines.push(`import { ${sortedSchemas.join(', ')} } from '${options.schemaImportPath}'`)
  }

  // When a custom error body type with an import path is configured, emit the import.
  // The 'laravel' value uses a built-in type emitted inline and needs no import.
  if (
    options?.errorBodyType !== undefined &&
    options.errorBodyType !== 'laravel' &&
    options.errorBodyTypeImport !== undefined
  ) {
    lines.push(`import type { ${options.errorBodyType} } from '${options.errorBodyTypeImport}'`)
  }

  lines.push('')

  // ApiError class — generic so callers can type-narrow caught errors.
  // Default type params (number, unknown) preserve full back-compat.
  lines.push(
    `export class ApiError<Status extends number = number, Body = unknown> extends Error {`
  )
  lines.push(`  constructor(`)
  lines.push(`    public readonly status: Status,`)
  lines.push(`    public readonly body: Body,`)
  lines.push(`  ) {`)
  lines.push(`    super(\`API error \${status}\`)`)
  lines.push(`    this.name = 'ApiError'`)
  lines.push(`  }`)
  lines.push(`}`)

  // When error_body_type is 'laravel', emit the built-in LaravelValidationError type
  // immediately after ApiError so it is available for the typed error body cast.
  if (options?.errorBodyType === 'laravel') {
    lines.push(``)
    lines.push(`export type LaravelValidationError = {`)
    lines.push(`  message: string`)
    lines.push(`  errors: Record<string, string[]>`)
    lines.push(`}`)
  }

  // Shared private request helpers — emitted once, called by every endpoint function.
  // Code inside the helpers is feature-conditional: only emit auth/credentials/extraHeaders
  // when the spec actually declares those features.
  if (hasAnyEndpoints) {
    // Resolve the actual TS type name for the error body cast.
    // 'laravel' is a config shorthand for the built-in LaravelValidationError type.
    const resolvedErrorBodyType =
      options?.errorBodyType === 'laravel' ? 'LaravelValidationError' : options?.errorBodyType
    const helperFeatures: HelperFeatures = {
      authSchemes: detectAuthSchemes(spec),
      hasCookieAuth: hasCookieAuth(spec),
      hasHeaderParams: hasHeaderParamEndpoints,
      hasMultipart: hasMultipartEndpoints,
      hasFormUrlencoded: hasFormUrlencodedEndpoints,
      errorBodyType: resolvedErrorBodyType,
    }
    lines.push('')
    lines.push(generateRequestHelpers(helperFeatures))
  }

  for (const fn of functionBlocks) {
    lines.push('')
    lines.push(fn)
  }

  lines.push('')

  return {
    filename: 'client.ts',
    content: lines.join('\n'),
  }
}
