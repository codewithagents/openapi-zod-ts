import type { OpenAPIV3_1 } from 'openapi-types'
import { toTypeName } from './naming.js'

type SchemaObject = OpenAPIV3_1.SchemaObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject

/** Return the nested schemas a schema directly contains (composition, properties, items, AP). */
function childSchemas(s: SchemaObject): (SchemaObject | ReferenceObject)[] {
  const children: (SchemaObject | ReferenceObject)[] = []
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const list = s[key] as (SchemaObject | ReferenceObject)[] | undefined
    if (list !== undefined) children.push(...list)
  }
  if (s.properties !== undefined) {
    children.push(...Object.values(s.properties as Record<string, SchemaObject | ReferenceObject>))
  }
  const items = (s as { items?: SchemaObject | ReferenceObject }).items
  if (items !== undefined) children.push(items)
  const ap = s.additionalProperties
  if (ap !== undefined && typeof ap === 'object')
    children.push(ap as SchemaObject | ReferenceObject)
  return children
}

/**
 * Collect the names (sanitized via toTypeName) of top-level component schemas that a schema
 * references, into `out`. Only `#/components/schemas/{name}` refs contribute an edge; deeper
 * or external refs are ignored for the purpose of cycle detection.
 */
function collectComponentRefNames(
  schema: SchemaObject | ReferenceObject | undefined,
  out: Set<string>
): void {
  if (schema === undefined || schema === null || typeof schema !== 'object') return

  const ref = (schema as ReferenceObject).$ref
  if (typeof ref === 'string') {
    const match = /^#\/components\/schemas\/([^/]+)$/.exec(ref)
    if (match !== null) out.add(toTypeName(match[1]!))
    return
  }

  for (const child of childSchemas(schema as SchemaObject)) {
    collectComponentRefNames(child, out)
  }
}

/** Whether `start` is reachable from itself by following the component-ref graph. */
function reachableFromSelf(start: string, edges: Map<string, Set<string>>): boolean {
  const stack = [...(edges.get(start) ?? [])]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === start) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const next of edges.get(current) ?? []) stack.push(next)
  }
  return false
}

/**
 * Return the set of component schema names (sanitized via toTypeName) that participate in a
 * reference cycle, including direct self-references. A schema is "recursive" when it is
 * reachable from itself through the component-schema reference graph.
 *
 * These schemas cannot be expressed via `z.infer<typeof FooSchema>` once their Zod schema is
 * annotated `z.ZodType<Foo>` (it would be a circular, excessively-deep type instantiation), so
 * the types plugin emits a concrete `interface` for them and the zod plugin annotates the lazy
 * schema with that model type.
 */
export function findRecursiveSchemaNames(spec: OpenAPIV3_1.Document): Set<string> {
  const schemas = spec.components?.schemas as
    Record<string, SchemaObject | ReferenceObject> | undefined
  if (schemas === undefined) return new Set()

  const edges = new Map<string, Set<string>>()
  for (const [name, schema] of Object.entries(schemas)) {
    const refs = new Set<string>()
    collectComponentRefNames(schema, refs)
    edges.set(toTypeName(name), refs)
  }

  const recursive = new Set<string>()
  for (const start of edges.keys()) {
    if (reachableFromSelf(start, edges)) recursive.add(start)
  }
  return recursive
}
