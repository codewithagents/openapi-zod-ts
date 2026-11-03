import type { OpenAPIV3_1 } from 'openapi-types'
import { toTypeName, uniquifyName } from 'openapi-zod-ts'
import {
  quote,
  resolveSchema,
  schemaToFaker,
  type FakerExprContext,
  type SchemaOrRef,
} from './faker-expr.js'
import type { GeneratedFile } from './handlers.js'
import { referenceCycles } from './schema-graph.js'

export interface FixtureGenOptions {
  /** Base seed mixed into every builder's per-call seed, default 42 */
  seed: number
  /** Array length in generated values, default 3 */
  maxArrayItems: number
  /** Max schema recursion depth before emitting null, default 30 */
  depthCap: number
  /** Module specifier the model types are imported from, default './models.js' */
  modelsImport: string
}

/** Reference date for every relative faker date in fixtures.ts (determinism across calls/days). */
const FIXTURE_REF_DATE = '2025-01-01T00:00:00.000Z'

interface FixtureTarget {
  /** Raw components.schemas key */
  rawName: string
  /** Exported model type name in models.ts */
  typeName: string
  /** Builder function name: a<TypeName> / an<TypeName> */
  builderName: string
  schema: SchemaOrRef
  /** Object model type: the builder takes `overrides` and merges them */
  objectLike: boolean
}

/**
 * Model type names exactly as openapi-zod-ts emits them in models.ts: toTypeName per key,
 * with later collisions suffixed _2, _3, ... in components.schemas insertion order.
 */
function modelTypeNames(schemaNames: string[]): string[] {
  const used = new Set<string>()
  return schemaNames.map((name) => uniquifyName(toTypeName(name), used))
}

function builderNameFor(typeName: string): string {
  return /^[AEIOU]/.test(typeName) ? `an${typeName}` : `a${typeName}`
}

function article(builderName: string): string {
  return builderName.startsWith('an') ? 'An' : 'A'
}

/** Stable 32-bit FNV-1a hash of a schema name: the builder's fixed seed component. */
function builderKey(rawName: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < rawName.length; i++) {
    hash ^= rawName.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * True when the model type is an object that `{ ...base, ...overrides }` can merge into:
 * the schema (after following $ref aliases) declares properties, an allOf, or type object.
 */
function isObjectLike(schema: SchemaOrRef, schemas: Record<string, SchemaOrRef>): boolean {
  const resolved = resolveSchema(schema, schemas)
  if (resolved === undefined) return false
  if (resolved.properties !== undefined) return true
  if (resolved.allOf !== undefined && resolved.allOf.length > 0) return true
  const types = Array.isArray(resolved.type) ? resolved.type : [resolved.type]
  return types.includes('object')
}

interface FixturePlan {
  byName: Map<string, FixtureTarget>
  /** Reference-cycle (SCC) id per schema name */
  cycles: Map<string, number>
}

/**
 * Call expression for another schema's builder, inside a `build` closure. The nested variant
 * is drawn from the caller's seeded faker, so it is deterministic per outer call yet differs
 * between siblings (three array items get three distinct values, not three copies).
 */
function builderCall(ref: FixtureTarget, full: boolean): string {
  // Inside .full(), nested builders are .full() too, up to FULL_DEPTH levels (runtime check).
  const b = ref.builderName
  const fn = full ? `(fullDepth < FULL_DEPTH ? ${b}.full : ${b})` : b
  const variant = 'faker.number.int(0xffffffff)'
  return ref.objectLike ? `${fn}(undefined, ${variant})` : `${fn}(${variant})`
}

/**
 * Faker expression for one builder. Every $ref to a component schema calls that schema's
 * builder, which keeps the file linear in the number of schemas (inlining blew a large
 * real-world spec up to a 248 MB file). Calls between different reference cycles form an
 * acyclic graph and always terminate. A $ref back into this schema's own cycle (including
 * a self-reference) is wrapped in `cyclic(...)`, which yields null once one cyclic call is
 * already in progress, so recursive schemas stop after one nested level at runtime.
 */
function builderExpr(
  target: FixtureTarget,
  plan: FixturePlan,
  ctx: FakerExprContext,
  full: boolean
): string {
  const ownCycle = plan.cycles.get(target.rawName)
  const refExpr = (name: string): string | undefined => {
    const ref = plan.byName.get(name)
    if (ref === undefined) return undefined
    const call = builderCall(ref, full)
    return plan.cycles.get(name) === ownCycle ? `cyclic(() => ${call})` : call
  }
  return schemaToFaker(target.schema, { ...ctx, refExpr })
}

function emitObjectBuilder(t: FixtureTarget, required: string, full: string): string {
  const { typeName: T, builderName: fn } = t
  const key = builderKey(t.rawName)
  return [
    `/** ${article(fn)} \`${T}\` with required properties only; \`overrides\` are shallow-merged on top. */`,
    `export function ${fn}(overrides?: Partial<${T}>, variant = 0): ${T} {`,
    `  return merge(build<${T}>(${key}, variant, () => (${required})), overrides)`,
    `}`,
    `/** ${article(fn)} \`${T}\` with optional properties filled too (see FULL_DEPTH). */`,
    `${fn}.full = (overrides?: Partial<${T}>, variant = 0): ${T} =>`,
    `  merge(deeper(() => build<${T}>(${key}, variant, () => (${full}))), overrides)`,
  ].join('\n')
}

function emitValueBuilder(t: FixtureTarget, required: string, full: string): string {
  const { typeName: T, builderName: fn } = t
  const key = builderKey(t.rawName)
  return [
    `/** ${article(fn)} \`${T}\` value; nested objects carry required properties only. */`,
    `export function ${fn}(variant = 0): ${T} {`,
    `  return build<${T}>(${key}, variant, () => (${required}))`,
    `}`,
    `/** ${article(fn)} \`${T}\` value with nested optional properties filled (see FULL_DEPTH). */`,
    `${fn}.full = (variant = 0): ${T} => deeper(() => build<${T}>(${key}, variant, () => (${full})))`,
  ].join('\n')
}

const CYCLIC_GUARD = [
  ``,
  `// Recursion guard for schemas on a reference cycle: one nested level, then null.`,
  `let cycleDepth = 0`,
  `function cyclic<T>(make: () => T): T | null {`,
  `  if (cycleDepth > 0) return null`,
  `  cycleDepth++`,
  `  try {`,
  `    return make()`,
  `  } finally {`,
  `    cycleDepth--`,
  `  }`,
  `}`,
]

function emitBuilder(target: FixtureTarget, plan: FixturePlan, ctx: FakerExprContext): string {
  const required = builderExpr(target, plan, { ...ctx, requiredOnly: true }, false)
  const full = builderExpr(target, plan, ctx, true)
  return target.objectLike
    ? emitObjectBuilder(target, required, full)
    : emitValueBuilder(target, required, full)
}

const HEADER = [
  `// This file is auto-generated by @codewithagents/openapi-msw, do not edit`,
  `//`,
  `// Fixture builders: one a<Name>() / an<Name>() per component schema, for inline per-test`,
  `// handlers (server.use(http.get(..., () => HttpResponse.json(aTask({ title: 'x' }))))).`,
  `//`,
  `// Determinism: every call reseeds a private Faker instance from (seed, builder, variant),`,
  `// so a given call always returns the same value, independent of call order, test order`,
  `// or the handlers.ts global faker sequence. Pass a different \`variant\` for a different`,
  `// (still deterministic) value, e.g. two distinct items in one list.`,
  `//`,
  `// a<Name>() fills required properties only; a<Name>.full() fills optional ones too, for`,
  `// itself and FULL_DEPTH - 1 nested builder level (deeper nesting is required-only).`,
  `// Overrides are shallow-merged and typed against the generated models.`,
]

export function generateFixtures(
  spec: OpenAPIV3_1.Document,
  opts: FixtureGenOptions
): GeneratedFile {
  const schemas = (spec.components?.schemas ?? {}) as Record<string, SchemaOrRef>
  const rawNames = Object.keys(schemas)
  const typeNames = modelTypeNames(rawNames)
  const targets: FixtureTarget[] = rawNames.map((rawName, i) => ({
    rawName,
    typeName: typeNames[i]!,
    builderName: builderNameFor(typeNames[i]!),
    schema: schemas[rawName]!,
    objectLike: isObjectLike(schemas[rawName]!, schemas),
  }))
  const plan: FixturePlan = {
    byName: new Map(targets.map((t) => [t.rawName, t])),
    cycles: referenceCycles(schemas),
  }
  const ctx: FakerExprContext = {
    schemas,
    maxItems: opts.maxArrayItems,
    depthCap: opts.depthCap,
    omitWriteOnly: true,
  }

  // `Faker` is aliased: a component schema named "Faker" would otherwise clash with it.
  // Type names are PascalCase (or `_<digit>...`), so the helper names below (`_Faker`, `faker`, `build`, `merge`,
  // `cyclic`, `cycleDepth`, `deeper`, `fullDepth`, `FULL_DEPTH`) cannot collide with a type.
  const lines = [...HEADER]
  if (targets.length === 0) {
    lines.push(``, `export {}`)
  } else {
    lines.push(
      `import { Faker as _Faker, base, en } from '@faker-js/faker'`,
      `import type { ${targets.map((t) => t.typeName).join(', ')} } from ${quote(opts.modelsImport)}`,
      ``,
      `const faker = new _Faker({ locale: [en, base] })`,
      `// Fixed reference date: faker.date.recent() etc. are otherwise relative to "now",`,
      `// which would make date fields differ between two otherwise identical calls.`,
      `faker.setDefaultRefDate(${quote(FIXTURE_REF_DATE)})`,
      ``,
      `function build<T>(key: number, variant: number, make: () => unknown): T {`,
      `  faker.seed([${opts.seed}, key, variant])`,
      `  return make() as T`,
      `}`,
      ``,
      `// Shallow merge. Typed loosely on purpose: some model types (unions, unknown) are not`,
      `// spreadable, while the public builder signatures still type-check \`overrides\`.`,
      `function merge<T>(base: T, overrides: Partial<T> | undefined): T {`,
      `  return { ...(base as object), ...(overrides as object | undefined) } as T`,
      `}`,
      ``,
      `// .full() fills optional properties for FULL_DEPTH nested builder levels, then nested`,
      `// builders fall back to required-only, so wide schema graphs stay bounded in size.`,
      `const FULL_DEPTH = 2`,
      `let fullDepth = 0`,
      `function deeper<T>(make: () => T): T {`,
      `  fullDepth++`,
      `  try {`,
      `    return make()`,
      `  } finally {`,
      `    fullDepth--`,
      `  }`,
      `}`
    )
    const builders = targets.map((target) => emitBuilder(target, plan, ctx))
    // Only specs with a reference cycle call cyclic(); emitting it otherwise leaves an
    // unused function in the generated file.
    if (builders.some((b) => b.includes('cyclic(() =>'))) lines.push(...CYCLIC_GUARD)
    for (const builder of builders) lines.push(``, builder)
  }

  return { filename: 'fixtures.ts', content: lines.join('\n') }
}
