import type { OpenAPIV3_1 } from 'openapi-types'
import { toPropertyKey, toTypeName, uniquifyName } from '../utils/naming.js'
import { findRecursiveSchemaNames } from '../utils/recursive-schemas.js'
import type { GeneratedFile } from './types.js'

type OperationObject = OpenAPIV3_1.OperationObject
type SchemaObject = OpenAPIV3_1.SchemaObject
type ArraySchemaObject = OpenAPIV3_1.ArraySchemaObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject

function isRef(schema: SchemaObject | ReferenceObject): schema is ReferenceObject {
  return '$ref' in schema
}

function refToSchemaName(ref: string): string {
  // '#/components/schemas/Foo' -> 'FooSchema' (sanitized to a valid TS identifier)
  const parts = ref.split('/')
  return `${toTypeName(parts[parts.length - 1]!)}Schema`
}

function refToTypeName(ref: string): string {
  // '#/components/schemas/Foo' -> 'Foo' (sanitized to a valid TS identifier)
  const parts = ref.split('/')
  return toTypeName(parts[parts.length - 1]!)
}

/**
 * Serialize a JSON value as a TypeScript literal expression.
 * Used for `default` and `const` values.
 */
function serializeLiteral(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Arrays and objects: use JSON.stringify (produces valid JS literal)
  return JSON.stringify(value)
}

/**
 * Return the Zod v4 base expression for a primitive type.
 * For integer with format int64, returns z.number() instead of z.bigint() because
 * JSON.stringify throws on bigint values and JSON.parse never produces bigint. Precision
 * is limited to 2^53-1 (JS Number.MAX_SAFE_INTEGER) for int64 fields.
 */
function primitiveToZod(type: string, format?: string): string {
  switch (type) {
    case 'string':
      return 'z.string()'
    case 'number':
      return 'z.number()'
    case 'integer':
      return format === 'int64' ? 'z.number()' : 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'null':
      return 'z.null()'
    default:
      return 'z.unknown()'
  }
}

/**
 * Return the Zod v4 base for a string schema, using top-level format validators
 * (z.email(), z.url(), z.uuid(), z.iso.datetime(), z.iso.date()) where applicable.
 * These are the Zod v4 equivalents of the deprecated chained .email()/.url()/.uuid() methods.
 * byte/binary formats stay as z.string() (no runtime validation, correct base type).
 */
function stringBase(format: string | undefined): string {
  switch (format) {
    case 'email':
      return 'z.email()'
    case 'url':
      return 'z.url()'
    case 'uuid':
      return 'z.uuid()'
    case 'date-time':
      return 'z.iso.datetime()'
    case 'date':
      return 'z.iso.date()'
    default:
      return 'z.string()'
  }
}

/**
 * Chain OpenAPI string constraints (minLength, maxLength, pattern) onto a base Zod string
 * expression. Format-based validators are handled in stringBase() instead.
 */
function applyStringConstraints(base: string, schema: SchemaObject): string {
  let s = base
  if (typeof schema.minLength === 'number') s += `.min(${schema.minLength})`
  if (typeof schema.maxLength === 'number') s += `.max(${schema.maxLength})`
  if (typeof schema.pattern === 'string')
    s += `.regex(new RegExp(${JSON.stringify(schema.pattern)}))`
  return s
}

/** Return full Zod expression for a string schema (base + constraints). */
function stringSchemaExpr(schema: SchemaObject): string {
  const format = schema.format as string | undefined
  const base = stringBase(format)
  return applyStringConstraints(base, schema)
}

/** Chain OpenAPI numeric range constraints and multipleOf onto a Zod number expression. */
function applyNumberConstraints(base: string, schema: SchemaObject): string {
  let s = base
  const min =
    schema.minimum ??
    (typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined)
  const max =
    schema.maximum ??
    (typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined)
  if (typeof min === 'number') s += `.min(${min})`
  if (typeof max === 'number') s += `.max(${max})`
  if (typeof schema.multipleOf === 'number') s += `.multipleOf(${schema.multipleOf})`
  return s
}

/** Handle a $ref schema by returning the referenced schema variable name. */
function refToZod(schema: ReferenceObject): string {
  return refToSchemaName(schema.$ref)
}

/**
 * Handle the `const` keyword: single fixed value -> z.literal(value).
 * Returns null when no `const` is present (caller continues dispatch).
 * Must be checked before type/enum handling (const overrides type in JSON Schema).
 */
function constToZod(schema: SchemaObject): string | null {
  const constVal = (schema as SchemaObject & { const?: unknown }).const
  if (constVal === undefined) return null
  return `z.literal(${serializeLiteral(constVal)})`
}

/**
 * Handle OpenAPI 3.1 array-of-types: type: ['string', 'null'].
 * Single non-null type becomes base.nullable() when null is in the array.
 * Multiple types produce z.union([...]).
 */
function arrayTypeToZod(schema: SchemaObject): string {
  const types = schema.type as string[]
  const isNullable = types.includes('null')
  const nonNull = types.filter((t) => t !== 'null')
  if (nonNull.length === 1) {
    let base: string
    if (nonNull[0] === 'string') {
      base = stringSchemaExpr(schema)
    } else if (nonNull[0] === 'integer') {
      base = primitiveToZod('integer', schema.format as string | undefined)
      base = applyNumberConstraints(base, schema)
    } else if (nonNull[0] === 'number') {
      base = primitiveToZod('number')
      base = applyNumberConstraints(base, schema)
    } else if (nonNull[0] === 'array') {
      base = arraySchemaToZodBase(schema)
    } else if (nonNull[0] === 'object') {
      base = objectSchemaToZodBase(schema)
    } else {
      base = primitiveToZod(nonNull[0]!)
    }
    const expr = isNullable ? `${base}.nullable()` : base
    return applyDefault(expr, schema)
  }
  const parts = types.map((t) => {
    if (t === 'null') return 'z.null()'
    if (t === 'array') return arraySchemaToZodBase(schema)
    if (t === 'object') return objectSchemaToZodBase(schema)
    return primitiveToZod(t)
  })
  return applyDefault(`z.union([${parts.join(', ')}])`, schema)
}

/**
 * Handle `enum` schemas.
 * String enums use z.enum([...]).
 * Mixed/number/integer enums use z.union([z.literal(...), ...]).
 * Use JSON.stringify to produce double-quoted strings, safe for values with apostrophes ("won't fix").
 * Cast null values to string "null" - some specs mix null with string enums (technically invalid OpenAPI
 * but common in practice, e.g. GitHub's dismissed_reason: [null, "false positive", "won't fix"]).
 * Non-primitive values (objects, arrays) are widened to z.unknown() - no valid Zod literal exists.
 */
function enumToZod(schema: SchemaObject): string {
  if (schema.type === 'string') {
    const vals = (schema.enum as (string | null)[])
      .map((v) => JSON.stringify(v ?? 'null'))
      .join(', ')
    return applyDefault(`z.enum([${vals}])`, schema)
  }
  const literals = (schema.enum as unknown[])
    .map((v) => {
      if (typeof v === 'string') return `z.literal(${JSON.stringify(v)})`
      if (v === null) return `z.literal(null)`
      if (typeof v === 'number' || typeof v === 'boolean') return `z.literal(${String(v)})`
      return 'z.unknown()' // object or array enum value - no valid Zod literal representation
    })
    .join(', ')
  return applyDefault(`z.union([${literals}])`, schema)
}

/**
 * Handle allOf/anyOf/oneOf composite schemas.
 * allOf chains members with .and(), merging any sibling properties as an extra intersection member.
 * anyOf and oneOf both produce z.union([...]).
 */
function compositeToZod(schema: SchemaObject): string {
  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const parts = (schema.allOf as (SchemaObject | ReferenceObject)[]).map(schemaToZod)
    // Sibling properties outside the allOf array must be merged in as an extra intersection member
    const siblingProps = schema.properties as
      Record<string, SchemaObject | ReferenceObject> | undefined
    if (siblingProps !== undefined && Object.keys(siblingProps).length > 0) {
      parts.push(inlineObjectZod(schema))
    }
    if (parts.length === 1) return parts[0]!
    return parts.slice(1).reduce((acc, part) => `${acc}.and(${part})`, parts[0]!)
  }
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    const parts = (schema.anyOf as (SchemaObject | ReferenceObject)[]).map(schemaToZod)
    return `z.union([${parts.join(', ')}])`
  }
  // oneOf -> z.union([...])
  const parts = (schema.oneOf as (SchemaObject | ReferenceObject)[]).map(schemaToZod)
  return `z.union([${parts.join(', ')}])`
}

/**
 * Build the raw Zod array/tuple expression for a schema without applying `.default()`.
 * Called by both arraySchemaToZod (which applies default) and arrayTypeToZod (which
 * applies nullable + default itself, so default must not be applied here).
 */
function arraySchemaToZodBase(schema: SchemaObject): string {
  const arraySchema = schema as unknown as ArraySchemaObject

  // prefixItems (OpenAPI 3.1 / JSON Schema 2020-12): fixed-position tuple elements
  const prefixItems = (
    schema as SchemaObject & { prefixItems?: (SchemaObject | ReferenceObject)[] }
  ).prefixItems
  if (prefixItems !== undefined && prefixItems.length > 0) {
    const tupleElements = prefixItems.map((item) => schemaToZod(item))
    let base = `z.tuple([${tupleElements.join(', ')}])`
    // items after prefixItems is the rest type in JSON Schema 2020-12
    const restItems = arraySchema.items as SchemaObject | ReferenceObject | undefined
    if (restItems !== undefined) {
      base += `.rest(${schemaToZod(restItems)})`
    }
    return base
  }

  const items = arraySchema.items as SchemaObject | ReferenceObject | undefined
  let base: string
  if (items !== undefined) {
    base = `z.array(${schemaToZod(items)})`
  } else {
    base = 'z.array(z.unknown())'
  }
  if (typeof schema.minItems === 'number') base += `.min(${schema.minItems})`
  if (typeof schema.maxItems === 'number') base += `.max(${schema.maxItems})`
  // uniqueItems: refine to enforce distinct values at runtime
  if ((schema as SchemaObject & { uniqueItems?: boolean }).uniqueItems === true) {
    base += `.refine((a) => new Set(a).size === a.length, { message: 'Items must be unique' })`
  }
  return base
}

/**
 * Handle `type: 'array'` schemas.
 * Supports prefixItems (OpenAPI 3.1 / JSON Schema 2020-12 tuples), plain arrays,
 * and array constraints (minItems, maxItems, uniqueItems).
 */
function arraySchemaToZod(schema: SchemaObject): string {
  return applyDefault(arraySchemaToZodBase(schema), schema)
}

/**
 * Build the raw Zod object/record expression for a schema without applying `.default()`.
 * Called by both objectSchemaToZod (which applies default) and arrayTypeToZod (which
 * applies nullable + default itself, so default must not be applied here).
 */
function objectSchemaToZodBase(schema: SchemaObject): string {
  // additionalProperties only (no explicit properties) -> z.record()
  if (
    schema.additionalProperties !== undefined &&
    schema.additionalProperties !== false &&
    schema.additionalProperties !== true &&
    (schema.properties === undefined || Object.keys(schema.properties).length === 0)
  ) {
    const valZod = schemaToZod(schema.additionalProperties as SchemaObject | ReferenceObject)
    return `z.record(z.string(), ${valZod})`
  }

  if (schema.properties !== undefined && Object.keys(schema.properties).length > 0) {
    return inlineObjectZod(schema)
  }

  return 'z.record(z.string(), z.unknown())'
}

/**
 * Handle `type: 'object'` schemas.
 * Delegates to z.record() for additionalProperties-only objects,
 * inlineObjectZod() for objects with explicit properties,
 * and z.record(z.string(), z.unknown()) as the open-object fallback.
 */
function objectSchemaToZod(schema: SchemaObject): string {
  return applyDefault(objectSchemaToZodBase(schema), schema)
}

/**
 * Handle scalar primitive types: string, integer, number, boolean, null.
 * Applies format-based specialisation (stringSchemaExpr, numeric constraints) and
 * string/numeric constraints before returning the Zod expression.
 */
function primitiveTypeToZod(schema: SchemaObject): string {
  const type = schema.type as string
  let base: string
  if (type === 'string') {
    base = stringSchemaExpr(schema)
  } else if (type === 'integer') {
    base = primitiveToZod('integer', schema.format as string | undefined)
    base = applyNumberConstraints(base, schema)
  } else if (type === 'number') {
    base = primitiveToZod('number')
    base = applyNumberConstraints(base, schema)
  } else {
    base = primitiveToZod(type)
  }
  return applyDefault(base, schema)
}

// fallow-ignore-next-line complexity
function schemaToZod(schema: SchemaObject | ReferenceObject): string {
  if (isRef(schema)) return refToZod(schema)

  // const keyword must be checked before type/enum handling (const overrides type in JSON Schema)
  const constExpr = constToZod(schema)
  if (constExpr !== null) return constExpr

  // OpenAPI 3.1 array-of-types: type: ['string', 'null']
  if (Array.isArray(schema.type)) return arrayTypeToZod(schema)

  // enum handling (string enum first, then mixed)
  if (schema.enum !== undefined && schema.enum.length > 0) return enumToZod(schema)

  // composite: allOf / anyOf / oneOf
  if (
    (schema.allOf !== undefined && schema.allOf.length > 0) ||
    (schema.anyOf !== undefined && schema.anyOf.length > 0) ||
    (schema.oneOf !== undefined && schema.oneOf.length > 0)
  ) {
    return compositeToZod(schema)
  }

  const type = schema.type as string | undefined
  if (type === 'array') return arraySchemaToZod(schema)
  if (type === 'object') return objectSchemaToZod(schema)
  if (type !== undefined) return primitiveTypeToZod(schema)

  return 'z.unknown()'
}

/**
 * If the schema has a `default` value, append `.default(value)` to the zod expression.
 * Skips if the expression already ends with a complex refine (for readability).
 */
function applyDefault(expr: string, schema: SchemaObject): string {
  if (schema.default === undefined) return expr
  return `${expr}.default(${serializeLiteral(schema.default)})`
}

function inlineObjectZod(schema: SchemaObject): string {
  const required = new Set<string>(schema.required ?? [])
  const props = schema.properties as Record<string, SchemaObject | ReferenceObject>
  const lines = Object.entries(props).map(([key, propSchema]) => {
    const propKey = toPropertyKey(key)
    const zodStr = schemaToZod(propSchema)
    const suffix = required.has(key) ? '' : '.optional()'
    return `  ${propKey}: ${zodStr}${suffix}`
  })
  // additionalProperties: false means no extra keys are allowed -> use .strict()
  // otherwise use .passthrough() to keep unknown server fields (forward-compatible)
  const tail = schema.additionalProperties === false ? '.strict()' : '.passthrough()'
  return `z.object({\n${lines.join(',\n')}\n})${tail}`
}

/** Collect all #/components/schemas/ ref names reachable from a schema tree. */
function collectRefsInto(schema: SchemaObject | ReferenceObject, out: Set<string>): void {
  if (isRef(schema)) {
    if (schema.$ref.startsWith('#/components/schemas/')) {
      out.add(refToTypeName(schema.$ref))
    }
    return
  }

  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const list = schema[key] as (SchemaObject | ReferenceObject)[] | undefined
    if (list !== undefined) {
      for (const item of list) collectRefsInto(item, out)
    }
  }

  if (schema.properties !== undefined) {
    for (const propSchema of Object.values(
      schema.properties as Record<string, SchemaObject | ReferenceObject>
    )) {
      collectRefsInto(propSchema, out)
    }
  }

  const items = (schema as unknown as ArraySchemaObject).items
  if (items !== undefined) collectRefsInto(items as SchemaObject | ReferenceObject, out)

  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties === 'object'
  ) {
    collectRefsInto(schema.additionalProperties as SchemaObject | ReferenceObject, out)
  }
}

/**
 * Topologically sort schemas so dependencies (referenced schemas) are emitted
 * before the schemas that reference them.
 *
 * Returns { sorted, cyclic } where:
 * - sorted: all schema names in a safe emission order
 * - cyclic: names that are part of a dependency cycle (appended at the end of sorted)
 */
function topoSortSchemas(schemas: Record<string, SchemaObject | ReferenceObject>): {
  sorted: string[]
  cyclic: Set<string>
} {
  const names = Object.keys(schemas)
  const knownNames = new Set(names)

  // deps[A] = set of schema names A depends on (excluding A itself)
  const deps = new Map<string, Set<string>>()
  for (const [name, schema] of Object.entries(schemas)) {
    const refs = new Set<string>()
    collectRefsInto(schema, refs)
    refs.delete(name) // self-references handled separately via z.lazy()
    deps.set(name, new Set([...refs].filter((r) => knownNames.has(r))))
  }

  // Kahn's algorithm:
  // inDegree[A] = number of not-yet-emitted schemas A depends on
  // reverseDeps[B] = schemas that depend on B (decrement their in-degree when B is emitted)
  const inDegree = new Map<string, number>()
  const reverseDeps = new Map<string, Set<string>>()

  for (const name of names) {
    inDegree.set(name, deps.get(name)!.size)
    reverseDeps.set(name, new Set())
  }
  for (const [name, depSet] of deps) {
    for (const dep of depSet) {
      reverseDeps.get(dep)!.add(name)
    }
  }

  const queue = names.filter((n) => inDegree.get(n) === 0)
  const sorted: string[] = []

  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)
    for (const dependent of reverseDeps.get(node)!) {
      const newDeg = inDegree.get(dependent)! - 1
      inDegree.set(dependent, newDeg)
      if (newDeg === 0) queue.push(dependent)
    }
  }

  const sortedSet = new Set(sorted)
  const cyclic = new Set(names.filter((n) => !sortedSet.has(n)))

  return { sorted: [...sorted, ...cyclic], cyclic }
}

function generateSchemaDeclaration(
  name: string,
  schema: SchemaObject | ReferenceObject,
  modelTypeName?: string
): string {
  // Sanitize schema name to a valid TS identifier (e.g. 'Foo-bar' -> 'FooBar')
  const safeName = toTypeName(name)

  if (modelTypeName !== undefined) {
    // Recursive (cyclic or self-referential) schema: wrap in z.lazy() so the deferred
    // reference resolves after all schema constants are declared, and cast with
    // `as z.ZodType<ModelType>` so that z.infer<typeof FooSchema> resolves to the concrete
    // model shape rather than unknown. The model type is imported type-only at the top of
    // the file and erased at runtime (no cycle).
    //
    // We use an assertion (`as`) rather than an annotation (`: z.ZodType<T> = ...`) because
    // the annotation form forces a strict assignability check that can fail for all-optional
    // recursive schemas with .passthrough() under older TypeScript or Zod versions: the
    // passthrough object infers an index signature ({ [x: string]: unknown }) that TS cannot
    // always prove assignable to the strict generated model interface in those toolchains.
    // The assertion form bypasses that check while keeping z.infer concrete and exact.
    return `export const ${safeName}Schema = z.lazy(() => ${schemaToZod(schema)}) as z.ZodType<${modelTypeName}>`
  }

  return `export const ${safeName}Schema = ${schemaToZod(schema)}`
}

// ── Inline response schema synthesis ─────────────────────────────────────────
//
// When an operation has an inline JSON response (not a $ref), we synthesize a
// named Zod schema for it. This enables openapi-server to wire schema.response
// and produce typed service return types.
//
// Naming: toTypeName(operationId) + 'Schema'
// (e.g. labInlineResponse -> LabInlineResponseSchema, labResponseUnion -> LabResponseUnionSchema)
// The operationId encodes the context; no extra suffix is needed.
//
// Multi-status: when multiple 2xx codes have inline responses, a union schema is
// emitted: LabResponseUnionSchema = z.union([...]) wrapping each code's schema.

interface InlineResponseSchema {
  /** The synthesized schema name, e.g. 'LabInlineResponse'. */
  name: string
  /** The emitted Zod declaration string (without 'export const' prefix). */
  zodDecl: string
}

function collectContentfulTwoxxResponses(
  responses: Record<string, OpenAPIV3_1.ResponseObject | ReferenceObject>
): Array<{ code: string; schema: SchemaObject }> {
  const result: Array<{ code: string; schema: SchemaObject }> = []
  for (const code of Object.keys(responses)
    .filter((k) => /^2\d\d$/.test(k) && k !== '204')
    .sort()) {
    const resp = responses[code]!
    if (isRef(resp)) continue
    const r = resp as OpenAPIV3_1.ResponseObject
    const content = r.content as
      Record<string, { schema?: SchemaObject | ReferenceObject }> | undefined
    if (content === undefined) continue
    const json = content['application/json']
    if (json === undefined || json.schema === undefined) continue
    // Skip $ref responses: they already have a named component schema.
    if (isRef(json.schema)) continue
    result.push({ code, schema: json.schema as SchemaObject })
  }
  return result
}

/**
 * Synthesize Zod schema declarations for operations with inline (non-$ref) JSON responses.
 * Returns one entry per operation that has at least one inline response schema.
 *
 * Single-code operations: export const LabInlineResponseSchema = <zodExpr>
 * Multi-code operations (multiple 2xx): export const LabResponseUnionSchema = z.union([...])
 *
 * Collision avoidance: synthesized names are deduplicated against component schema names
 * and each other using the same suffix convention as buildSchemaRenameMap (_2, _3, ...).
 * This prevents duplicate const declarations when an operationId sanitizes to the same
 * PascalCase identifier as a component schema (e.g. operationId 'Holiday' and schema
 * name 'Holiday' both sanitize to 'Holiday').
 */
// fallow-ignore-next-line complexity
function synthesizeInlineResponseSchemas(spec: OpenAPIV3_1.Document): InlineResponseSchema[] {
  const paths = spec.paths as Record<string, Record<string, OperationObject>> | undefined
  if (paths === undefined) return []

  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
  const result: InlineResponseSchema[] = []

  // Seed the taken-name set with all component schema names so synthesized names
  // never shadow a component schema (which would produce a duplicate const declaration).
  const taken = new Set<string>()
  const rawSchemas = spec.components?.schemas as
    Record<string, SchemaObject | ReferenceObject> | undefined
  if (rawSchemas !== undefined) {
    for (const name of Object.keys(rawSchemas)) {
      taken.add(toTypeName(name))
    }
  }

  for (const pathItem of Object.values(paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method] as OperationObject | undefined
      if (operation === undefined) continue

      const operationId = operation.operationId
      if (operationId === undefined || operationId.length === 0) continue

      const responses = operation.responses as
        Record<string, OpenAPIV3_1.ResponseObject | ReferenceObject> | undefined
      if (responses === undefined) continue

      const inlineResps = collectContentfulTwoxxResponses(responses)
      if (inlineResps.length === 0) continue

      // Derive a collision-free name: toTypeName(operationId) is the preferred name,
      // but if it collides with a component schema name or a prior synthesized name,
      // uniquifyName appends _2, _3, ... (same convention as buildSchemaRenameMap).
      const baseName = uniquifyName(toTypeName(operationId), taken)

      if (inlineResps.length === 1) {
        // Single inline response: emit a plain schema.
        const zodExpr = schemaToZod(inlineResps[0]!.schema)
        result.push({
          name: baseName,
          zodDecl: `${baseName}Schema = ${zodExpr}`,
        })
      } else {
        // Multiple 2xx inline responses: emit z.union([...]).
        const variants = inlineResps.map((r) => schemaToZod(r.schema))
        result.push({
          name: baseName,
          zodDecl: `${baseName}Schema = z.union([${variants.join(', ')}])`,
        })
      }
    }
  }

  return result
}

/**
 * Return the set of synthesized response schema names that the spec would generate.
 * Used by openapi-server's drift detection: warns if any of these are absent from
 * the user-owned schemas.ts. Exported so the server generator can call it directly.
 */
export function collectSynthesizedResponseSchemaNames(spec: OpenAPIV3_1.Document): Set<string> {
  const names = new Set<string>()
  for (const entry of synthesizeInlineResponseSchemas(spec)) {
    names.add(`${entry.name}Schema`)
  }
  return names
}

// Header comment block for the bootstrapped schemas.ts (user-owned, never overwritten).
const SCHEMAS_FILE_HEADER: readonly string[] = [
  '// Bootstrapped by openapi-zod-ts - this file is yours.',
  '// Add error messages, refinements, and business rules freely.',
  '// Re-running the generator will NOT overwrite this file.',
  '// Requires zod v4 (z.record takes two args, z.lazy for circular refs).',
  '//',
  '// Object schemas include .passthrough() so new optional server fields are',
  '// preserved when the API evolves - without breaking existing consumers.',
  '// Schemas with additionalProperties: false use .strict() instead.',
  '//',
  '// Form wizard pattern: extend API schemas for UI-only fields.',
  '// The generated client strips unknown keys before sending, so extra form',
  '// fields (step, confirmCheckbox, etc.) are never leaked to the backend:',
  '//',
  '//   export const CreateOrderFormSchema = CreateOrderSchema.extend({',
  '//     step: z.number(),',
  '//     confirmTerms: z.boolean(),',
  '//   })',
  '//',
  '// Use CreateOrderFormSchema for React Hook Form validation, then pass the',
  '// full form values to the generated client - it strips to API fields only.',
]

/**
 * Emit the Zod constants for component schemas, topologically sorted so dependencies precede
 * dependents. Recursive schemas are wrapped in z.lazy() and cast with `as z.ZodType<ModelType>`
 * so that z.infer resolves to the concrete model rather than unknown. Those model types are
 * imported type-only from models.ts and erased at runtime (no cycle).
 */
function emitComponentSchemas(
  schemas: Record<string, SchemaObject | ReferenceObject>,
  recursive: Set<string>
): string[] {
  const sanitizedSchemas: Record<string, SchemaObject | ReferenceObject> = {}
  for (const [name, schema] of Object.entries(schemas)) {
    sanitizedSchemas[toTypeName(name)] = schema
  }

  const { sorted } = topoSortSchemas(sanitizedSchemas)
  const lines: string[] = []

  const recursiveTypeNames = sorted.filter((name) => recursive.has(name))
  if (recursiveTypeNames.length > 0) {
    lines.push(`import type { ${recursiveTypeNames.join(', ')} } from './models.js'`)
  }
  lines.push('')

  for (const name of sorted) {
    const schema = sanitizedSchemas[name]!
    lines.push(generateSchemaDeclaration(name, schema, recursive.has(name) ? name : undefined))
    lines.push('')
  }
  return lines
}

/**
 * Emit synthesized schemas for operations with inline (non-$ref) JSON responses. These are
 * emitted after component schemas so referenced component schemas are already declared.
 */
function emitSynthesizedResponseSchemas(spec: OpenAPIV3_1.Document): string[] {
  const inlineResponseSchemas = synthesizeInlineResponseSchemas(spec)
  if (inlineResponseSchemas.length === 0) return []
  const lines: string[] = [
    '// Synthesized schemas for inline JSON responses (operationId-based naming).',
    '// These are used by openapi-server to wire schema.response for Fastify routes.',
    '// Add refinements here as needed; the generator will not overwrite this file.',
    '',
  ]
  for (const entry of inlineResponseSchemas) {
    lines.push(`export const ${entry.zodDecl}`)
    lines.push('')
  }
  return lines
}

export function generateZodSchemas(spec: OpenAPIV3_1.Document): GeneratedFile {
  const schemas = spec.components?.schemas as
    Record<string, SchemaObject | ReferenceObject> | undefined

  // Recursive (cyclic or self-referential) schemas are cast with `as z.ZodType<ModelType>`
  // so that z.infer resolves concretely. Their model type lives in models.ts, imported type-only.
  const recursive = findRecursiveSchemaNames(spec)

  const lines: string[] = [...SCHEMAS_FILE_HEADER, '', "import { z } from 'zod'"]
  lines.push(...(schemas !== undefined ? emitComponentSchemas(schemas, recursive) : ['']))
  lines.push(...emitSynthesizedResponseSchemas(spec))

  return {
    filename: 'schemas.ts',
    content: lines.join('\n'),
  }
}
