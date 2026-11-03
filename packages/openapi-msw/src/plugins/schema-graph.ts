/**
 * Reference graph over components.schemas, used by fixtures.ts to tell a $ref that stays
 * acyclic (a plain builder call, which always terminates) from one that leads back into the
 * referencing schema's own cycle (wrapped in the generated recursion guard).
 */
import type { SchemaOrRef } from './faker-expr.js'

/**
 * Component schema a `$ref` value points at, by the same rule as faker-expr's resolveRef
 * (last pointer segment), so every edge the expression builder can follow is an edge here.
 */
function refTarget(value: unknown, schemas: Record<string, SchemaOrRef>): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.split('/').pop() ?? ''
  return Object.hasOwn(schemas, name) ? name : undefined
}

/** Names of the component schemas directly referenced anywhere inside `node`. */
function collectRefs(node: unknown, schemas: Record<string, SchemaOrRef>, out: Set<string>): void {
  if (typeof node !== 'object' || node === null) return
  // Object.entries covers arrays too (index keys), so one loop walks both shapes.
  for (const [key, value] of Object.entries(node)) {
    const target = key === '$ref' ? refTarget(value, schemas) : undefined
    if (target !== undefined) out.add(target)
    else collectRefs(value, schemas, out)
  }
}

interface TarjanState {
  edges: Map<string, Set<string>>
  index: Map<string, number>
  low: Map<string, number>
  stack: string[]
  onStack: Set<string>
  component: Map<string, number>
  nextIndex: number
  nextComponent: number
}

function popComponent(name: string, s: TarjanState): void {
  let member: string | undefined
  do {
    member = s.stack.pop()!
    s.onStack.delete(member)
    s.component.set(member, s.nextComponent)
  } while (member !== name)
  s.nextComponent++
}

function strongConnect(name: string, s: TarjanState): void {
  s.index.set(name, s.nextIndex)
  s.low.set(name, s.nextIndex)
  s.nextIndex++
  s.stack.push(name)
  s.onStack.add(name)
  for (const next of s.edges.get(name) ?? []) {
    if (!s.index.has(next)) {
      strongConnect(next, s)
      s.low.set(name, Math.min(s.low.get(name)!, s.low.get(next)!))
    } else if (s.onStack.has(next)) {
      s.low.set(name, Math.min(s.low.get(name)!, s.index.get(next)!))
    }
  }
  if (s.low.get(name) === s.index.get(name)) popComponent(name, s)
}

/**
 * Strongly connected component id per schema name (Tarjan). Two schemas share an id exactly
 * when each can reach the other through $refs, i.e. they sit on a common reference cycle.
 */
export function referenceCycles(schemas: Record<string, SchemaOrRef>): Map<string, number> {
  const edges = new Map<string, Set<string>>()
  for (const [name, schema] of Object.entries(schemas)) {
    const refs = new Set<string>()
    collectRefs(schema, schemas, refs)
    edges.set(name, refs)
  }
  const state: TarjanState = {
    edges,
    index: new Map(),
    low: new Map(),
    stack: [],
    onStack: new Set(),
    component: new Map(),
    nextIndex: 0,
    nextComponent: 0,
  }
  for (const name of edges.keys()) {
    if (!state.index.has(name)) strongConnect(name, state)
  }
  return state.component
}
