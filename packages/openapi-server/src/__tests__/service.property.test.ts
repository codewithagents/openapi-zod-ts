import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateService } from '../plugins/service.js'

// ── Arbitrary generators ────────────────────────────────────────────────────

/** Valid JS identifier: starts with letter, letters+digits, length 3–12 */
const arbOperationId = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,11}$/)

/** Valid JS identifier for path params: length 2–8 */
const arbPathParam = fc.stringMatching(/^[a-z][a-z0-9]{1,7}$/)

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

/** Build a valid OpenAPI 3.1 document from ArbOp list */
function buildSpec(ops: ArbOp[]): OpenAPIV3_1.Document {
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
  return { openapi: '3.1.0', info: { title: 'Test', version: '1.0.0' }, paths }
}

/**
 * Generate a spec from 1–8 operations with unique operationIds.
 * Ensures no duplicate (path, method) pairs and unique operationIds.
 */
const arbSpec: fc.Arbitrary<OpenAPIV3_1.Document> = fc
  .array(arbOperation, { minLength: 1, maxLength: 8 })
  .map((ops) => {
    // Deduplicate by (path, method) — last one wins
    const seen = new Map<string, ArbOp>()
    for (const op of ops) {
      seen.set(`${op.path}:${op.method}`, op)
    }
    const deduped = Array.from(seen.values())

    // Make operationIds unique by appending index
    const uniqueOps = deduped.map((op, i) => ({ ...op, operationId: `${op.operationId}${i}` }))
    return buildSpec(uniqueOps)
  })

// ── Property tests ──────────────────────────────────────────────────────────

describe('property-based tests — generateService invariants', () => {
  // Property 1: generator never throws
  it('never throws on any generated spec', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        expect(() => generateService(spec)).not.toThrow()
      }),
      { numRuns: 500 }
    )
  })

  // Property 2: every operationId produces a method in the interface
  it('every operationId produces a method in the interface', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateService(spec)
        for (const pathItem of Object.values(spec.paths ?? {})) {
          for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string } | undefined
            if (!op?.operationId) continue
            const methodName = op.operationId.charAt(0).toLowerCase() + op.operationId.slice(1)
            expect(content).toContain(`${methodName}(`)
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 3: operations with path params have those params in the signature
  it('operations with path params have those params as positional string args', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateService(spec)
        for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
          // Extract path params from the path template
          const pathParams = (path.match(/\{([^}]+)\}/g) ?? []).map((m) => m.slice(1, -1))
          if (pathParams.length === 0) continue

          for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string } | undefined
            if (!op?.operationId) continue

            // Each path param should appear as "paramName: string" in the content
            for (const param of pathParams) {
              expect(content).toContain(`${param}: string`)
            }
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 4: filename is always service.ts
  it('filename is always service.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { filename } = generateService(spec)
        expect(filename).toBe('service.ts')
      }),
      { numRuns: 100 }
    )
  })

  // Property 5: generated content always starts with auto-generated header
  it('generated content always starts with auto-generated header comment', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateService(spec)
        expect(content).toMatch(/^\/\/ This file is auto-generated/)
      }),
      { numRuns: 200 }
    )
  })

  // Property 6: generated content always contains the service interface
  it('generated content always contains an exported interface', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateService(spec)
        expect(content).toMatch(/export interface \w+Service \{/)
      }),
      { numRuns: 200 }
    )
  })
})
