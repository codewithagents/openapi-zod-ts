import type { OpenAPIV3_1 } from 'openapi-types'
import { toTypeName, uniquifyName } from './naming.js'

type SchemaObject = OpenAPIV3_1.SchemaObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type PropMap = Record<string, SchemaObject | ReferenceObject>

function isRef(schema: SchemaObject | ReferenceObject): schema is ReferenceObject {
  return '$ref' in schema
}

/**
 * Copy a property map, optionally dropping properties flagged readOnly or writeOnly.
 * $ref properties carry no readOnly/writeOnly flag and are always kept.
 * Pass `exclude: null` to copy every property unchanged.
 */
function filterProps(
  props: PropMap | undefined,
  exclude: 'readOnly' | 'writeOnly' | null
): PropMap {
  const out: PropMap = {}
  if (props === undefined) return out
  for (const [key, propSchema] of Object.entries(props)) {
    if (exclude !== null && !isRef(propSchema)) {
      if ((propSchema as SchemaObject & Record<string, unknown>)[exclude] === true) continue
    }
    out[key] = propSchema
  }
  return out
}

/** True when any inline property in the map is flagged readOnly or writeOnly. */
function hasSplitFlag(props: PropMap | undefined): boolean {
  if (props === undefined) return false
  return Object.values(props).some((p) => {
    if (isRef(p)) return false
    const s = p as SchemaObject & { readOnly?: boolean; writeOnly?: boolean }
    return s.readOnly === true || s.writeOnly === true
  })
}

/**
 * Returns true when a component schema X has at least one readOnly or writeOnly property
 * (in its direct properties or an inline-object allOf member). When true, two variants
 * should be emitted: X (read shape) and XWritable (write shape).
 * Does not recurse into $ref targets: only direct flags are inspected here.
 * The transitive case (container whose nested $refs reach a split schema) is handled
 * separately in buildWritableVariantMap via a fixpoint pass.
 */
export function schemaHasSplitProperties(schema: SchemaObject | ReferenceObject): boolean {
  if (isRef(schema)) return false
  const s = schema as SchemaObject
  if (hasSplitFlag(s.properties as PropMap | undefined)) return true
  for (const member of (s.allOf as (SchemaObject | ReferenceObject)[] | undefined) ?? []) {
    if (
      !isRef(member) &&
      hasSplitFlag((member as SchemaObject).properties as PropMap | undefined)
    ) {
      return true
    }
  }
  return false
}

/**
 * Extract the raw (un-sanitized) component schema name from a component $ref.
 * Returns undefined when the ref is not a standard component schema ref.
 * E.g. '#/components/schemas/CreateUserRequest' -> 'CreateUserRequest'
 */
export function rawSchemaNameFromRef(ref: string): string | undefined {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref)
  return match?.[1]
}

/**
 * Given a component schema $ref and a writable-variant map, resolve the type name
 * to use for a request body. When the referenced schema has a writable variant
 * (i.e. it has readOnly or writeOnly properties), returns the XWritable name.
 * Otherwise returns undefined (caller falls back to the plain ref type name).
 */
export function resolveBodyRefToWritableName(
  ref: string,
  writableVariantMap: Map<string, string>
): string | undefined {
  const rawName = rawSchemaNameFromRef(ref)
  if (rawName === undefined) return undefined
  return writableVariantMap.get(rawName)
}

/**
 * Collect all component schema $ref names referenced directly by a schema (non-recursively).
 * Walks properties, array items, additionalProperties, and allOf/oneOf/anyOf members.
 * Does NOT recurse into the targets of those refs; only the immediate ref strings are
 * returned so callers can check whether any target is already in the split set.
 * Returns raw component schema names (e.g. 'LabVariantItem'), not full $ref strings.
 */
/**
 * If `schema` is a component $ref, return its raw name. If it is an inline array whose
 * items is a component $ref, return that item's raw name. Otherwise undefined. This covers
 * the two ref-bearing shapes a single property (or top-level schema) can take.
 */
function refNameOfSchemaOrArrayItem(
  schema: SchemaObject | ReferenceObject | undefined
): string | undefined {
  if (schema === undefined) return undefined
  if (isRef(schema)) return rawSchemaNameFromRef(schema.$ref)
  const obj = schema as SchemaObject
  const items =
    obj.type === 'array' ? (obj.items as SchemaObject | ReferenceObject | undefined) : undefined
  if (items !== undefined && isRef(items)) return rawSchemaNameFromRef(items.$ref)
  return undefined
}

/** Flatten a schema's allOf/oneOf/anyOf members into a single list. */
function compositeMembers(obj: SchemaObject): Array<SchemaObject | ReferenceObject> {
  const members: Array<SchemaObject | ReferenceObject> = []
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const group = (obj as Record<string, unknown>)[key] as
      (SchemaObject | ReferenceObject)[] | undefined
    if (group !== undefined) members.push(...group)
  }
  return members
}

function collectComponentRefNames(schema: SchemaObject | ReferenceObject): Set<string> {
  const refs = new Set<string>()
  const add = (name: string | undefined): void => {
    if (name !== undefined) refs.add(name)
  }

  const visit = (s: SchemaObject | ReferenceObject): void => {
    if (isRef(s)) {
      add(rawSchemaNameFromRef(s.$ref))
      return
    }
    const obj = s as SchemaObject
    // The schema itself as a top-level array of $ref.
    add(refNameOfSchemaOrArrayItem(obj))
    // Each property: a direct $ref or an inline array of $ref.
    for (const prop of Object.values((obj.properties ?? {}) as PropMap)) {
      add(refNameOfSchemaOrArrayItem(prop))
    }
    // additionalProperties as a $ref (schema form only, not the boolean shorthand).
    if (typeof obj.additionalProperties === 'object' && obj.additionalProperties !== null) {
      add(refNameOfSchemaOrArrayItem(obj.additionalProperties as SchemaObject | ReferenceObject))
    }
    // Composite members: $ref members directly, inline members recursed one level.
    for (const member of compositeMembers(obj)) {
      if (isRef(member)) add(rawSchemaNameFromRef(member.$ref))
      else visit(member)
    }
  }

  visit(schema)
  return refs
}

/**
 * Build a map from raw schema name to the resolved unique XWritable variant name.
 * Includes schemas that have readOnly or writeOnly properties directly (the "leaf" case)
 * AND container schemas whose nested component $refs transitively reach a split schema
 * (the "transitive container" case). XWritable names are uniquified against all top-level
 * schema safe names so they never collide.
 *
 * The transitive detection runs a fixpoint: starting from the direct-split seed, it
 * repeatedly adds any schema whose nested component ref names intersect the current split
 * set, until no new additions occur. A visited guard prevents infinite loops on cyclic refs.
 */
export function buildWritableVariantMap(spec: OpenAPIV3_1.Document): Map<string, string> {
  const schemas = spec.components?.schemas as
    Record<string, SchemaObject | ReferenceObject> | undefined
  const map = new Map<string, string>()
  if (schemas === undefined) return map

  const used = new Set<string>()
  for (const name of Object.keys(schemas)) used.add(toTypeName(name))
  const writableNameFor = (name: string): string =>
    uniquifyName(`${toTypeName(name)}Writable`, used)

  // Seed: direct-split schemas (have readOnly or writeOnly properties directly).
  for (const [name, schema] of Object.entries(schemas)) {
    if (schemaHasSplitProperties(schema)) map.set(name, writableNameFor(name))
  }
  addTransitiveContainers(schemas, map, writableNameFor)
  return map
}

/**
 * Grow `map` with container schemas whose nested component $refs transitively reach a
 * schema already in the split set. Runs a fixpoint until no new container is added; a
 * "checked" set keeps non-containers from being re-walked and makes cyclic refs terminate.
 */
function addTransitiveContainers(
  schemas: Record<string, SchemaObject | ReferenceObject>,
  map: Map<string, string>,
  writableNameFor: (name: string) => string
): void {
  const checked = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const [name, schema] of Object.entries(schemas)) {
      if (map.has(name) || checked.has(name) || isRef(schema)) continue
      const nestedRefs = collectComponentRefNames(schema as SchemaObject)
      if (Array.from(nestedRefs).some((refName) => map.has(refName))) {
        map.set(name, writableNameFor(name))
        changed = true
      } else {
        checked.add(name)
      }
    }
  }
}

/**
 * Filter a schema's direct properties for the read (response) shape: excludes writeOnly props.
 * For allOf schemas use filterAllOfMembersForRead instead.
 */
export function readShapeProperties(schema: SchemaObject): PropMap {
  return filterProps(schema.properties as PropMap | undefined, 'writeOnly')
}

/**
 * Return the schema's allOf array with writeOnly properties removed from inline (non-$ref)
 * members. $ref members are kept unchanged. Used to rebuild the read-shape type for allOf schemas.
 */
export function filterAllOfMembersForRead(
  schema: SchemaObject
): Array<SchemaObject | ReferenceObject> {
  const allOf = schema.allOf as (SchemaObject | ReferenceObject)[] | undefined
  if (allOf === undefined) return []
  return allOf.map((member) => {
    if (isRef(member)) return member
    const m = member as SchemaObject
    if (m.properties === undefined) return m
    return { ...m, properties: filterProps(m.properties as PropMap, 'writeOnly') } as SchemaObject
  })
}

/**
 * Collect all effective write-shape properties for a schema: direct properties plus inline
 * allOf member properties, excluding readOnly ones. Required is the union of the direct
 * `required` and each inline allOf member's `required`.
 */
export function effectiveWriteProperties(schema: SchemaObject): {
  props: PropMap
  required: Set<string>
} {
  const props: PropMap = {}
  const required = new Set<string>()

  const addSource = (
    sourceProps: PropMap | undefined,
    sourceRequired: string[] | undefined
  ): void => {
    for (const r of sourceRequired ?? []) required.add(r)
    Object.assign(props, filterProps(sourceProps, 'readOnly'))
  }

  addSource(schema.properties as PropMap | undefined, schema.required as string[] | undefined)
  for (const member of (schema.allOf as (SchemaObject | ReferenceObject)[] | undefined) ?? []) {
    if (isRef(member)) continue
    const m = member as SchemaObject
    addSource(m.properties as PropMap | undefined, m.required as string[] | undefined)
  }

  return { props, required }
}
