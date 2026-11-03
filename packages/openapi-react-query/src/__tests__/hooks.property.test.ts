import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateHooks } from '../plugins/hooks.js'

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

describe('property-based tests — generateHooks invariants', () => {
  // Property 1: generator never throws
  it('never throws on any generated spec', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        expect(() => generateHooks(spec, { staleTime: 0, gcTime: 0 })).not.toThrow()
      }),
      { numRuns: 500 }
    )
  })

  // Property 2: every GET produces a useQuery hook
  it('every GET produces a useQuery hook named use + PascalCase(operationId)', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
        for (const pathItem of Object.values(spec.paths ?? {})) {
          const op = (pathItem as Record<string, unknown>)['get'] as
            { operationId?: string } | undefined
          if (!op?.operationId) continue
          const hookName = 'use' + op.operationId[0]!.toUpperCase() + op.operationId.slice(1)
          expect(content).toContain(`export function ${hookName}<TData = `)
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 3: every mutation produces a useMutation hook
  it('every POST/PUT/PATCH/DELETE produces a useMutation hook', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
        for (const pathItem of Object.values(spec.paths ?? {})) {
          for (const method of ['post', 'put', 'patch', 'delete'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string } | undefined
            if (!op?.operationId) continue
            const hookName = 'use' + op.operationId[0]!.toUpperCase() + op.operationId.slice(1)
            expect(content).toContain(`export function ${hookName}(`)
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  // Property 4: key factory always defines all() when any GET exists
  // NOTE: The invariant checks for the definition `all:` in the key factory, not a call site `.all()`.
  // A call to `.all()` only appears in mutation onSuccess handlers (autoInvalidate mode); a detail-only
  // spec with no mutations correctly defines `all:` without ever calling it.
  it('key factory defines all() method whenever there is at least one GET operation', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const hasGet = Object.values(spec.paths ?? {}).some(
          (p) => (p as Record<string, unknown>)?.['get'] !== undefined
        )
        if (!hasGet) return // skip specs with no GET
        const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
        // The key factory always includes an `all:` method definition
        expect(content).toContain('all:')
      }),
      { numRuns: 300 }
    )
  })

  // Property 5: hooks with 2+ path params always use && in enabled guard
  it('detail hooks with 2+ path params use && in enabled guard', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
        for (const [_path, pathItem] of Object.entries(spec.paths ?? {})) {
          const op = (pathItem as Record<string, unknown>)['get'] as
            { operationId?: string; parameters?: Array<{ in: string }> } | undefined
          if (!op?.operationId) continue
          const params = (op.parameters ?? []).filter((p) => p.in === 'path')
          if (params.length < 2) continue
          // The enabled guard should AND all params together
          expect(content).toContain('&&')
        }
      }),
      { numRuns: 200 }
    )
  })

  // Property 6: with autoInvalidate, mutations only reference key factories that are generated.
  // Previously buggy: the generator emitted `${resource}Keys.all()` even for mutation-only
  // resources (no GET ops), producing a ReferenceError because the key factory was never defined.
  // Fixed by gating invalidateInfo on resourceToGetOps.has(resource).
  it('with autoInvalidate, mutation hooks only reference key factories that are generated', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, autoInvalidate: true })

        // Collect all key factory names that ARE generated (only for resources with GET ops)
        const resourcesWithGets = new Set<string>()
        for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
          const op = (pathItem as Record<string, unknown>)['get']
          if (op === undefined) continue
          // Extract primary resource (mirrors primaryResource() function)
          const stripped = path.replace(/^\/api\/v\d+\//, '').replace(/^\//, '')
          const firstSegment = (stripped.split('/')[0] ?? 'resource').replace(/[{}]/g, '')
          resourcesWithGets.add(firstSegment)
        }

        // For each resource that appears in mutation ops but NOT in GET ops,
        // a key factory reference in onSuccess is invalid (undefined reference)
        for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
          for (const method of ['post', 'put', 'patch', 'delete'] as const) {
            const op = (pathItem as Record<string, unknown>)[method] as
              { operationId?: string } | undefined
            if (!op?.operationId) continue

            const stripped = path.replace(/^\/api\/v\d+\//, '').replace(/^\//, '')
            const firstSegment = (stripped.split('/')[0] ?? 'resource').replace(/[{}]/g, '')

            if (!resourcesWithGets.has(firstSegment)) {
              // This mutation is on a resource with no GET → generator will still emit
              // `${factoryName}.all()` in the mutation hook, but the factory is never defined
              const hookName = 'use' + op.operationId[0]!.toUpperCase() + op.operationId.slice(1)
              const hookStart = content.indexOf(`export function ${hookName}(`)
              if (hookStart === -1) continue
              const hookEnd = content.indexOf('\n}', hookStart) + 2
              const hookContent = content.slice(hookStart, hookEnd)

              // The generated hook will reference factoryName (e.g. itemKeys)
              // but that factory is never exported — check if the factory is defined
              const camel = firstSegment.replace(/[-_](.)/g, (_: string, c: string) =>
                c.toUpperCase()
              )
              const singular = camel.endsWith('s') ? camel.slice(0, -1) : camel
              const factoryName = `${singular}Keys`

              if (hookContent.includes(`${factoryName}.all()`)) {
                // The key factory reference exists in the hook — verify the factory is exported
                expect(content).toContain(`export const ${factoryName}`)
              }
            }
          }
        }
      }),
      { numRuns: 200 }
    )
  })

  // Property 7: generated content always starts with the auto-generated header comment
  it('generated output always starts with the auto-generated header comment', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
        expect(content).toMatch(/^\/\/ (This file is auto-generated|Generated)/)
      }),
      { numRuns: 200 }
    )
  })

  // Property 8: filename is always hooks.ts
  it('filename is always hooks.ts', () => {
    fc.assert(
      fc.property(arbSpec, (spec) => {
        const { filename } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
        expect(filename).toBe('hooks.ts')
      }),
      { numRuns: 100 }
    )
  })
})
