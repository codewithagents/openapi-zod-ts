/**
 * Regression tests for issue #375 (Blocker 2): non-object path-items (e.g. a JSON array,
 * null, or primitive) are silently dropped with 0 routes and 0 methods and no diagnostic.
 * warnOnNonObjectPathItems, called from generateService, surfaces the drop via console.warn.
 */
import { describe, expect, it, vi } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateService } from '../plugins/service.js'

function makeSpec(paths: unknown, title = 'Test API'): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    paths: paths as OpenAPIV3_1.PathsObject,
  }
}

/**
 * Generate the service under a console.warn spy and return the generated content plus only
 * the malformed-path warnings (other diagnostics like "response type is unknown" are excluded),
 * so each test asserts on a clean list without repeating the spy/try/finally boilerplate.
 */
function generateAndCollectMalformedWarnings(spec: OpenAPIV3_1.Document): {
  content: string
  warnings: string[]
} {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const { content } = generateService(spec)
    const warnings = warnSpy.mock.calls
      .map((call) => call[0])
      .filter(
        (m): m is string => typeof m === 'string' && m.includes('not a valid Path Item Object')
      )
    return { content, warnings }
  } finally {
    warnSpy.mockRestore()
  }
}

describe('warnOnNonObjectPathItems (#375)', () => {
  it('array path-item emits exactly one console.warn naming the path', () => {
    const { content, warnings } = generateAndCollectMalformedWarnings(
      makeSpec({
        '/broken': [],
        '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } },
      })
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"/broken"')
    expect(warnings[0]).toContain('not a valid Path Item Object')
    expect(warnings[0]).toContain('got array')
    // /ok still generates a method in the service
    expect(content).toContain('ok(')
  })

  it('null path-item emits a warning with "got null"', () => {
    const { warnings } = generateAndCollectMalformedWarnings(makeSpec({ '/null-path': null }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('got null')
  })

  it('string primitive path-item emits a warning with the primitive type', () => {
    const { warnings } = generateAndCollectMalformedWarnings(makeSpec({ '/string-path': 'oops' }))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('got string')
  })

  it('valid but operation-less path item ({}) does NOT trigger the malformed-path warning', () => {
    const { warnings } = generateAndCollectMalformedWarnings(
      makeSpec({
        '/empty': {},
        '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } },
      })
    )
    // The empty-object path item is valid: no malformed warning expected.
    expect(warnings).toHaveLength(0)
  })

  it('normal spec with only object path-items does NOT trigger the malformed-path warning', () => {
    const { warnings } = generateAndCollectMalformedWarnings(
      makeSpec({
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
              },
            },
          },
        },
      })
    )
    expect(warnings).toHaveLength(0)
  })

  it('multiple malformed path-items each get their own warning', () => {
    const { warnings } = generateAndCollectMalformedWarnings(
      makeSpec({
        '/a': [],
        '/b': null,
        '/ok': { get: { operationId: 'ok', responses: { '200': { description: 'ok' } } } },
      })
    )
    expect(warnings).toHaveLength(2)
    expect(warnings.some((m) => m.includes('"/a"'))).toBe(true)
    expect(warnings.some((m) => m.includes('"/b"'))).toBe(true)
  })
})
