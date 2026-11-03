/**
 * Regression tests for codegen typing bugs #298, #299, #300.
 *
 * #298 - Inline object response schemas produce Record<string, unknown>
 * #299 - Array query params with bracket notation (ids[]) typed as unknown and serialized flat
 * #300 - Path params typed as string instead of number via $ref to shared parameter component
 *
 * Each test is written first (TDD) to confirm the existing failure, then a fix is applied.
 */
import { describe, it, expect } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateClient } from '../plugins/client.js'
import { generateClientConfig } from '../plugins/client-config.js'
import { generateTypes } from '../plugins/types.js'
import { compileFiles } from './helpers.js'

// ---------------------------------------------------------------------------
// Bug #298: Inline object response schema produces Record<string, unknown>
// ---------------------------------------------------------------------------

describe('Bug #298: inline object response schema is expanded', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Users API', version: '1' },
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/User' },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }

  it('return type is an expanded inline object, not Record<string, unknown>', () => {
    const { content } = generateClient(spec)
    // Must NOT fall back to the Record catch-all
    expect(content).not.toContain('Promise<Record<string, unknown>>')
    // Must expand the inline properties
    expect(content).toContain('data: User[]')
    expect(content).toContain('total?: number')
  })

  it('required properties are non-optional and optional properties carry ?', () => {
    const { content } = generateClient(spec)
    // data is in required[], total is not
    expect(content).toContain('data: User[]')
    expect(content).not.toMatch(/data\?:\s*User\[\]/)
    expect(content).toContain('total?: number')
  })

  it('generated client compiles without TypeScript errors', () => {
    const modelsContent = generateTypes(spec).content
    const clientContent = generateClient(spec).content
    const configContent = generateClientConfig().content

    const diagnostics = compileFiles({
      'models.ts': modelsContent,
      'client-config.ts': configContent,
      'client.ts': clientContent,
    })
    expect(diagnostics).toHaveLength(0)
  })
})

describe('Bug #298: inline object with only additionalProperties still produces Record', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Dict API', version: '1' },
    paths: {
      '/dict': {
        get: {
          operationId: 'getDict',
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }

  it('additionalProperties-only object still maps to Record<string, string>', () => {
    const { content } = generateClient(spec)
    expect(content).toContain('Promise<Record<string, string>>')
  })
})

// ---------------------------------------------------------------------------
// Bug #299: Array query params with bracket notation
// ---------------------------------------------------------------------------

describe('Bug #299: bracket-notation array query params keep wire name as interface key', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Search API', version: '1' },
    paths: {
      '/search': {
        get: {
          operationId: 'search',
          parameters: [
            {
              name: 'ids[]',
              in: 'query',
              required: false,
              schema: { type: 'array', items: { type: 'integer' } },
              style: 'form',
              explode: true,
            },
          ],
          responses: {
            '200': {
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  }

  it('params interface key is the wire name "ids[]" (with bracket notation)', () => {
    const { content } = generateClient(spec)
    // The interface should preserve the bracket notation in the key
    expect(content).toContain('"ids[]"')
    // The normalized plain name should NOT appear as the field key
    expect(content).not.toMatch(/params\?\s*:\s*\{[^}]*\bids\?:\s*number/)
  })

  it('params field is typed number[] for integer array items', () => {
    const { content } = generateClient(spec)
    expect(content).toContain("'ids[]'?: number[]")
  })

  it('serialization uses for-of loop with append (not String() + set)', () => {
    const { content } = generateClient(spec)
    // Must use for...of with append (multi-value serialization)
    expect(content).toContain('searchParams.append')
    expect(content).not.toMatch(/searchParams\.set\('ids\[\]'/)
    // Must iterate over the wire-name key
    expect(content).toContain('params["ids[]"]')
  })

  it('serialization appends with the wire key "ids[]"', () => {
    const { content } = generateClient(spec)
    expect(content).toContain("searchParams.append('ids[]'")
  })
})

describe('Bug #299: string array bracket-notation param', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Tags API', version: '1' },
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            {
              name: 'tags[]',
              in: 'query',
              required: false,
              schema: { type: 'array', items: { type: 'string' } },
            },
          ],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  }

  it('string array bracket param is typed string[]', () => {
    const { content } = generateClient(spec)
    expect(content).toContain("'tags[]'?: string[]")
  })
})

describe('Bug #299: non-bracket params still use normalized name', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Items API', version: '1' },
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            {
              name: 'place.fields',
              in: 'query',
              required: false,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { type: 'array', items: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  }

  it('non-bracket dot-separated param is still normalized to camelCase', () => {
    const { content } = generateClient(spec)
    // Dot-separated names are still normalized (camelCase)
    expect(content).toContain('placeFields?: string')
  })
})

// ---------------------------------------------------------------------------
// Bug #300: Path params typed as string instead of number via $ref
// ---------------------------------------------------------------------------

describe('Bug #300: path param via $ref to component with integer schema typed as number', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Users API', version: '1' },
    components: {
      parameters: {
        PathId: {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'integer', minimum: 1 },
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          parameters: [{ $ref: '#/components/parameters/PathId' } as any],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
      },
    },
  }

  it('path param referenced via $ref with integer schema is typed number, not string', () => {
    const { content } = generateClient(spec)
    expect(content).toContain('id: number')
    expect(content).not.toMatch(/getUserById\([^)]*id:\s*string/)
  })

  it('generated client with $ref path param compiles without TypeScript errors', () => {
    const modelsContent = generateTypes(spec).content
    const clientContent = generateClient(spec).content
    const configContent = generateClientConfig().content

    const diagnostics = compileFiles({
      'models.ts': modelsContent,
      'client-config.ts': configContent,
      'client.ts': clientContent,
    })
    expect(diagnostics).toHaveLength(0)
  })
})

describe('Bug #300: inline path param with integer schema also typed number', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Posts API', version: '1' },
    paths: {
      '/posts/{postId}': {
        get: {
          operationId: 'getPost',
          parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }

  it('inline path param with integer schema is typed number', () => {
    const { content } = generateClient(spec)
    expect(content).toContain('postId: number')
    expect(content).not.toMatch(/getPost\([^)]*postId:\s*string/)
  })
})

describe('Bug #300: path param with string schema stays typed as string', () => {
  const spec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Fictional Items API', version: '1' },
    paths: {
      '/items/{slug}': {
        get: {
          operationId: 'getItem',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              content: {
                'application/json': { schema: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }

  it('path param with string schema stays string', () => {
    const { content } = generateClient(spec)
    expect(content).toContain('slug: string')
  })
})
