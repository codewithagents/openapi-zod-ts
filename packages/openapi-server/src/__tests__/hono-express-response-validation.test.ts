/**
 * emit_response_validation for Hono and Express (#194): the router safeParses each JSON service
 * result against the response schema before sending. On failure it responds 500 and never
 * sends the result. Same fallback semantics as the Fastify emitter: a named schema from
 * input_schema for $ref / array-of-$ref responses, else a synthesized inline schema, else no
 * check (Fastify would attach z.unknown()).
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Hono } from 'hono'
import express from 'express'
import { generateRouter, generateExpressRouter } from '../plugins/router.js'
import { generateService } from '../plugins/service.js'
import { emitSharedErrorsFile } from '../plugins/errors-emitter.js'
import { cleanupRuntimeScratch, loadGeneratedModule } from './runtime-helpers.js'
import { assertNoTsDiagnostics, compileGeneratedFiles } from './ts-compile-helpers.js'

afterAll(() => cleanupRuntimeScratch())

const json = (schema: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject) => ({
  description: 'ok',
  content: { 'application/json': { schema } },
})

const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Kennel API', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: {
          '200': json({ type: 'array', items: { $ref: '#/components/schemas/Pet' } }),
        },
      },
      post: {
        operationId: 'createPet',
        responses: { '201': json({ $ref: '#/components/schemas/Pet' }) },
      },
    },
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': json({ $ref: '#/components/schemas/Pet' }) },
      },
    },
    '/stats': {
      get: {
        operationId: 'getStats',
        responses: {
          '200': json({
            type: 'object',
            required: ['count'],
            properties: { count: { type: 'integer' } },
          }),
        },
      },
    },
    '/blob': {
      get: {
        operationId: 'getBlob',
        // $ref with no named schema in input_schema: no response check (z.unknown() semantics).
        responses: { '200': json({ $ref: '#/components/schemas/Blob' }) },
      },
    },
    '/ping': {
      get: { operationId: 'ping', responses: { '204': { description: 'no content' } } },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
      Blob: { type: 'object' },
    },
  },
}

const schemasTs = `import { z } from 'zod'
export const PetSchema = z.object({ id: z.string(), name: z.string() })
`
const schemaOpts = { schemaNames: new Set(['PetSchema']), schemaImportPath: './schemas.js' }
const rvOpts = { ...schemaOpts, emitResponseValidation: true }

/** Mutable service: each test sets what the handlers return. */
const results: Record<string, unknown> = {}
const service = {
  listPets: async () => results['listPets'],
  createPet: async () => results['createPet'],
  getPet: async () => results['getPet'],
  getStats: async () => results['getStats'],
  getBlob: async () => results['getBlob'],
  ping: async () => undefined,
}

type Caller = (path: string, method?: string) => Promise<{ status: number; body: unknown }>

async function honoCaller(opts: object): Promise<Caller> {
  const mod = await loadGeneratedModule<{ createRouter: (s: unknown) => Hono }>({
    'router.ts': generateRouter(spec, opts).content,
    'schemas.ts': schemasTs,
  })
  const app = mod.createRouter(service)
  return async (path, method = 'GET') => {
    const res = await app.request(path, { method })
    const text = await res.text()
    return { status: res.status, body: text === '' ? undefined : JSON.parse(text) }
  }
}

async function expressCaller(opts: object): Promise<Caller> {
  const mod = await loadGeneratedModule<{ createRouter: (s: unknown) => express.Router }>({
    'router.ts': generateExpressRouter(spec, opts).content,
    'schemas.ts': schemasTs,
  })
  const app = express()
  app.use(mod.createRouter(service))
  return async (path, method = 'GET') => {
    const server = app.listen(0)
    await new Promise<void>((r) => server.once('listening', () => r()))
    try {
      const { port } = server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method })
      const text = await res.text()
      return { status: res.status, body: text === '' ? undefined : JSON.parse(text) }
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  }
}

describe.each([
  ['Hono', honoCaller],
  ['Express', expressCaller],
] as const)('%s: emit_response_validation', (_, makeCaller) => {
  it('valid named-schema result is sent, with undeclared keys stripped', async () => {
    const call = await makeCaller(rvOpts)
    results['getPet'] = { id: 'p1', name: 'Rex', internalNote: 'do not leak' }
    expect(await call('/pets/p1')).toEqual({ status: 200, body: { id: 'p1', name: 'Rex' } })
  })

  it('invalid named-schema result -> 500 without leaking the result', async () => {
    const call = await makeCaller(rvOpts)
    results['getPet'] = { id: 42, secret: 'hunter2' }
    const res = await call('/pets/p1')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Response validation failed' })
    expect(JSON.stringify(res.body)).not.toContain('hunter2')
  })

  it('keeps the declared success status (201) on a valid result', async () => {
    const call = await makeCaller(rvOpts)
    results['createPet'] = { id: 'p2', name: 'Ada' }
    expect(await call('/pets', 'POST')).toEqual({ status: 201, body: { id: 'p2', name: 'Ada' } })
  })

  it('array-of-$ref responses are validated as z.array(Schema)', async () => {
    const call = await makeCaller(rvOpts)
    results['listPets'] = [{ id: 'p1', name: 'Rex' }]
    expect((await call('/pets')).status).toBe(200)
    results['listPets'] = [{ id: 'p1' }]
    expect((await call('/pets')).status).toBe(500)
  })

  it('inline response schemas are synthesized and validated', async () => {
    const call = await makeCaller(rvOpts)
    results['getStats'] = { count: 3 }
    expect(await call('/stats')).toEqual({ status: 200, body: { count: 3 } })
    results['getStats'] = { count: 'many' }
    expect((await call('/stats')).status).toBe(500)
  })

  it('a $ref without a named schema is not checked (z.unknown() semantics)', async () => {
    const call = await makeCaller(rvOpts)
    results['getBlob'] = 'anything at all'
    expect(await call('/blob')).toEqual({ status: 200, body: 'anything at all' })
  })

  it('void responses are unaffected', async () => {
    const call = await makeCaller(rvOpts)
    expect((await call('/ping')).status).toBe(204)
  })

  it('combined with error_format problem+json the 500 is a problem body', async () => {
    const call = await makeCaller({ ...rvOpts, errorFormat: 'problem+json' })
    results['getPet'] = { id: 42 }
    const res = await call('/pets/p1')
    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'Response validation failed',
    })
  })

  it('without the flag an invalid result is sent unchanged (default behaviour)', async () => {
    const call = await makeCaller(schemaOpts)
    results['getPet'] = { id: 42 }
    expect(await call('/pets/p1')).toEqual({ status: 200, body: { id: 42 } })
  })
})

describe('emit_response_validation emission', () => {
  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s: default output unchanged; flag imports response schemas', (_, gen) => {
    const base = gen(spec, schemaOpts).content
    expect(gen(spec, { ...schemaOpts, emitResponseValidation: false }).content).toBe(base)
    expect(base).not.toContain('_rv')
    expect(base).not.toContain('PetSchema')
    const withRv = gen(spec, rvOpts).content
    expect(withRv).toContain("import { PetSchema } from './schemas.js'")
    expect(withRv).toContain('z.array(PetSchema).safeParse(')
    expect(withRv).toContain('z.object({ count: z.number() }).safeParse(')
  })

  it('a bare named schema does not pull in the z import on its own', () => {
    const single: OpenAPIV3_1.Document = {
      ...spec,
      paths: { '/pets/{id}': spec.paths!['/pets/{id}']! },
    }
    const content = generateRouter(single, rvOpts).content
    expect(content).toContain('PetSchema.safeParse(')
    expect(content).not.toContain("import { z } from 'zod'")
  })

  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s: generated output typechecks', (label, gen) => {
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateService(spec).content,
      'router.ts': gen(spec, { ...rvOpts, errorFormat: 'problem+json' }).content,
      'schemas.ts': schemasTs,
      'models.ts':
        'export interface Pet { id: string; name: string }\nexport type Blob = Record<string, unknown>\n',
      '_shared/errors.ts': emitSharedErrorsFile().content,
    })
    assertNoTsDiagnostics(diagnostics, `${label} emit_response_validation`)
  })
})
