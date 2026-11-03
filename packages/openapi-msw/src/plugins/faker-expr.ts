/**
 * Faker expression builder shared by handlers.ts (response bodies) and fixtures.ts
 * (per-schema fixture builders). Turns an OpenAPI schema into the TypeScript source of an
 * expression that produces a matching value at runtime via a `faker` identifier in scope.
 */
import type { OpenAPIV3_1 } from 'openapi-types'

type SchemaObject = OpenAPIV3_1.SchemaObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
export type SchemaOrRef = SchemaObject | ReferenceObject

export interface FakerExprContext {
  /** components.schemas of the spec, used to resolve $refs */
  schemas: Record<string, SchemaOrRef>
  /** Array length in generated values */
  maxItems: number
  /** Max recursion depth ($ref hops + allOf/anyOf/oneOf steps) before emitting null */
  depthCap: number
  /** Omit object properties that are not listed in `required` (default: emit all) */
  requiredOnly?: boolean
  /** Omit `writeOnly` properties, matching the read-shape model type (default: emit all) */
  omitWriteOnly?: boolean
  /**
   * Optional hook for $refs to component schemas: return an expression to use instead of
   * inlining the referenced schema (fixtures.ts calls the referenced builder), or
   * undefined to inline as usual.
   */
  refExpr?: (schemaName: string) => string | undefined
}

const UNSAFE_LITERAL_CHARS: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\u0000',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/**
 * Serialise a spec-derived value (enum value, property key, path, import specifier) as a
 * JS literal for generated source. JSON.stringify escapes quotes and backslashes; the extra
 * pass escapes line terminators and angle brackets so no spec content can terminate the
 * literal or the surrounding code, whatever context the generated file ends up in.
 */
export function toJsLiteral(value: unknown): string {
  return (JSON.stringify(value) ?? 'undefined').replace(
    /[<>\b\f\n\r\t\0\u2028\u2029]/g,
    (ch) => UNSAFE_LITERAL_CHARS[ch] ?? ch
  )
}

/** String literal for generated source (see toJsLiteral). */
export function quote(value: string): string {
  return toJsLiteral(value)
}

// ── Schema resolution ──────────────────────────────────────────────────────────

export function isRef(obj: unknown): obj is ReferenceObject {
  return typeof obj === 'object' && obj !== null && '$ref' in obj
}

function refName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] ?? 'Unknown'
}

function resolveRef(ref: string, schemas: Record<string, SchemaOrRef>): SchemaObject | undefined {
  const name = refName(ref)
  const resolved = schemas[name]
  if (resolved === undefined) return undefined
  if (isRef(resolved)) return resolveRef(resolved.$ref, schemas)
  return resolved
}

export function resolveSchema(
  schemaOrRef: SchemaOrRef,
  schemas: Record<string, SchemaOrRef>
): SchemaObject | undefined {
  if (isRef(schemaOrRef)) return resolveRef(schemaOrRef.$ref, schemas)
  return schemaOrRef
}

// ── Faker expression builders ──────────────────────────────────────────────────

function fakerEnum(values: unknown[]): string {
  const literals = values.map((v) => toJsLiteral(v)).join(', ')
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
  ctx: FakerExprContext,
  visited: Set<string>,
  depth: number
): string {
  const arraySchema = schema as OpenAPIV3_1.ArraySchemaObject
  // Pass depth unchanged: array nesting does not count toward $ref depth
  const itemExpr = schemaToFaker(arraySchema.items ?? {}, ctx, visited, depth)
  return `Array.from({ length: ${ctx.maxItems} }, () => (${itemExpr}))`
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

/** True when a property should be left out of the generated object for this context. */
function isOmitted(
  key: string,
  propSchema: SchemaOrRef,
  required: ReadonlySet<string>,
  ctx: FakerExprContext
): boolean {
  if (ctx.requiredOnly === true && !required.has(key)) return true
  return ctx.omitWriteOnly === true && !isRef(propSchema) && propSchema.writeOnly === true
}

function fakerObjectProperties(
  schema: SchemaObject,
  ctx: FakerExprContext,
  visited: Set<string>,
  depth: number
): string {
  const required = new Set(schema.required ?? [])
  const entries: string[] = []
  for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
    if (isOmitted(key, propSchema, required, ctx)) continue
    // Pass depth unchanged: property access does not count toward $ref depth
    const expr = schemaToFaker(propSchema, ctx, visited, depth)
    entries.push(`${toJsLiteral(key)}: (${expr})`)
  }
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`
}

function fakerObject(
  schema: SchemaObject,
  ctx: FakerExprContext,
  visited: Set<string>,
  depth: number
): string {
  if (schema.properties !== undefined && Object.keys(schema.properties).length > 0) {
    return fakerObjectProperties(schema, ctx, visited, depth)
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    const valueSchema =
      typeof schema.additionalProperties === 'boolean' ? {} : schema.additionalProperties
    // Pass depth unchanged
    const valueExpr = schemaToFaker(valueSchema, ctx, visited, depth)
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

/**
 * Build the faker expression source for a schema.
 *
 * @param visited - schema names already on the $ref chain (a repeat emits a circular-ref null)
 * @param depth - current $ref / composition depth, compared against ctx.depthCap
 */
// fallow-ignore-next-line complexity
export function schemaToFaker(
  schemaOrRef: SchemaOrRef,
  ctx: FakerExprContext,
  visited: Set<string> = new Set(),
  depth = 0
): string {
  if (depth > ctx.depthCap) return 'null /* depth cap reached */'

  if (isRef(schemaOrRef)) {
    const name = refName(schemaOrRef.$ref)
    if (visited.has(name)) return 'null /* circular ref: depth cap reached */'
    const delegated = ctx.refExpr?.(name)
    if (delegated !== undefined) return delegated
    const newVisited = new Set(visited)
    newVisited.add(name)
    const resolved = resolveRef(schemaOrRef.$ref, ctx.schemas)
    if (resolved === undefined) return 'null'
    // Only increment depth on $ref resolution to track schema reference chain depth
    return schemaToFaker(resolved, ctx, newVisited, depth + 1)
  }

  const schema = schemaOrRef

  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const merged = mergeAllOf(schema.allOf, ctx.schemas)
    // Increment depth for allOf/anyOf/oneOf to prevent inline schema cycles
    return schemaToFaker(merged, ctx, visited, depth + 1)
  }

  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    const concrete = firstConcreteSchema(schema.anyOf, ctx.schemas)
    return schemaToFaker(concrete, ctx, visited, depth + 1)
  }

  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    const concrete = firstConcreteSchema(schema.oneOf, ctx.schemas)
    return schemaToFaker(concrete, ctx, visited, depth + 1)
  }

  if (schema.enum !== undefined && schema.enum.length > 0) {
    return fakerEnum(schema.enum)
  }

  const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type

  if (rawType === 'string') return fakerString(schema)
  if (rawType === 'integer' || rawType === 'number') return fakerNumber(schema)
  if (rawType === 'boolean') return 'faker.datatype.boolean()'
  if (rawType === 'null') return 'null'
  if (rawType === 'array') return fakerArray(schema, ctx, visited, depth)
  if (rawType === 'object') return fakerObject(schema, ctx, visited, depth)

  // No type hint: fall back to object if properties present, else null
  if (schema.properties !== undefined) {
    return fakerObject(schema, ctx, visited, depth)
  }
  return 'null'
}
