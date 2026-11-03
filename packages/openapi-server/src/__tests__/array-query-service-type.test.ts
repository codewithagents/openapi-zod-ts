/**
 * Regression tests for issue #375: integer/number array query params must produce
 * a service type of number[] (not string[]), matching the Fastify router's
 * z.array(z.coerce.number()) coercion so the router can forward req.query
 * to the service without TS2322.
 *
 * Delimited arrays (explode:false) always arrive as a single string that the router
 * splits into string tokens, so their service type stays string[] regardless of item type.
 */
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateService } from '../plugins/service.js'
import { generateFastifyTypedService } from '../plugins/fastify-service.js'

function makeSpec(paths: OpenAPIV3_1.PathsObject): OpenAPIV3_1.Document {
  return { openapi: '3.1.0', info: { title: 'Test API', version: '1.0.0' }, paths }
}

function makeArrayQuerySpec(
  paramName: string,
  itemType: string,
  opts: { required?: boolean; style?: string; explode?: boolean } = {}
): OpenAPIV3_1.Document {
  const param: OpenAPIV3_1.ParameterObject = {
    name: paramName,
    in: 'query',
    required: opts.required ?? false,
    schema: {
      type: 'array',
      items: { type: itemType as 'string' | 'integer' | 'number' | 'boolean' },
    },
    ...(opts.style !== undefined ? { style: opts.style } : {}),
    ...(opts.explode !== undefined ? { explode: opts.explode } : {}),
  }
  return makeSpec({
    '/items': {
      get: {
        operationId: 'getItems',
        parameters: [param],
        responses: { '200': { description: 'ok' } },
      },
    },
  })
}

describe('generateService: array query param service types (#375)', () => {
  it('integer array (explode default) produces number[] service type', () => {
    const spec = makeArrayQuerySpec('ids', 'integer')
    const { content } = generateService(spec)
    expect(content).toContain('ids?: number[]')
    expect(content).not.toContain('ids?: string[]')
  })

  it('number array (explode default) produces number[] service type', () => {
    const spec = makeArrayQuerySpec('scores', 'number')
    const { content } = generateService(spec)
    expect(content).toContain('scores?: number[]')
    expect(content).not.toContain('scores?: string[]')
  })

  it('boolean array (explode default) produces boolean[] service type', () => {
    const spec = makeArrayQuerySpec('flags', 'boolean')
    const { content } = generateService(spec)
    expect(content).toContain('flags?: boolean[]')
    expect(content).not.toContain('flags?: string[]')
  })

  it('string array (explode default) stays string[] service type', () => {
    const spec = makeArrayQuerySpec('tags', 'string')
    const { content } = generateService(spec)
    expect(content).toContain('tags?: string[]')
  })

  it('required integer array produces required number[] field in params object', () => {
    const spec = makeArrayQuerySpec('ids', 'integer', { required: true })
    const { content } = generateService(spec)
    // Required: no ? after field name
    expect(content).toContain('ids: number[]')
    expect(content).not.toContain('ids?: number[]')
  })

  it('delimited integer array (style:form, explode:false) stays string[] in service type', () => {
    // explode:false arrays arrive as a single comma-delimited string; the router splits them
    // and validates each token as z.string() regardless of item type. Service type must match.
    const spec = makeArrayQuerySpec('ids', 'integer', { style: 'form', explode: false })
    const { content } = generateService(spec)
    expect(content).toContain('ids?: string[]')
    expect(content).not.toContain('ids?: number[]')
  })

  it('delimited number array (spaceDelimited, explode:false) stays string[] in service type', () => {
    const spec = makeArrayQuerySpec('scores', 'number', { style: 'spaceDelimited', explode: false })
    const { content } = generateService(spec)
    expect(content).toContain('scores?: string[]')
    expect(content).not.toContain('scores?: number[]')
  })

  it('delimited boolean array (pipeDelimited, explode:false) stays string[] in service type', () => {
    const spec = makeArrayQuerySpec('flags', 'boolean', { style: 'pipeDelimited', explode: false })
    const { content } = generateService(spec)
    expect(content).toContain('flags?: string[]')
    expect(content).not.toContain('flags?: boolean[]')
  })
})

describe('generateFastifyTypedService: array query param service types (#375)', () => {
  it('integer array (explode default) produces number[] in Fastify service query facet', () => {
    const spec = makeArrayQuerySpec('counts', 'integer')
    const { content } = generateFastifyTypedService(spec, {
      schemaNames: new Set<string>(),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('counts?: number[]')
    expect(content).not.toContain('counts?: string[]')
  })

  it('boolean array (explode default) produces boolean[] in Fastify service query facet', () => {
    const spec = makeArrayQuerySpec('active', 'boolean')
    const { content } = generateFastifyTypedService(spec, {
      schemaNames: new Set<string>(),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('active?: boolean[]')
    expect(content).not.toContain('active?: string[]')
  })

  it('string array stays string[] in Fastify service query facet', () => {
    const spec = makeArrayQuerySpec('labels', 'string')
    const { content } = generateFastifyTypedService(spec, {
      schemaNames: new Set<string>(),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('labels?: string[]')
  })

  it('delimited integer array (explode:false) stays string[] in Fastify service query facet', () => {
    const spec = makeArrayQuerySpec('ids', 'integer', { style: 'form', explode: false })
    const { content } = generateFastifyTypedService(spec, {
      schemaNames: new Set<string>(),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('ids?: string[]')
    expect(content).not.toContain('ids?: number[]')
  })
})
