import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateTypes } from '../plugins/types.js'
import { generateZodSchemas } from '../plugins/zod.js'
import { generateClient } from '../plugins/client.js'
import { generateClientConfig } from '../plugins/client-config.js'
import { generateIndexBarrel } from '../plugins/index-barrel.js'
import { normalizeNullable } from '../utils/normalize-nullable.js'

// ── Arbitrary generators ────────────────────────────────────────────────────

/** Valid JS identifier: starts with lowercase letter, letters+digits, length 3–12 */
const arbOperationId = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,11}$/)

/** Valid JS identifier for path params: length 2–8 */
const arbPathParam = fc.stringMatching(/^[a-z][a-z0-9]{1,7}$/)

/** Valid PascalCase schema name: starts with uppercase, length 3–10 */
const arbSchemaName = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{2,9}$/)

/** Query param object */
const arbQueryParam = fc.record({
  name: arbPathParam,
  required: fc.boolean(),
})

/** Realistic resource names */
const RESOURCES = [
  'items',
  'tasks',
  'users',
  'projects',
  'orders',
  'reports',
  'documents',
  'records',
]

/** Generates realistic path strings */
const arbPath: fc.Arbitrary<string> = fc.oneof(
  // /resources (no path params)
  fc.constantFrom(...RESOURCES).map((r) => `/${r}`),
  // /resources/{id} (1 path param)
  fc.tuple(fc.constantFrom(...RESOURCES), arbPathParam).map(([r, p]) => `/${r}/{${p}}`),
  // /resources/{p1}/sub/{p2} (2 path params)
  fc
    .tuple(fc.constantFrom(...RESOURCES), arbPathParam, fc.constantFrom(...RESOURCES), arbPathParam)
    .map(([r, p1, sub, p2]) => `/${r}/{${p1}}/${sub}/{${p2}}`)
)

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

const arbHttpMethod: fc.Arbitrary<HttpMethod> = fc.constantFrom(
  'get',
  'post',
  'put',
  'patch',
  'delete'
)

function extractPathParams(path: string): string[] {
  const matches = path.match(/\{([^}]+)\}/g)
  if (matches === null) return []
  return matches.map((m) => m.slice(1, -1))
}

interface ArbOp {
  operationId: string
  method: HttpMethod
  path: string
  pathParams: string[]
  hasBody: boolean
  queryParams: { name: string; required: boolean }[]
}

/** Generates a single operation object */
const arbOperation: fc.Arbitrary<ArbOp> = fc
  .tuple(
    arbOperationId,
    arbHttpMethod,
    arbPath,
    fc.array(arbQueryParam, { minLength: 0, maxLength: 3 })
  )
  .map(([operationId, method, path, queryParams]) => {
    const pathParams = extractPathParams(path)
    const hasBody = method === 'post' || method === 'put' || method === 'patch'
    return { operationId, method, path, pathParams, hasBody, queryParams }
  })

/** Generates a small set of schema component names */
const arbSchemaNames: fc.Arbitrary<string[]> = fc.array(arbSchemaName, {
  minLength: 0,
  maxLength: 4,
})

/** Build a valid OpenAPI 3.1 document from ArbOp list and optional schema names */
function buildSpec(ops: ArbOp[], schemaNames: string[]): OpenAPIV3_1.Document {
  const paths: OpenAPIV3_1.PathsObject = {}
  for (const op of ops) {
    if (!paths[op.path]) paths[op.path] = {}
    const parameters = [
      ...op.pathParams.map((p) => ({
        name: p,
        in: 'path' as const,
        required: true,
        schema: { type: 'string' as const },
      })),
      ...op.queryParams.map((q) => ({
        name: q.name,
        in: 'query' as const,
        required: q.required,
        schema: { type: 'string' as const },
      })),
    ]
    ;(paths[op.path] as Record<string, unknown>)[op.method] = {
      operationId: op.operationId,
      parameters,
      ...(op.hasBody
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          }
        : {}),
      responses: { '200': { description: 'ok' } },
    }
  }

  // Build components.schemas from the schema names — each gets a simple object schema
  const schemas: Record<string, OpenAPIV3_1.SchemaObject> = {}
  for (const name of schemaNames) {
    schemas[name] = {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    }
  }

  const doc: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0.0' },
    paths,
  }

  if (schemaNames.length > 0) {
    doc.components = { schemas }
  }

  return doc
}

/**
 * Generate a spec from 1–8 operations with unique operationIds, and 0–4 schemas.
 * Ensures no duplicate (path, method) pairs and unique operationIds.
 */
const arbSpec: fc.Arbitrary<OpenAPIV3_1.Document> = fc
  .tuple(fc.array(arbOperation, { minLength: 1, maxLength: 8 }), arbSchemaNames)
  .map(([ops, rawSchemaNames]) => {
    // Deduplicate by (path, method) — last one wins
    const seen = new Map<string, ArbOp>()
    for (const op of ops) {
      seen.set(`${op.path}:${op.method}`, op)
    }
    const deduped = Array.from(seen.values())

    // Make operationIds unique by appending index
    const uniqueOps = deduped.map((op, i) => ({ ...op, operationId: `${op.operationId}${i}` }))

    // Deduplicate schema names (case-sensitive)
    const uniqueSchemaNames = Array.from(new Set(rawSchemaNames))

    return buildSpec(uniqueOps, uniqueSchemaNames)
  })

// ── Property tests ──────────────────────────────────────────────────────────

describe('property-based tests — openapi-zod-ts generator invariants', () => {
  // Property 1: generateTypes never throws on any generated spec
  it('generateTypes never throws on any generated spec', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        expect(() => generateTypes(spec)).not.toThrow()
      }),
      { numRuns: 500 }
    )
  })

  // Property 2: generateClient never throws on any generated spec
  it('generateClient never throws on any generated spec', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        expect(() => generateClient(spec)).not.toThrow()
      }),
      { numRuns: 500 }
    )
  })

  // Property 3: every schema component name appears in models.ts content
  it('every schema component name appears in models.ts content', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateTypes(spec)
        const schemas = spec.components?.schemas as Record<string, unknown> | undefined
        if (schemas === undefined) return
        for (const name of Object.keys(schemas)) {
          // The name appears as either `interface ${name}` or `type ${name}`
          expect(content).toMatch(new RegExp(`(interface|type) ${name}[\\s{=]`))
        }
      }),
      { numRuns: 400 }
    )
  })

  // Property 4: every operationId produces a matching async function in client.ts
  it('every operationId produces a matching async function in client.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateClient(spec)
        for (const pathItem of Object.values(spec.paths ?? {})) {
          for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string } | undefined
            if (!op?.operationId) continue
            // Generator lowercases the first character of the operationId
            const id = op.operationId
            const funcName = id.charAt(0).toLowerCase() + id.slice(1)
            expect(content).toContain(`export async function ${funcName}(`)
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 5: path params always appear as required positional parameters in client.ts
  it('path params always appear as required positional parameters in client.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateClient(spec)
        for (const pathItem of Object.values(spec.paths ?? {})) {
          for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string; parameters?: Array<{ in: string; name: string }> } | undefined
            if (!op?.operationId) continue
            const pathParams = (op.parameters ?? []).filter((p) => p.in === 'path')
            if (pathParams.length === 0) continue
            const id = op.operationId
            const funcName = id.charAt(0).toLowerCase() + id.slice(1)
            // Find the function in content and check all path params are in the signature
            const funcStart = content.indexOf(`export async function ${funcName}(`)
            expect(funcStart).toBeGreaterThanOrEqual(0)
            const funcEnd = content.indexOf('\n}', funcStart) + 2
            const funcContent = content.slice(funcStart, funcEnd)
            for (const param of pathParams) {
              expect(funcContent).toContain(`${param.name}: string`)
            }
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 6: operations with requestBody produce a `body` parameter in client.ts
  it('operations with requestBody produce a body parameter in client.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateClient(spec)
        for (const pathItem of Object.values(spec.paths ?? {})) {
          for (const method of ['post', 'put', 'patch'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string; requestBody?: unknown } | undefined
            if (!op?.operationId || !op.requestBody) continue
            const id = op.operationId
            const funcName = id.charAt(0).toLowerCase() + id.slice(1)
            const funcStart = content.indexOf(`export async function ${funcName}(`)
            expect(funcStart).toBeGreaterThanOrEqual(0)
            const funcEnd = content.indexOf('\n}', funcStart) + 2
            const funcContent = content.slice(funcStart, funcEnd)
            expect(funcContent).toContain('body:')
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 7: generated models.ts always starts with the auto-generated header comment
  it('generated models.ts always starts with the auto-generated header comment', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateTypes(spec)
        expect(content).toMatch(/^\/\/ This file is auto-generated by openapi-zod-ts/)
      }),
      { numRuns: 200 }
    )
  })

  // Property 8: generated client.ts always starts with the auto-generated header comment
  it('generated client.ts always starts with the auto-generated header comment', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateClient(spec)
        expect(content).toMatch(/^\/\/ This file is auto-generated by openapi-zod-ts/)
      }),
      { numRuns: 200 }
    )
  })

  // Property 9: client-config.ts is always generated with the correct filename
  it('client-config.ts is always generated with the correct filename', () => {
    const { filename, content } = generateClientConfig()
    expect(filename).toBe('client-config.ts')
    expect(content).toMatch(/^\/\/ This file is auto-generated by openapi-zod-ts/)
  })

  // Property 10: index.ts barrel is always generated with the correct filename
  it('index.ts barrel is always generated with the correct filename', () => {
    const { filename, content } = generateIndexBarrel()
    expect(filename).toBe('index.ts')
    expect(content).toMatch(/^\/\/ This file is auto-generated by openapi-zod-ts/)
  })

  // Property 11: models.ts filename is always models.ts
  it('models.ts filename is always models.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { filename } = generateTypes(spec)
        expect(filename).toBe('models.ts')
      }),
      { numRuns: 100 }
    )
  })

  // Property 12: client.ts filename is always client.ts
  it('client.ts filename is always client.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { filename } = generateClient(spec)
        expect(filename).toBe('client.ts')
      }),
      { numRuns: 100 }
    )
  })
})

// ── Schema-shape property tests: "no unknown for concretely-representable schemas" ──────────────
//
// Every schema the arbitrary can produce has a concrete, well-typed representation.
// If the generator falls back to `unknown` (or `z.unknown()`) for any of them, it is a bug.
// This is the regression net for the #383/#390 class of unknown-fallback bugs.

type SchemaLiteral = OpenAPIV3_1.SchemaObject & { nullable?: boolean }

/**
 * A fixed property key index used when building Container object properties
 * from the arbitrary. Keys must be valid JS identifiers.
 */
const PROP_KEYS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'] as const

/**
 * Recursive arbitrary for concretely-representable OpenAPI 3.1 schemas.
 * Depth is capped at 3 to bound the generated size.
 *
 * INVARIANT: every schema produced here has a well-defined non-unknown representation
 * in BOTH models.ts (TypeScript types) and schemas.ts (Zod v4 schemas). Any `unknown`
 * in the generator output is therefore a bug.
 */
const arbSchema: fc.Memo<SchemaLiteral> = fc.memo((depth: number) => {
  // Base cases (depth = 0 or leaf nodes)
  const primitives: fc.Arbitrary<SchemaLiteral>[] = [
    fc.constant({ type: 'string' } as SchemaLiteral),
    fc.constant({ type: 'string', format: 'email' } as SchemaLiteral),
    fc.constant({ type: 'string', format: 'uuid' } as SchemaLiteral),
    fc.constant({ type: 'string', format: 'date-time' } as SchemaLiteral),
    fc.constant({ type: 'string', format: 'date' } as SchemaLiteral),
    fc.constant({ type: 'integer' } as SchemaLiteral),
    fc.constant({ type: 'integer', format: 'int64' } as SchemaLiteral),
    fc.constant({ type: 'number' } as SchemaLiteral),
    fc.constant({ type: 'boolean' } as SchemaLiteral),
    // String enum: only primitive values, never object/array
    fc.constant({
      type: 'string',
      enum: ['active', 'inactive', 'pending'],
    } as SchemaLiteral),
    // Integer enum: only primitive values
    fc.constant({
      type: 'integer',
      enum: [1, 2, 3],
    } as SchemaLiteral),
    // Nullable 3.1 type-array forms (primitives only at depth 0)
    fc.constant({ type: ['string', 'null'] } as unknown as SchemaLiteral),
    fc.constant({ type: ['integer', 'null'] } as unknown as SchemaLiteral),
    fc.constant({ type: ['number', 'null'] } as unknown as SchemaLiteral),
    fc.constant({ type: ['boolean', 'null'] } as unknown as SchemaLiteral),
    // Multi-type primitive unions (no structural members here)
    fc.constant({ type: ['string', 'integer'] } as unknown as SchemaLiteral),
    fc.constant({ type: ['string', 'integer', 'null'] } as unknown as SchemaLiteral),
    // $ref to fixed component schemas
    fc.constant({ $ref: '#/components/schemas/Item' } as unknown as SchemaLiteral),
    fc.constant({ $ref: '#/components/schemas/Tag' } as unknown as SchemaLiteral),
    fc.constant({ $ref: '#/components/schemas/Status' } as unknown as SchemaLiteral),
    // Composition of fixed component refs (never inline-only unknown shapes)
    fc.constant({
      allOf: [{ $ref: '#/components/schemas/Item' }, { $ref: '#/components/schemas/Tag' }],
    } as SchemaLiteral),
    fc.constant({
      anyOf: [{ $ref: '#/components/schemas/Item' }, { $ref: '#/components/schemas/Tag' }],
    } as SchemaLiteral),
    fc.constant({
      oneOf: [{ $ref: '#/components/schemas/Item' }, { $ref: '#/components/schemas/Tag' }],
    } as SchemaLiteral),
  ]

  if (depth <= 0) {
    return fc.oneof(...primitives)
  }

  // Recursive cases that require depth > 0
  const propKey1 = fc.constantFrom(...PROP_KEYS)
  const propKey2 = fc.constantFrom(...PROP_KEYS)

  // Array with concrete items (ALWAYS has items: non-unknown schema)
  const arbArray: fc.Arbitrary<SchemaLiteral> = arbSchema(depth - 1).map((items) => ({
    type: 'array',
    items,
  }))

  // Object with >=1 concrete property (ALWAYS has properties, NEVER empty)
  const arbObject: fc.Arbitrary<SchemaLiteral> = fc
    .tuple(propKey1, arbSchema(depth - 1))
    .map(([key, propSchema]) => ({
      type: 'object',
      properties: { [key]: propSchema },
    }))

  // Record with concrete additionalProperties (NEVER additionalProperties: true)
  const arbRecord: fc.Arbitrary<SchemaLiteral> = arbSchema(depth - 1).map((valSchema) => ({
    type: 'object',
    additionalProperties: valSchema,
  }))

  // Object with 2 properties from two independent keys
  const arbObject2: fc.Arbitrary<SchemaLiteral> = fc
    .tuple(propKey1, propKey2, arbSchema(depth - 1), arbSchema(depth - 1))
    .map(([k1, k2, s1, s2]) => ({
      type: 'object',
      properties: { [k1]: s1, [k2]: s2 },
    }))

  // Nullable 3.1 array with concrete items: type: ['array','null']
  const arbNullableArray: fc.Arbitrary<SchemaLiteral> = arbSchema(depth - 1).map((items) => ({
    type: ['array', 'null'],
    items,
  }))

  // Nullable 3.1 object with >=1 property: type: ['object','null']
  const arbNullableObject: fc.Arbitrary<SchemaLiteral> = fc
    .tuple(propKey1, arbSchema(depth - 1))
    .map(([key, propSchema]) => ({
      type: ['object', 'null'],
      properties: { [key]: propSchema },
    }))

  // Nullable 3.0 form (nullable: true) on a primitive: normalizeNullable converts to type-array
  const arbNullable30Primitive: fc.Arbitrary<SchemaLiteral> = fc
    .constantFrom(
      { type: 'string', nullable: true },
      { type: 'integer', nullable: true },
      { type: 'number', nullable: true },
      { type: 'boolean', nullable: true }
    )
    .map((s) => s as SchemaLiteral)

  // Multi-type union with structural object member: type: ['object','string','null'] with properties
  const arbMultiTypeObject: fc.Arbitrary<SchemaLiteral> = fc
    .tuple(propKey1, arbSchema(depth - 1))
    .map(([key, propSchema]) => ({
      type: ['object', 'string', 'null'],
      properties: { [key]: propSchema },
    }))

  // Multi-type union with structural array member: type: ['array','integer','null'] with items
  const arbMultiTypeArray: fc.Arbitrary<SchemaLiteral> = arbSchema(depth - 1).map((items) => ({
    type: ['array', 'integer', 'null'],
    items,
  }))

  return fc.oneof(
    ...primitives,
    arbArray,
    arbObject,
    arbRecord,
    arbObject2,
    arbNullableArray,
    arbNullableObject,
    arbNullable30Primitive,
    arbMultiTypeObject,
    arbMultiTypeArray
  )
})

/** Fixed component schemas used as $ref targets and in allOf/anyOf/oneOf composition. */
const FIXED_COMPONENTS: Record<string, OpenAPIV3_1.SchemaObject> = {
  Item: {
    type: 'object',
    properties: { id: { type: 'string' }, value: { type: 'integer' } },
    required: ['id'],
  },
  Tag: {
    type: 'object',
    properties: { name: { type: 'string' }, active: { type: 'boolean' } },
    required: ['name'],
  },
  Status: {
    type: 'string',
    enum: ['active', 'inactive', 'pending'],
  },
}

/**
 * Build a spec with fixed components plus a Container schema whose properties
 * are generated by the schema arbitrary.
 */
function buildSchemaShapeSpec(containerProps: Record<string, SchemaLiteral>): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title: 'SchemaShapeTest', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        ...FIXED_COMPONENTS,
        Container: {
          type: 'object',
          properties: containerProps as Record<string, OpenAPIV3_1.SchemaObject>,
        },
      },
    },
  }
}

describe('property-based tests — schema-shape: no unknown for concretely-representable schemas', () => {
  it('generateTypes and generateZodSchemas never emit unknown for concretely-representable schemas (numRuns: 1000)', () => {
    // Build an arbitrary for the Container's properties: 1-3 keys, each with an arbSchema value
    const arbContainerProps: fc.Arbitrary<Record<string, SchemaLiteral>> = fc
      .tuple(
        fc.constantFrom(...PROP_KEYS),
        fc.constantFrom(...PROP_KEYS),
        fc.constantFrom(...PROP_KEYS),
        arbSchema(3),
        arbSchema(3),
        arbSchema(3),
        fc.integer({ min: 1, max: 3 })
      )
      .map(([k1, k2, k3, s1, s2, s3, count]) => {
        const keys = [k1, k2, k3]
        const schemas = [s1, s2, s3]
        const props: Record<string, SchemaLiteral> = {}
        for (let i = 0; i < count; i++) {
          props[keys[i]!] = schemas[i]!
        }
        return props
      })

    fc.assert(
      fc.property(arbContainerProps, (containerProps) => {
        // Build spec and apply normalizeNullable to mirror the real CLI pipeline
        const spec = buildSchemaShapeSpec(containerProps)
        normalizeNullable(spec)

        // Generate both outputs
        const { content: typesContent } = generateTypes(spec)
        const { content: zodContent } = generateZodSchemas(spec)

        // Strip comment lines before checking: the schemas.ts file header always contains
        // "unknown" in a comment ("strips unknown keys before sending"), which is not a bug.
        const nonCommentLines = (content: string): string =>
          content
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('//'))
            .join('\n')

        const typesNonComment = nonCommentLines(typesContent)
        const zodNonComment = nonCommentLines(zodContent)

        // Neither non-comment output should contain 'unknown': if it does, the generator fell
        // back for a concretely-representable schema, which is always a bug.
        expect(typesNonComment, 'models.ts must not contain unknown').not.toContain('unknown')
        expect(zodNonComment, 'schemas.ts must not contain unknown').not.toContain('unknown')
      }),
      { numRuns: 1000 }
    )
  })
})
