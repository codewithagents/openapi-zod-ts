/**
 * Runtime regression tests for scalar (non-array) query param coercion in the generated
 * routers. These EXECUTE the generated router against real requests.
 *
 * Hono: a scalar boolean query param used to be read as a raw string and validated with
 * z.boolean(), so `?flag=true` was rejected with 422.
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Hono } from 'hono'
import { generateRouter } from '../plugins/router.js'
import { generateService } from '../plugins/service.js'
import { emitSharedErrorsFile } from '../plugins/errors-emitter.js'
import { cleanupRuntimeScratch, loadGeneratedModule } from './runtime-helpers.js'
import { assertNoTsDiagnostics, compileGeneratedFiles } from './ts-compile-helpers.js'

afterAll(() => cleanupRuntimeScratch())

const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Flags API', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          { name: 'flag', in: 'query', required: false, schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
}

/** Echo service: returns whatever query object the router passed in. */
const echoService = {
  listItems: async (query: Record<string, unknown>) => ({ query }),
}

type RouterModule<App> = { createRouter: (service: unknown) => App }

describe('Hono router: scalar boolean query params', () => {
  async function app(): Promise<Hono> {
    const mod = await loadGeneratedModule<RouterModule<Hono>>({
      'router.ts': generateRouter(spec).content,
    })
    return mod.createRouter(echoService)
  }

  it('?flag=true reaches the service as boolean true', async () => {
    const res = await (await app()).request('/items?flag=true')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ query: { flag: true } })
  })

  it('?flag=false reaches the service as boolean false', async () => {
    const res = await (await app()).request('/items?flag=false')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ query: { flag: false } })
  })

  it('absent flag stays undefined', async () => {
    const res = await (await app()).request('/items')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ query: {} })
  })

  it('?flag=yes is still rejected with 422', async () => {
    const res = await (await app()).request('/items?flag=yes')
    expect(res.status).toBe(422)
  })
})

describe('generated routers with scalar boolean/number query params typecheck', () => {
  it.each([['Hono', generateRouter]] as const)('%s', (label, gen) => {
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateService(spec).content,
      'router.ts': gen(spec).content,
      '_shared/errors.ts': emitSharedErrorsFile().content,
    })
    assertNoTsDiagnostics(diagnostics, `${label} scalar query coercion`)
  })

  it('emits the _toQueryBool helper only when a scalar boolean query param exists', () => {
    expect(generateRouter(spec).content.match(/function _toQueryBool/g)).toHaveLength(1)
    const noBool: OpenAPIV3_1.Document = {
      ...spec,
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(generateRouter(noBool).content).not.toContain('_toQueryBool')
  })
})
