import type { OpenAPIV3_1 } from 'openapi-types'

type SchemaObject = OpenAPIV3_1.SchemaObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type SchemaOrRef = SchemaObject | ReferenceObject

export interface HandlerGenOptions {
  /** Seed for faker.seed(), default 42 */
  seed: number
  /** Max array length in generated mock data, default 3 */
  maxArrayItems: number
  /**
   * Max schema recursion depth before emitting null. Counts $ref hops and
   * allOf/anyOf/oneOf resolution steps. Default: 30.
   */
  depthCap: number
}

export interface GeneratedFile {
  filename: string
  content: string
}

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type SupportedMethod = (typeof SUPPORTED_METHODS)[number]

// ── Helpers ────────────────────────────────────────────────────────────────────

function isRef(obj: unknown): obj is ReferenceObject {
  return typeof obj === 'object' && obj !== null && '$ref' in obj
}

function refName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? 'Unknown'
}

/** Convert OpenAPI {param} path params to MSW :param colon style */
function toMswPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1')
}

// ── Schema resolution ──────────────────────────────────────────────────────────

function resolveRef(ref: string, schemas: Record<string, SchemaOrRef>): SchemaObject | undefined {
  const name = refName(ref)
  const resolved = schemas[name]
  if (resolved === undefined) return undefined
  if (isRef(resolved)) return resolveRef(resolved.$ref, schemas)
  return resolved
}

function resolveSchema(
  schemaOrRef: SchemaOrRef,
  schemas: Record<string, SchemaOrRef>
): SchemaObject | undefined {
  if (isRef(schemaOrRef)) return resolveRef(schemaOrRef.$ref, schemas)
  return schemaOrRef
}

// ── Faker expression builders ──────────────────────────────────────────────────

function fakerEnum(values: unknown[]): string {
  const literals = values.map((v) => JSON.stringify(v)).join(', ')
  return `faker.helpers.arrayElement([${literals}])`
}

function fakerString(schema: SchemaObject): string {
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return fakerEnum(schema.enum)
  }
  const fmt = schema.format
  if (fmt === 'email') return 'faker.internet.email()'
  if (fmt === 'uuid') return 'faker.string.uuid()'
  if (fmt === 'date-time') return 'faker.date.recent().toISOString()'
  if (fmt === 'date') return 'faker.date.recent().toISOString().slice(0, 10)'
  if (fmt === 'uri' || fmt === 'url') return 'faker.internet.url()'
  return 'faker.lorem.word()'
}

function fakerNumber(schema: SchemaObject): string {
  const isInt = schema.type === 'integer' || schema.format === 'int32' || schema.format === 'int64'
  if (isInt) return 'faker.number.int({ min: 1, max: 1000 })'
  return 'faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })'
}

function fakerArray(
  schema: SchemaObject,
  schemas: Record<string, SchemaOrRef>,
  visited: Set<string>,
  depth: number,
  maxItems: number,
  depthCap: number
): string {
  const arraySchema = schema as OpenAPIV3_1.ArraySchemaObject
  // Pass depth unchanged: array nesting does not count toward $ref depth
  const itemExpr = schemaToFaker(
    arraySchema.items ?? {},
    schemas,
    visited,
    depth,
    maxItems,
    depthCap
  )
  return `Array.from({ length: ${maxItems} }, () => (${itemExpr}))`
}

function mergeAllOf(allOf: SchemaOrRef[], schemas: Record<string, SchemaOrRef>): SchemaObject {
  const merged: SchemaObject = { type: 'object', properties: {}, required: [] }
  for (const member of allOf) {
    const resolved = resolveSchema(member, schemas)
    if (resolved === undefined) continue
    if (resolved.properties !== undefined) {
      Object.assign(merged.properties!, resolved.properties)
    }
    if (resolved.required !== undefined) {
      ;(merged.required as string[]).push(...resolved.required)
    }
  }
  return merged
}

function fakerObjectProperties(
  properties: Record<string, SchemaOrRef>,
  schemas: Record<string, SchemaOrRef>,
  visited: Set<string>,
  depth: number,
  maxItems: number,
  depthCap: number
): string {
  const entries = Object.entries(properties).map(([key, propSchema]) => {
    // Pass depth unchanged: property access does not count toward $ref depth
    const expr = schemaToFaker(propSchema, schemas, visited, depth, maxItems, depthCap)
    return `${JSON.stringify(key)}: (${expr})`
  })
  return `{ ${entries.join(', ')} }`
}

function fakerObject(
  schema: SchemaObject,
  schemas: Record<string, SchemaOrRef>,
  visited: Set<string>,
  depth: number,
  maxItems: number,
  depthCap: number
): string {
  if (schema.properties !== undefined && Object.keys(schema.properties).length > 0) {
    return fakerObjectProperties(schema.properties, schemas, visited, depth, maxItems, depthCap)
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    const valueSchema =
      typeof schema.additionalProperties === 'boolean' ? {} : schema.additionalProperties
    // Pass depth unchanged
    const valueExpr = schemaToFaker(valueSchema, schemas, visited, depth, maxItems, depthCap)
    return `Object.fromEntries(Array.from({ length: 2 }, () => [faker.lorem.word(), (${valueExpr})]))`
  }
  return '{}'
}

function firstConcreteSchema(
  members: SchemaOrRef[],
  schemas: Record<string, SchemaOrRef>
): SchemaOrRef {
  for (const member of members) {
    if (!isRef(member)) return member
  }
  // All are refs; return the first resolved
  const first = members[0]
  if (first === undefined) return {}
  const resolved = resolveSchema(first, schemas)
  return resolved ?? {}
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function schemaToFaker(
  schemaOrRef: SchemaOrRef,
  schemas: Record<string, SchemaOrRef>,
  visited: Set<string>,
  depth: number,
  maxItems: number,
  depthCap: number
): string {
  if (depth > depthCap) return 'null /* depth cap reached */'

  if (isRef(schemaOrRef)) {
    const name = refName(schemaOrRef.$ref)
    if (visited.has(name)) return 'null /* circular ref: depth cap reached */'
    const newVisited = new Set(visited)
    newVisited.add(name)
    const resolved = resolveRef(schemaOrRef.$ref, schemas)
    if (resolved === undefined) return 'null'
    // Only increment depth on $ref resolution to track schema reference chain depth
    return schemaToFaker(resolved, schemas, newVisited, depth + 1, maxItems, depthCap)
  }

  const schema = schemaOrRef

  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const merged = mergeAllOf(schema.allOf, schemas)
    // Increment depth for allOf/anyOf/oneOf to prevent inline schema cycles
    return schemaToFaker(merged, schemas, visited, depth + 1, maxItems, depthCap)
  }

  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    const concrete = firstConcreteSchema(schema.anyOf, schemas)
    return schemaToFaker(concrete, schemas, visited, depth + 1, maxItems, depthCap)
  }

  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    const concrete = firstConcreteSchema(schema.oneOf, schemas)
    return schemaToFaker(concrete, schemas, visited, depth + 1, maxItems, depthCap)
  }

  if (schema.enum !== undefined && schema.enum.length > 0) {
    return fakerEnum(schema.enum)
  }

  const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type

  if (rawType === 'string') return fakerString(schema)
  if (rawType === 'integer' || rawType === 'number') return fakerNumber(schema)
  if (rawType === 'boolean') return 'faker.datatype.boolean()'
  if (rawType === 'null') return 'null'
  if (rawType === 'array') return fakerArray(schema, schemas, visited, depth, maxItems, depthCap)
  if (rawType === 'object') return fakerObject(schema, schemas, visited, depth, maxItems, depthCap)

  // No type hint: fall back to object if properties present, else null
  if (schema.properties !== undefined) {
    return fakerObject(schema, schemas, visited, depth, maxItems, depthCap)
  }
  return 'null'
}

// ── Response extraction ────────────────────────────────────────────────────────

interface ResponseBody {
  schema: SchemaOrRef
  statusCode: number
}

/** Extract JSON schema from a single response object, or null if none present. */
function extractResponseSchema(
  resp: OpenAPIV3_1.ResponseObject | OpenAPIV3_1.ReferenceObject | undefined,
  code: string
): ResponseBody | null {
  if (resp === undefined || isRef(resp)) return null
  const schema = resp.content?.['application/json']?.schema
  if (schema === undefined) return null
  return { schema, statusCode: Number(code) }
}

/** True when the response has content but no application/json body (e.g. text/plain, octet-stream). */
function hasNonJsonBody(
  resp: OpenAPIV3_1.ResponseObject | OpenAPIV3_1.ReferenceObject | undefined
): boolean {
  if (resp === undefined || isRef(resp)) return false
  const content = resp.content
  if (content === undefined || Object.keys(content).length === 0) return false
  return content['application/json'] === undefined
}

/** Try preferred 2xx status codes (200, 201) first. */
function findPreferredResponse(responses: OpenAPIV3_1.ResponsesObject): ResponseBody | null {
  for (const code of ['200', '201']) {
    const result = extractResponseSchema(responses[code], code)
    if (result !== null) return result
  }
  return null
}

/** Scan all responses for any 2xx with a JSON body. */
function findAny2xxResponse(responses: OpenAPIV3_1.ResponsesObject): ResponseBody | null {
  for (const [code, resp] of Object.entries(responses)) {
    const num = Number(code)
    if (num < 200 || num >= 300) continue
    const result = extractResponseSchema(resp, code)
    if (result !== null) return result
  }
  return null
}

function find2xxResponse(responses: OpenAPIV3_1.ResponsesObject): ResponseBody | null {
  return findPreferredResponse(responses) ?? findAny2xxResponse(responses)
}

/** Find the status code of the first 2xx response, with or without a body. */
function noBodyStatus(responses: OpenAPIV3_1.ResponsesObject): number {
  for (const code of Object.keys(responses)) {
    const num = Number(code)
    if (num >= 200 && num < 300) return num
  }
  return 204
}

/** True when no 2xx response has a JSON body but at least one has non-JSON content. */
function is2xxNonJsonBody(responses: OpenAPIV3_1.ResponsesObject): boolean {
  for (const [code, resp] of Object.entries(responses)) {
    const num = Number(code)
    if (num < 200 || num >= 300) continue
    if (hasNonJsonBody(resp)) return true
  }
  return false
}

// ── Handler emission ───────────────────────────────────────────────────────────

function buildHandlerLine(
  method: SupportedMethod,
  path: string,
  responses: OpenAPIV3_1.ResponsesObject,
  schemas: Record<string, SchemaOrRef>,
  opts: HandlerGenOptions
): string {
  const mswPath = toMswPath(path)
  const responseBody = find2xxResponse(responses)

  if (responseBody === null) {
    const status = noBodyStatus(responses)
    // Use new HttpResponse() for non-JSON content types to avoid claiming application/json
    if (is2xxNonJsonBody(responses)) {
      return `http.${method}('${mswPath}', () => new HttpResponse(null, { status: ${status} }))`
    }
    return `http.${method}('${mswPath}', () => HttpResponse.json(null, { status: ${status} }))`
  }

  const bodyExpr = schemaToFaker(
    responseBody.schema,
    schemas,
    new Set(),
    0,
    opts.maxArrayItems,
    opts.depthCap
  )
  const needsStatus = responseBody.statusCode !== 200
  if (needsStatus) {
    return `http.${method}('${mswPath}', () => HttpResponse.json(${bodyExpr}, { status: ${responseBody.statusCode} }))`
  }
  return `http.${method}('${mswPath}', () => HttpResponse.json(${bodyExpr}))`
}

/** Collect handler lines for all operations in a single path item. */
function buildPathHandlerLines(
  path: string,
  pathItem: OpenAPIV3_1.PathItemObject,
  schemas: Record<string, SchemaOrRef>,
  opts: HandlerGenOptions
): string[] {
  const lines: string[] = []
  for (const method of SUPPORTED_METHODS) {
    const operation = (pathItem as Record<string, unknown>)[method] as
      OpenAPIV3_1.OperationObject | undefined
    if (operation === undefined) continue
    const responses = operation.responses
    if (responses === undefined) continue
    lines.push(buildHandlerLine(method, path, responses, schemas, opts))
  }
  return lines
}

// ── Entry point ────────────────────────────────────────────────────────────────

export function generateHandlers(
  spec: OpenAPIV3_1.Document,
  opts: HandlerGenOptions
): GeneratedFile {
  const schemas = (spec.components?.schemas ?? {}) as Record<string, SchemaOrRef>
  const paths = spec.paths ?? {}
  const lines: string[] = []

  for (const [path, pathItem] of Object.entries(paths)) {
    if (pathItem === undefined) continue
    lines.push(...buildPathHandlerLines(path, pathItem, schemas, opts))
  }

  const content = [
    `// This file is auto-generated by @codewithagents/openapi-msw, do not edit`,
    `import { http, HttpResponse } from 'msw'`,
    `import { faker } from '@faker-js/faker'`,
    ``,
    `faker.seed(${opts.seed})`,
    ``,
    `export const handlers = [`,
    ...lines.map((l) => `  ${l},`),
    `]`,
  ].join('\n')

  return { filename: 'handlers.ts', content }
}
