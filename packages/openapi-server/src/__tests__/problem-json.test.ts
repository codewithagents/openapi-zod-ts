/**
 * error_format: 'problem+json' (#194): router-produced errors become RFC 9457 / RFC 7807
 * `application/problem+json` bodies in Hono, Express and Fastify. Runtime tests execute the
 * generated router against real requests.
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Hono } from 'hono'
import express from 'express'
import Fastify from 'fastify'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from '../plugins/router.js'
import { generateService } from '../plugins/service.js'
import { generateFastifyTypes, generateFastifyTypedService } from '../plugins/fastify-service.js'
import { emitSharedErrorsFile } from '../plugins/errors-emitter.js'
import { cleanupRuntimeScratch, loadGeneratedModule } from './runtime-helpers.js'
import { assertNoTsDiagnostics, compileGeneratedFiles } from './ts-compile-helpers.js'

afterAll(() => cleanupRuntimeScratch())

const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Pet API', version: '1.0.0' },
  paths: {
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
      get: {
        operationId: 'listPets',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 10 } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
    },
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      NewPet: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
}

const schemasTs = `import { z } from 'zod'
export const NewPetSchema = z.object({ name: z.string() })
export const PetSchema = z.object({ id: z.string(), name: z.string() })
`
const schemaNames = new Set(['NewPetSchema', 'PetSchema'])
const schemaOpts = { schemaNames, schemaImportPath: './schemas.js' }
const problemOpts = { ...schemaOpts, errorFormat: 'problem+json' as const }

class FakeHttpError extends Error {}

/** Service implementation shared by Hono/Express (positional) and Fastify (input object). */
function makeService(HttpError: new (status: number, message: string) => Error) {
  return {
    createPet: async (body: { name: string }) => ({ id: 'p1', name: body.name }),
    listPets: async () => [],
    getPet: async (idOrInput: string | { params: { id: string } }) => {
      const id = typeof idOrInput === 'string' ? idOrInput : idOrInput.params.id
      if (id === 'boom') throw new FakeHttpError('unexpected')
      throw new HttpError(404, `Pet ${id} not found`)
    },
  }
}

interface RouterModule<App> {
  createRouter: (service: unknown) => App
  HttpError: new (status: number, message: string) => Error
}

const PROBLEM_CT = /^application\/problem\+json/

describe('Hono: error_format problem+json', () => {
  async function app(): Promise<Hono> {
    const mod = await loadGeneratedModule<RouterModule<Hono>>({
      'router.ts': generateRouter(spec, problemOpts).content,
      'schemas.ts': schemasTs,
    })
    return mod.createRouter(makeService(mod.HttpError))
  }
  const postJson = (a: Hono, body: string, ct = 'application/json') =>
    a.request('/pets', { method: 'POST', headers: { 'content-type': ct }, body })

  it('body validation failure -> 422 problem with zod issues under errors', async () => {
    const res = await postJson(await app(), JSON.stringify({ nope: 1 }))
    expect(res.status).toBe(422)
    expect(res.headers.get('content-type')).toMatch(PROBLEM_CT)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: 'Invalid request body',
      instance: '/pets',
    })
    expect(Array.isArray(body['errors'])).toBe(true)
    expect((body['errors'] as Array<{ path: unknown }>)[0]!.path).toEqual(['name'])
  })

  it('query validation failure -> 422 problem', async () => {
    const res = await (await app()).request('/pets?limit=99')
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ status: 422, detail: 'Invalid query parameters' })
  })

  it('invalid JSON -> 400 problem, unsupported media type -> 415 problem (no errors member)', async () => {
    const bad = await postJson(await app(), '{')
    expect(bad.status).toBe(400)
    const badBody = await bad.json()
    expect(badBody).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid JSON body',
      instance: '/pets',
    })
    const ct = await postJson(await app(), 'x', 'text/plain')
    expect(ct.status).toBe(415)
    expect(ct.headers.get('content-type')).toMatch(PROBLEM_CT)
    expect(await ct.json()).toMatchObject({ title: 'Unsupported Media Type', status: 415 })
  })

  it('HttpError -> problem with its status and message as detail', async () => {
    const res = await (await app()).request('/pets/42')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(PROBLEM_CT)
    expect(await res.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Pet 42 not found',
      instance: '/pets/42',
    })
  })

  it('a valid request is unaffected', async () => {
    const res = await postJson(await app(), JSON.stringify({ name: 'Rex' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'p1', name: 'Rex' })
  })
})

describe('Express: error_format problem+json', () => {
  async function call(
    path: string,
    init?: RequestInit
  ): Promise<{ status: number; ct: string | null; body: unknown }> {
    const mod = await loadGeneratedModule<RouterModule<express.Router>>({
      'router.ts': generateExpressRouter(spec, problemOpts).content,
      'schemas.ts': schemasTs,
    })
    const app = express()
    app.use(express.json())
    app.use('/api', mod.createRouter(makeService(mod.HttpError)))
    const server = app.listen(0)
    await new Promise<void>((r) => server.once('listening', () => r()))
    try {
      const { port } = server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}${path}`, init)
      return { status: res.status, ct: res.headers.get('content-type'), body: await res.json() }
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  }

  it('body validation failure -> 422 problem; instance includes the mount path', async () => {
    const res = await call('/api/pets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    expect(res.ct).toMatch(PROBLEM_CT)
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: 'Invalid request body',
      instance: '/api/pets',
    })
    expect(Array.isArray((res.body as { errors?: unknown }).errors)).toBe(true)
  })

  it('query validation failure -> 422 problem', async () => {
    const res = await call('/api/pets?limit=99')
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ detail: 'Invalid query parameters' })
  })

  it('HttpError -> problem', async () => {
    const res = await call('/api/pets/7')
    expect(res.status).toBe(404)
    expect(res.ct).toMatch(PROBLEM_CT)
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Pet 7 not found',
      instance: '/api/pets/7',
    })
  })
})

describe('Fastify: error_format problem+json via the generated setErrorHandler', () => {
  async function inject(opts: {
    method: 'GET' | 'POST'
    url: string
    payload?: string
    headers?: Record<string, string>
  }) {
    const mod = await loadGeneratedModule<{
      createRouter: (service: unknown) => Parameters<ReturnType<typeof Fastify>['register']>[0]
      HttpError: new (status: number, message: string) => Error
    }>({
      'router.ts': generateFastifyRouter(spec, { ...problemOpts, zeroCast: true }).content,
      'schemas.ts': schemasTs,
    })
    const app = Fastify()
    const service = makeService(mod.HttpError)
    await app.register(
      mod.createRouter({
        ...service,
        createPet: async (input: { body: { name: string } }) => service.createPet(input.body),
      }),
      { prefix: '/v1' }
    )
    const res = await app.inject(opts)
    await app.close()
    return res
  }

  it('request validation failure -> 400 problem with validation entries under errors', async () => {
    const res = await inject({
      method: 'POST',
      url: '/v1/pets',
      payload: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toMatch(PROBLEM_CT)
    const body = res.json() as Record<string, unknown>
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'Invalid request body',
      instance: '/v1/pets',
    })
    expect(Array.isArray(body['errors'])).toBe(true)
  })

  it('HttpError -> problem', async () => {
    const res = await inject({ method: 'GET', url: '/v1/pets/9?x=1' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toMatch(PROBLEM_CT)
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Pet 9 not found',
      instance: '/v1/pets/9',
    })
  })

  it('other 4xx framework errors (415) -> problem', async () => {
    const res = await inject({
      method: 'POST',
      url: '/v1/pets',
      payload: 'x',
      headers: { 'content-type': 'text/xml' },
    })
    expect(res.statusCode).toBe(415)
    expect(res.headers['content-type']).toMatch(PROBLEM_CT)
    expect(res.json()).toMatchObject({ title: 'Unsupported Media Type', status: 415 })
  })

  it('non-HttpError service errors are re-thrown (Fastify default 500, not problem+json)', async () => {
    const res = await inject({ method: 'GET', url: '/v1/pets/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.headers['content-type']).not.toMatch(PROBLEM_CT)
  })
})

describe('error_format default output is unchanged', () => {
  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
    ['Fastify', generateFastifyRouter],
  ] as const)('%s', (_, gen) => {
    const base = gen(spec, schemaOpts).content
    expect(gen(spec, { ...schemaOpts, errorFormat: 'default' }).content).toBe(base)
    expect(base).not.toContain('problem+json')
    expect(gen(spec, problemOpts).content).toContain('application/problem+json')
  })
})

describe('problem+json routers typecheck', () => {
  const errors = emitSharedErrorsFile().content
  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s', (label, gen) => {
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateService(spec).content,
      'router.ts': gen(spec, problemOpts).content,
      'schemas.ts': schemasTs,
      'models.ts':
        'export interface NewPet { name: string }\nexport interface Pet { id: string; name: string }\n',
      '_shared/errors.ts': errors,
    })
    assertNoTsDiagnostics(diagnostics, `${label} problem+json`)
  })

  it('Fastify', () => {
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateFastifyTypedService(spec, schemaOpts).content,
      'schema-types.ts': generateFastifyTypes(schemaNames, './schemas.js').content,
      'router.ts': generateFastifyRouter(spec, { ...problemOpts, zeroCast: true }).content,
      'schemas.ts': schemasTs,
      '_shared/errors.ts': errors,
    })
    assertNoTsDiagnostics(diagnostics, 'Fastify problem+json')
  })
})

describe('problem+json covers cookie validation', () => {
  const cookieSpec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Cookie API', version: '1.0.0' },
    paths: {
      '/me': {
        get: {
          operationId: 'getMe',
          parameters: [
            { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
          ],
          responses: { '204': { description: 'ok' } },
        },
      },
    },
  }

  it('Fastify cookie 422 uses _problem', () => {
    const { content } = generateFastifyRouter(cookieSpec, { errorFormat: 'problem+json' })
    expect(content).toContain(
      "return _problem(reply, req.url.split('?')[0]!, 422, 'Invalid request cookies', _ckv.error.issues)"
    )
  })

  it('Hono and Express cookie 422 use _problem', () => {
    expect(generateRouter(cookieSpec, { errorFormat: 'problem+json' }).content).toContain(
      "return _problem(c.req.path, 422, 'Invalid request cookies', _ckv.error.issues)"
    )
    expect(generateExpressRouter(cookieSpec, { errorFormat: 'problem+json' }).content).toContain(
      "return void _problem(res, req.baseUrl + req.path, 422, 'Invalid request cookies', _ckv.error.issues)"
    )
  })
})
