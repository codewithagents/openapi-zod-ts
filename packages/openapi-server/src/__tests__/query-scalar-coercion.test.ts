/**
 * Runtime regression tests for scalar (non-array) query param coercion in the generated
 * routers. These EXECUTE the generated router against real requests.
 *
 * Hono: a scalar boolean query param used to be read as a raw string and validated with
 * z.boolean(), so `?flag=true` was rejected with 422.
 *
 * Express: an absent optional numeric param was emitted as `Number(undefined)` (NaN → 422)
 * and an absent optional boolean became `false`; any non-'true' value was silently `false`.
 *
 * Fastify: the querystring schema used z.boolean() for a scalar boolean, but Fastify's
 * querystring parser never converts types, so `?flag=true` was rejected with 400.
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Hono } from 'hono'
import type { AddressInfo } from 'node:net'
import express from 'express'
import Fastify from 'fastify'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from '../plugins/router.js'
import { generateFastifyTypedService } from '../plugins/fastify-service.js'
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

/** Mount an Express router on a real HTTP server (port 0) and GET `path`. */
async function expressGet(path: string): Promise<{ status: number; body: unknown }> {
  const mod = await loadGeneratedModule<RouterModule<express.Router>>({
    'router.ts': generateExpressRouter(spec).content,
  })
  const app = express()
  app.use(express.json())
  app.use(mod.createRouter(echoService))
  const server = app.listen(0)
  await new Promise<void>((r) => server.once('listening', () => r()))
  try {
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}${path}`)
    return { status: res.status, body: await res.json() }
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
}

describe('Express router: absent optional scalar query params', () => {
  it('absent optional integer stays undefined (not NaN → 422)', async () => {
    const res = await expressGet('/items')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ query: {} })
  })

  it('?limit=5 is coerced to the number 5', async () => {
    const res = await expressGet('/items?limit=5')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ query: { limit: 5 } })
  })

  it('?limit=abc is rejected with 422', async () => {
    expect((await expressGet('/items?limit=abc')).status).toBe(422)
  })

  it('?flag=true / ?flag=false reach the service as booleans', async () => {
    expect((await expressGet('/items?flag=true')).body).toEqual({ query: { flag: true } })
    expect((await expressGet('/items?flag=false')).body).toEqual({ query: { flag: false } })
  })

  it('absent optional boolean stays undefined (not false)', async () => {
    const res = await expressGet('/items?limit=1')
    expect(res.body).toEqual({ query: { limit: 1 } })
  })

  it('?flag=yes is rejected with 422 instead of silently becoming false', async () => {
    // limit=1 keeps the (pre-fix NaN) numeric param valid so only the boolean is under test.
    expect((await expressGet('/items?limit=1&flag=yes')).status).toBe(422)
  })
})

describe('Fastify router: scalar boolean / absent optional query params', () => {
  async function inject(url: string): Promise<{ status: number; body: unknown }> {
    const mod = await loadGeneratedModule<{
      createRouter: (service: unknown) => Parameters<ReturnType<typeof Fastify>['register']>[0]
    }>({ 'router.ts': generateFastifyRouter(spec).content })
    const app = Fastify()
    await app.register(
      mod.createRouter({
        listItems: async (input: { query: Record<string, unknown> }) => ({ query: input.query }),
      })
    )
    const res = await app.inject({ method: 'GET', url })
    await app.close()
    return { status: res.statusCode, body: res.json() }
  }

  it('?flag=true / ?flag=false reach the service as booleans', async () => {
    expect(await inject('/items?flag=true')).toEqual({
      status: 200,
      body: { query: { flag: true } },
    })
    expect(await inject('/items?flag=false')).toEqual({
      status: 200,
      body: { query: { flag: false } },
    })
  })

  it('absent optional params stay undefined', async () => {
    expect(await inject('/items')).toEqual({ status: 200, body: { query: {} } })
  })

  it('?flag=yes and ?limit=abc are rejected with 400', async () => {
    expect((await inject('/items?flag=yes')).status).toBe(400)
    expect((await inject('/items?limit=abc')).status).toBe(400)
  })
})

describe('generated routers with scalar boolean/number query params typecheck', () => {
  it('Fastify', () => {
    const opts = { schemaNames: new Set<string>(), schemaImportPath: './schemas.js' }
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateFastifyTypedService(spec, opts).content,
      'router.ts': generateFastifyRouter(spec, opts).content,
      '_shared/errors.ts': emitSharedErrorsFile().content,
    })
    assertNoTsDiagnostics(diagnostics, 'Fastify scalar query coercion')
  })

  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s', (label, gen) => {
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
