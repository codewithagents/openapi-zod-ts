import type { OpenAPIV3_1 } from 'openapi-types'
import { toPropertyKey, toTypeName, uniquifyName, refToTypeName } from '../utils/naming.js'
import { isDeepRef, resolveJsonPointer } from '../utils/ref-resolver.js'
import { findRecursiveSchemaNames } from '../utils/recursive-schemas.js'
import {
  buildWritableVariantMap,
  readShapeProperties,
  filterAllOfMembersForRead,
  effectiveWriteProperties,
  rawSchemaNameFromRef,
  schemaHasSplitProperties,
} from '../utils/writable-variants.js'

export interface GeneratedFile {
  filename: string
  content: string
}

type SchemaObject = OpenAPIV3_1.SchemaObject
type ArraySchemaObject = OpenAPIV3_1.ArraySchemaObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject

function isRef(schema: SchemaObject | ReferenceObject): schema is ReferenceObject {
  return '$ref' in schema
}

/**
 * Build a rename map from raw schema names to unique TypeScript identifiers.
 * When two or more schema names sanitize to the same identifier (e.g. 'String'
 * and 'string' both become 'String'), the first one keeps the base name and
 * subsequent ones receive a numeric suffix ('String_2', 'String_3', ...).
 * The iteration order of Object.keys() is insertion order, which is deterministic.
 */
function buildSchemaRenameMap(spec: OpenAPIV3_1.Document): Map<string, string> {
  const schemas = spec.components?.schemas as
    Record<string, SchemaObject | ReferenceObject> | undefined
  const map = new Map<string, string>()
  if (schemas === undefined) return map
  const used = new Set<string>()
  for (const name of Object.keys(schemas)) {
    const candidate = toTypeName(name)
    const unique = uniquifyName(candidate, used)
    map.set(name, unique)
  }
  return map
}

/**
 * Render the TypeScript object/record type string for a schema with type 'object'.
 * Extracted so it can be reused by the Array.isArray(schema.type) branch when 'object'
 * is one of the type-union members (e.g. type: ['object', 'null']).
 */
function objectTypeString(
  schema: SchemaObject,
  renameMap?: Map<string, string>,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  // additionalProperties without explicit properties -> Record
  if (
    schema.additionalProperties !== undefined &&
    schema.additionalProperties !== false &&
    schema.additionalProperties !== true &&
    (schema.properties === undefined || Object.keys(schema.properties).length === 0)
  ) {
    const valType = schemaToTypeString(
      schema.additionalProperties as SchemaObject | ReferenceObject,
      renameMap,
      spec,
      visited
    )
    return `Record<string, ${valType}>`
  }
  // inline object with properties
  if (schema.properties !== undefined) {
    return inlineObjectType(schema, renameMap, spec, visited)
  }
  return 'Record<string, unknown>'
}

/**
 * Render the TypeScript array/tuple type string for a schema with type 'array'.
 * Extracted so it can be reused by the Array.isArray(schema.type) branch when 'array'
 * is one of the type-union members (e.g. type: ['array', 'null']).
 */
function arrayTypeString(
  schema: SchemaObject,
  renameMap?: Map<string, string>,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  // prefixItems (OpenAPI 3.1 / JSON Schema 2020-12): fixed-position tuple elements
  const prefixItems = (
    schema as SchemaObject & { prefixItems?: (SchemaObject | ReferenceObject)[] }
  ).prefixItems
  if (prefixItems !== undefined && prefixItems.length > 0) {
    const tupleElements = prefixItems.map((item) =>
      schemaToTypeString(item, renameMap, spec, visited)
    )
    const arraySchema = schema as ArraySchemaObject
    const restItems = arraySchema.items as SchemaObject | ReferenceObject | undefined
    if (restItems !== undefined) {
      // Tuple with rest: [T0, T1, ...Rest[]]
      return `[${tupleElements.join(', ')}, ...${schemaToTypeString(restItems, renameMap, spec, visited)}[]]`
    }
    return `[${tupleElements.join(', ')}]`
  }

  const arraySchema = schema as ArraySchemaObject
  const items = arraySchema.items as SchemaObject | ReferenceObject | undefined
  if (items !== undefined) {
    return `${schemaToTypeString(items, renameMap, spec, visited)}[]`
  }
  return 'unknown[]'
}

/** Return an inline comment for date/date-time formats, or '' for others. */
function formatComment(schema: SchemaObject): string {
  if (schema.type !== 'string') return ''
  const fmt = schema.format as string | undefined
  if (fmt === 'date-time') return ' /* date-time */'
  if (fmt === 'date') return ' /* date */'
  return ''
}

// pre-existing size, tracked in #228
// fallow-ignore-next-line complexity
function schemaToTypeString(
  schema: SchemaObject | ReferenceObject,
  renameMap?: Map<string, string>,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  if (isRef(schema)) {
    const ref = schema.$ref
    if (spec !== undefined && isDeepRef(ref)) {
      // Deep ref: resolve the JSON pointer and emit the target schema inline.
      // Use a visited set to guard against cycles.
      const visitedSet = visited ?? new Set<string>()
      if (visitedSet.has(ref)) return 'unknown'
      visitedSet.add(ref)
      const resolved = resolveJsonPointer(spec, ref)
      if (resolved === undefined) return 'unknown'
      const result = schemaToTypeString(resolved, renameMap, spec, visitedSet)
      visitedSet.delete(ref)
      return result
    }
    return refToTypeName(ref, renameMap)
  }

  // const keyword: single fixed value -> TS literal type
  const constVal = (schema as SchemaObject & { const?: unknown }).const
  if (constVal !== undefined) {
    if (constVal === null) return 'null'
    if (typeof constVal === 'string') return JSON.stringify(constVal)
    if (typeof constVal === 'number' || typeof constVal === 'boolean') return String(constVal)
    return 'unknown'
  }

  // Handle nullable via OpenAPI 3.1 array type: type: ['string', 'null']
  if (Array.isArray(schema.type)) {
    const types = (schema.type as string[]).map((t) => {
      if (t === 'null') return 'null'
      if (t === 'array') return arrayTypeString(schema, renameMap, spec, visited)
      if (t === 'object') return objectTypeString(schema, renameMap, spec, visited)
      return primitiveToTs(t, schema.format as string | undefined)
    })
    return types.join(' | ')
  }

  // enum - handles string, integer, number, mixed (null values rendered as "null" literal)
  // Non-primitive enum values (objects, arrays) cannot be expressed as TS literal types,
  // so they are widened to 'unknown' to avoid emitting invalid syntax like [object Object].
  if (schema.enum !== undefined && schema.enum.length > 0) {
    return schema.enum
      .map((v: unknown) => {
        if (v === null) return 'null'
        if (typeof v === 'string') return JSON.stringify(v) // double-quotes, handles apostrophes safely
        if (typeof v === 'number' || typeof v === 'boolean') return String(v)
        return 'unknown' // object or array enum value - no valid TS literal representation
      })
      .join(' | ')
  }

  // allOf: intersect all members, then merge in any sibling properties/required
  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const parts = (schema.allOf as (SchemaObject | ReferenceObject)[]).map((s) =>
      schemaToTypeString(s, renameMap, spec, visited)
    )
    // Sibling properties live outside the allOf array and must be included as an extra member
    const siblingProps = schema.properties as
      Record<string, SchemaObject | ReferenceObject> | undefined
    if (siblingProps !== undefined && Object.keys(siblingProps).length > 0) {
      parts.push(inlineObjectType(schema, renameMap, spec, visited))
    }
    if (parts.length === 1) return parts[0]!
    return parts.join(' & ')
  }

  // anyOf
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) {
    return (schema.anyOf as (SchemaObject | ReferenceObject)[])
      .map((s) => schemaToTypeString(s, renameMap, spec, visited))
      .join(' | ')
  }

  // oneOf
  if (schema.oneOf !== undefined && schema.oneOf.length > 0) {
    return (schema.oneOf as (SchemaObject | ReferenceObject)[])
      .map((s) => schemaToTypeString(s, renameMap, spec, visited))
      .join(' | ')
  }

  const type = schema.type as string | undefined

  // array
  if (type === 'array') {
    return arrayTypeString(schema, renameMap, spec, visited)
  }

  // object
  if (type === 'object') {
    return objectTypeString(schema, renameMap, spec, visited)
  }

  if (type !== undefined) {
    return primitiveToTs(type, schema.format as string | undefined)
  }

  return 'unknown'
}

/**
 * Writable-aware variant of schemaToTypeString. When a component $ref resolves to a schema
 * that is in the writableVariantMap, the XWritable name is emitted instead of the base name.
 * Used exclusively inside buildWritableInterface to render the deep write shape of a container
 * (e.g. items: LabVariantItemWritable[] instead of items: LabVariantItem[]).
 * All other paths (read types, plain types) use the original schemaToTypeString unchanged.
 */
function schemaToWritableTypeString(
  schema: SchemaObject | ReferenceObject,
  writableVariantMap: Map<string, string>,
  renameMap?: Map<string, string>,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  if (isRef(schema)) {
    const ref = schema.$ref
    // Check if this component ref has a writable variant; if so, emit XWritable.
    const rawName = rawSchemaNameFromRef(ref)
    if (rawName !== undefined) {
      const writableName = writableVariantMap.get(rawName)
      if (writableName !== undefined) {
        return writableName
      }
    }
    // Fall back to the standard ref rendering (handles deep refs, renames, etc.).
    return schemaToTypeString(schema, renameMap, spec, visited)
  }

  // array: recurse into items with the writable-aware renderer
  if ((schema as SchemaObject).type === 'array') {
    const arraySchema = schema as OpenAPIV3_1.ArraySchemaObject
    const items = arraySchema.items as SchemaObject | ReferenceObject | undefined
    if (items !== undefined) {
      return `${schemaToWritableTypeString(items, writableVariantMap, renameMap, spec, visited)}[]`
    }
    return 'unknown[]'
  }

  // For all other schema forms (objects, composites, primitives) delegate to the
  // standard renderer: the writable rewrite is only needed for component $refs.
  return schemaToTypeString(schema, renameMap, spec, visited)
}

/**
 * Map an OpenAPI primitive type to a TypeScript type.
 * For integer with format int64, returns number with an inline comment noting precision
 * is limited to 2^53-1 (JS Number.MAX_SAFE_INTEGER). BigInt is avoided because
 * JSON.stringify throws on bigint values and JSON.parse never produces bigint, making
 * bigint unworkable for standard API client serialization.
 */
function primitiveToTs(type: string, format?: string): string {
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'integer':
      return format === 'int64' ? 'number /* int64, precision limited to 2^53-1 */' : 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    default:
      return 'unknown'
  }
}

function inlineObjectType(
  schema: SchemaObject,
  renameMap?: Map<string, string>,
  spec?: OpenAPIV3_1.Document,
  visited?: Set<string>
): string {
  const required = new Set<string>(schema.required ?? [])
  const props = schema.properties as Record<string, SchemaObject | ReferenceObject> | undefined
  if (props === undefined || Object.keys(props).length === 0) {
    return 'Record<string, unknown>'
  }
  const lines = Object.entries(props).map(([key, propSchema]) => {
    const optional = !required.has(key)
    const propKey = toPropertyKey(key)
    const typStr = schemaToTypeString(propSchema, renameMap, spec, visited)
    // Add inline format comment for date/date-time string properties
    const comment = isRef(propSchema) ? '' : formatComment(propSchema as SchemaObject)
    return `  ${propKey}${optional ? '?' : ''}: ${typStr}${comment}`
  })
  return `{\n${lines.join('\n')}\n}`
}

function isEnumSchema(schema: SchemaObject): boolean {
  if (schema.enum === undefined || schema.enum.length === 0) return false
  // String enums, numeric enums (integer/number), and mixed/untyped enums
  if (schema.type === 'string' || schema.type === 'integer' || schema.type === 'number') return true
  // Mixed enums: no explicit type but enum values present
  if (schema.type === undefined) return true
  return false
}

/** True when every enum value is a number (no strings, no nulls). */
function isNumericEnum(schema: SchemaObject): boolean {
  return (schema.enum ?? []).every((v: unknown) => typeof v === 'number')
}

/** True when every enum value is a string (no numbers, no nulls). */
function isStringEnum(schema: SchemaObject): boolean {
  return (schema.enum ?? []).every((v: unknown) => typeof v === 'string')
}

function isObjectSchema(schema: SchemaObject): boolean {
  // allOf with sibling properties/required is object-like: the sibling props/required apply to
  // the merged result, so schema-enhanced mode should defer to z.infer<> for it.
  if (schema.allOf !== undefined) {
    const siblingProps = schema.properties as Record<string, unknown> | undefined
    return siblingProps !== undefined && Object.keys(siblingProps).length > 0
  }
  // anyOf/oneOf without allOf are treated as type aliases
  if (schema.anyOf !== undefined || schema.oneOf !== undefined) {
    return false
  }
  return schema.type === 'object' || schema.properties !== undefined
}

/** Derive the discriminator literal value for a variant ref */
function discriminatorLiteralFor(ref: string, mapping: Record<string, string> | undefined): string {
  if (mapping !== undefined) {
    // Find the key whose value matches the ref
    for (const [key, val] of Object.entries(mapping)) {
      if (val === ref || val.endsWith(`/${ref.split('/').pop()!}`)) {
        return key
      }
    }
  }
  // Fall back: extract the type name from the ref and lowercase it
  const typeName = refToTypeName(ref)
  return typeName.charAt(0).toLowerCase() + typeName.slice(1)
}

interface TypesOptions {
  schemaNames?: Set<string>
  schemaImportPath?: string
  /**
   * Names (sanitized via toTypeName) of recursive schemas. These are emitted as concrete
   * interfaces instead of `z.infer<typeof FooSchema>`, because their Zod schema is annotated
   * `z.ZodType<Foo>` and deriving the type back via z.infer would be circular.
   */
  recursiveNames?: Set<string>
}

/**
 * Build the `export interface XWritable { ... }` declaration (the write/request shape).
 * Uses effectiveWriteProperties so direct properties and inline allOf members are both
 * covered, with readOnly properties excluded. Emitted for any schema that has a writable
 * variant, regardless of which read-shape branch the schema took (interface, z.infer, allOf).
 *
 * When writableVariantMap is provided, nested component $refs whose target is in the map
 * are rewritten to their XWritable name (e.g. items: LabVariantItemWritable[]) so the
 * write shape is deep, not just the top-level field selection.
 */
function buildWritableInterface(
  writableName: string,
  schema: SchemaObject,
  renameMap: Map<string, string> | undefined,
  spec: OpenAPIV3_1.Document | undefined,
  writableVariantMap?: Map<string, string>
): string {
  const { props, required } = effectiveWriteProperties(schema)
  const lines: string[] = []
  for (const [key, propSchema] of Object.entries(props)) {
    const optional = !required.has(key)
    const propKey = toPropertyKey(key)
    // Use the writable-aware renderer when a map is provided so nested split refs
    // are rewritten to their XWritable names (deep write shape).
    const typStr =
      writableVariantMap !== undefined
        ? schemaToWritableTypeString(propSchema, writableVariantMap, renameMap, spec)
        : schemaToTypeString(propSchema, renameMap, spec)
    const comment = isRef(propSchema) ? '' : formatComment(propSchema as SchemaObject)
    lines.push(`  ${propKey}${optional ? '?' : ''}: ${typStr}${comment}`)
  }
  return lines.length === 0
    ? `export interface ${writableName} {}`
    : `export interface ${writableName} {\n${lines.join('\n')}\n}`
}

// pre-existing size, tracked in #228
// fallow-ignore-next-line complexity
function generateSchemaDeclaration(
  name: string,
  schema: SchemaObject | ReferenceObject,
  options?: TypesOptions,
  renameMap?: Map<string, string>,
  spec?: OpenAPIV3_1.Document,
  writableVariantMap?: Map<string, string>
): string {
  // Use the pre-computed unique name from the rename map when available;
  // otherwise fall back to the standard sanitization.
  const safeName = renameMap?.get(name) ?? toTypeName(name)

  if (isRef(schema)) {
    const ref = schema.$ref
    if (spec !== undefined && isDeepRef(ref)) {
      const resolved = resolveJsonPointer(spec, ref)
      const inlineType =
        resolved !== undefined ? schemaToTypeString(resolved, renameMap, spec) : 'unknown'
      return `export type ${safeName} = ${inlineType}`
    }
    return `export type ${safeName} = ${refToTypeName(ref, renameMap)}`
  }

  // const keyword: single fixed value -> TS literal type alias
  const constVal = (schema as SchemaObject & { const?: unknown }).const
  if (constVal !== undefined) {
    if (constVal === null) return `export type ${safeName} = null`
    if (typeof constVal === 'string') return `export type ${safeName} = ${JSON.stringify(constVal)}`
    if (typeof constVal === 'number' || typeof constVal === 'boolean')
      return `export type ${safeName} = ${String(constVal)}`
    return `export type ${safeName} = unknown`
  }

  // Schema-enhanced mode: for object schemas with a matching Zod schema, use z.infer.
  // Exception: when the schema is a transitive container (in the writable map but has no
  // direct readOnly/writeOnly flags of its own), z.infer is unreliable because the user's
  // Zod schema may embed the write-shaped nested schema (e.g. LabNestedVariantSchema embeds
  // LabVariantItemWriteSchema). In that case, fall through to the spec-derived interface
  // branch below so the read type comes from spec flags (items: LabVariantItem[]) and the
  // XWritable is deep-rendered (items: LabVariantItemWritable[]).
  // Recursive schemas skip z.infer and fall through to the spec-derived interface branch:
  // their Zod schema is annotated z.ZodType<Foo>, so z.infer<typeof FooSchema> would be a
  // circular, excessively-deep instantiation. The concrete interface is referenced by the
  // annotation in schemas.ts (imported type-only).
  if (
    options?.schemaNames !== undefined &&
    options.schemaNames.has(`${safeName}Schema`) &&
    isObjectSchema(schema) &&
    options.recursiveNames?.has(toTypeName(name)) !== true
  ) {
    const writableName = writableVariantMap?.get(name)
    // A schema is "only transitively" in the map when it has no direct split flags.
    // For such containers in schema-enhanced mode, derive the read type from spec (not z.infer)
    // so the response type is correct regardless of what the user's Zod schema embeds.
    const isTransitiveContainer = writableName !== undefined && !schemaHasSplitProperties(schema)
    if (!isTransitiveContainer) {
      // Leaf or direct-split: keep z.infer as the read type (unchanged behaviour).
      const readDecl = `export type ${safeName} = z.infer<typeof ${safeName}Schema>`
      // A schema with readOnly/writeOnly props still needs its XWritable variant emitted,
      // because client.ts references it for request bodies. The read shape stays z.infer
      // (derived from the user-owned Zod schema); the writable variant is a plain interface.
      if (writableName !== undefined) {
        return `${readDecl}\n\n${buildWritableInterface(writableName, schema as SchemaObject, renameMap, spec, writableVariantMap)}`
      }
      return readDecl
    }
    // Transitive container: fall through to the spec-derived object branch below.
    // The z.infer read type is NOT emitted; the spec-derived interface is used instead.
  }

  if (isEnumSchema(schema)) {
    const union = schema
      .enum!.map((v: unknown) => {
        if (v === null) return 'null'
        if (typeof v === 'string') return JSON.stringify(v) // double-quotes, handles apostrophes safely
        return String(v)
      })
      .join(' | ')
    const typeDecl = `export type ${safeName} = ${union}`
    // Emit a values array for pure string and pure numeric enums so consumers can
    // iterate valid values (e.g. to populate a <select>) without hardcoding them.
    // Mixed enums (string + number, or containing null) intentionally get no array.
    if (isStringEnum(schema)) {
      const arr = (schema.enum as string[]).map((v) => JSON.stringify(v)).join(', ')
      return `${typeDecl}\nexport const ${safeName}Values = [${arr}] as const`
    }
    if (isNumericEnum(schema)) {
      const arr = (schema.enum as number[]).join(', ')
      return `${typeDecl}\nexport const ${safeName}Values = [${arr}] as const`
    }
    return typeDecl
  }

  // allOf with sibling properties: emit as merged type alias, not an interface.
  // Generating an interface here would only capture the sibling properties and silently
  // drop the allOf base types. schemaToTypeString handles the merge correctly.
  if (schema.allOf !== undefined && schema.allOf.length > 0) {
    const writableName = writableVariantMap?.get(name)
    if (writableName !== undefined) {
      // Read shape: rebuild allOf with writeOnly properties removed from inline members.
      const filteredMembers = filterAllOfMembersForRead(schema)
      const readSchema: SchemaObject = { ...schema, allOf: filteredMembers }
      const readDecl = `export type ${safeName} = ${schemaToTypeString(readSchema, renameMap, spec)}`
      return `${readDecl}\n\n${buildWritableInterface(writableName, schema, renameMap, spec, writableVariantMap)}`
    }
    const typeStr = schemaToTypeString(schema, renameMap, spec)
    return `export type ${safeName} = ${typeStr}`
  }

  if (isObjectSchema(schema)) {
    const required = new Set<string>(schema.required ?? [])
    const props = schema.properties as Record<string, SchemaObject | ReferenceObject> | undefined

    // object with additionalProperties (no properties) -> type alias
    if (
      schema.additionalProperties !== undefined &&
      schema.additionalProperties !== false &&
      schema.additionalProperties !== true &&
      (props === undefined || Object.keys(props).length === 0)
    ) {
      const valType = schemaToTypeString(
        schema.additionalProperties as SchemaObject | ReferenceObject,
        renameMap,
        spec
      )
      return `export type ${safeName} = Record<string, ${valType}>`
    }

    // Check if this schema has a writable variant (readOnly/writeOnly properties present)
    const writableName = writableVariantMap?.get(name)
    const hasSplit = writableName !== undefined

    // Build the read-shape (X): exclude writeOnly properties when split is active
    const readProps = hasSplit ? readShapeProperties(schema) : props
    const propLines: string[] = []
    if (readProps !== undefined) {
      for (const [key, propSchema] of Object.entries(readProps)) {
        const optional = !required.has(key)
        const propKey = toPropertyKey(key)
        const typStr = schemaToTypeString(propSchema, renameMap, spec)
        // Add inline format comment for date/date-time string properties
        const comment = isRef(propSchema) ? '' : formatComment(propSchema as SchemaObject)
        propLines.push(`  ${propKey}${optional ? '?' : ''}: ${typStr}${comment}`)
      }
    }

    const readDecl =
      propLines.length === 0
        ? `export type ${safeName} = Record<string, unknown>`
        : `export interface ${safeName} {\n${propLines.join('\n')}\n}`

    if (!hasSplit) return readDecl

    // Build the write-shape (XWritable): exclude readOnly properties (deep-render nested refs)
    return `${readDecl}\n\n${buildWritableInterface(writableName!, schema, renameMap, spec, writableVariantMap)}`
  }

  // Discriminated union via oneOf/anyOf + discriminator
  const discriminator = (
    schema as SchemaObject & {
      discriminator?: { propertyName: string; mapping?: Record<string, string> }
    }
  ).discriminator
  const compositeVariants = schema.oneOf ?? schema.anyOf
  if (
    discriminator !== undefined &&
    compositeVariants !== undefined &&
    compositeVariants.length > 0
  ) {
    const { propertyName, mapping } = discriminator
    const variants = (compositeVariants as (SchemaObject | ReferenceObject)[]).map((variant) => {
      if (!isRef(variant)) {
        // Inline schema in discriminated union - emit as plain variant
        return schemaToTypeString(variant, renameMap, spec)
      }
      const ref = (variant as ReferenceObject).$ref
      const typeName = refToTypeName(ref, renameMap)
      const literalValue = discriminatorLiteralFor(ref, mapping)
      return `(${typeName} & { ${propertyName}: '${literalValue}' })`
    })
    const lines = variants.map((v, i) => (i === 0 ? `  | ${v}` : `  | ${v}`))
    return `export type ${safeName} =\n${lines.join('\n')}`
  }

  // allOf / anyOf / oneOf or other -> type alias
  const typeStr = schemaToTypeString(schema, renameMap, spec)
  return `export type ${safeName} = ${typeStr}`
}

/**
 * Build the file header lines for models.ts.
 * In schema-enhanced mode, emits the zod import and the named schema imports.
 * In plain mode, emits only the auto-generated banner.
 */
/**
 * Names of the Zod schema constants that models.ts references via z.infer. Recursive schemas
 * are excluded: they are emitted as concrete interfaces, so importing their schema const here
 * would be unused.
 */
function inferImportNames(
  schemas: Record<string, SchemaObject | ReferenceObject> | undefined,
  options: TypesOptions,
  renameMap: Map<string, string>
): string[] {
  const names: string[] = []
  for (const name of Object.keys(schemas ?? {})) {
    const safeName = renameMap.get(name) ?? toTypeName(name)
    const isRecursive = options.recursiveNames?.has(toTypeName(name)) === true
    if (options.schemaNames?.has(`${safeName}Schema`) && !isRecursive) {
      names.push(`${safeName}Schema`)
    }
  }
  return names
}

function buildModelsHeader(
  schemas: Record<string, SchemaObject | ReferenceObject> | undefined,
  options: TypesOptions | undefined,
  renameMap: Map<string, string>
): string[] {
  const banner = '// This file is auto-generated by openapi-zod-ts - do not edit'
  if (options?.schemaNames === undefined || options.schemaImportPath === undefined) {
    return [banner, '']
  }
  const importedSchemas = inferImportNames(schemas, options, renameMap)
  // When every schema in the file is recursive (or there are none), there is no z.infer
  // usage, so neither the zod import nor the schema import is needed.
  if (importedSchemas.length === 0) {
    return [banner, '']
  }
  return [
    banner,
    "import type { z } from 'zod'",
    `import type { ${importedSchemas.join(', ')} } from '${options.schemaImportPath}'`,
    '',
  ]
}

/**
 * Collect sub-schemas from the `definitions` / `$defs` blocks that some specs
 * embed inside a component schema object (e.g. `#/components/schemas/Account/definitions/accountRef`).
 * These sub-schemas are referenced by other schemas via their last-segment name but are never
 * emitted as top-level types unless we surface them here.
 *
 * Rules:
 *  - Only the `definitions` and `$defs` keywords are supported (JSON Schema conventions).
 *  - The candidate PascalCase name must not collide with an existing top-level schema name.
 *    If it does, the sub-schema is skipped (the top-level type already satisfies the reference).
 *  - Names are deduped: when two parents expose a sub-def that sanitizes to the same identifier
 *    the second one is skipped (they are expected to be structurally identical cross-references).
 */
function collectSubDefinitions(
  schemas: Record<string, SchemaObject | ReferenceObject>
): Map<string, SchemaObject | ReferenceObject> {
  const topLevelNames = new Set(Object.keys(schemas).map((n) => toTypeName(n)))
  const collected = new Map<string, SchemaObject | ReferenceObject>()

  for (const parentSchema of Object.values(schemas)) {
    if (isRef(parentSchema)) continue
    const s = parentSchema as SchemaObject & {
      definitions?: Record<string, SchemaObject | ReferenceObject>
      $defs?: Record<string, SchemaObject | ReferenceObject>
    }
    const defs: Record<string, SchemaObject | ReferenceObject> = {
      ...(s.definitions ?? {}),
      ...(s.$defs ?? {}),
    }
    for (const [defName, defSchema] of Object.entries(defs)) {
      const safeName = toTypeName(defName)
      // Skip if the PascalCase name collides with a top-level schema or was already collected.
      if (topLevelNames.has(safeName) || collected.has(safeName)) continue
      collected.set(safeName, defSchema)
    }
  }

  return collected
}

export function generateTypes(
  spec: OpenAPIV3_1.Document,
  options?: TypesOptions,
  writableVariantMap?: Map<string, string>
): GeneratedFile {
  const schemas = spec.components?.schemas as
    Record<string, SchemaObject | ReferenceObject> | undefined

  // Build rename map so duplicate sanitized identifiers get deterministic suffixes.
  // E.g. schemas 'String' and 'string' both sanitize to 'String'; the second becomes 'String_2'.
  const renameMap = buildSchemaRenameMap(spec)

  // Use the pre-computed map when provided (single source of truth via generator.ts).
  // Fall back to building it internally so existing callers without the map still work.
  const resolvedWritableVariantMap = writableVariantMap ?? buildWritableVariantMap(spec)

  // Recursive schemas are emitted as concrete interfaces (not z.infer); see TypesOptions.
  const opts: TypesOptions = { ...options, recursiveNames: findRecursiveSchemaNames(spec) }

  const lines: string[] = buildModelsHeader(schemas, opts, renameMap)

  if (schemas !== undefined) {
    for (const [name, schema] of Object.entries(schemas)) {
      lines.push(
        generateSchemaDeclaration(name, schema, opts, renameMap, spec, resolvedWritableVariantMap)
      )
      lines.push('')
    }

    // Emit sub-definitions from definitions/$defs blocks inside component schemas.
    // These are referenced by other schemas via their last-segment PascalCase name
    // (e.g. #/components/schemas/Account/definitions/accountRef -> AccountRef) but are
    // not emitted by the top-level loop above.
    const subDefs = collectSubDefinitions(schemas)
    for (const [safeName, defSchema] of subDefs) {
      // Sub-defs are already sanitized; pass the safe name directly by faking a
      // 1-entry rename map so generateSchemaDeclaration picks it up.
      const subRenameMap = new Map([[safeName, safeName]])
      lines.push(generateSchemaDeclaration(safeName, defSchema, opts, subRenameMap, spec))
      lines.push('')
    }
  }

  return {
    filename: 'models.ts',
    content: lines.join('\n'),
  }
}
