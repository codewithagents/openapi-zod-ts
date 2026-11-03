/**
 * Runtime regression tests: hyphenated query param names (`is-active`, `page-size`, `sort-by`)
 * must be read from the raw URL key and exposed to the service under the normalized
 * identifier (`isActive`, `pageSize`, `sortBy`). Before the fix the Express and Hono scalar
 * branches looked up the normalized identifier (always undefined), so a required param was
 * rejected with 422 and an optional one was silently dropped; Fastify validated a schema keyed
 * by the identifier against req.query keyed by the raw name.
 */
import { afterAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Hono } from 'hono'
import express from 'express'
import Fastify from 'fastify'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from '../plugins/router.js'
import { generateService } from '../plugins/service.js'
import { generateFastifyTypedService } from '../plugins/fastify-service.js'
import { emitSharedErrorsFile } from '../plugins/errors-emitter.js'
import { cleanupRuntimeScratch, loadGeneratedModule } from './runtime-helpers.js'
import { assertNoTsDiagnostics, compileGeneratedFiles } from './ts-compile-helpers.js'

afterAll(() => cleanupRuntimeScratch())

const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Roster API', version: '1.0.0' },
  paths: {
    '/members': {
      get: {
        operationId: 'listMembers',
        parameters: [
          { name: 'is-active', in: 'query', required: true, schema: { type: 'boolean' } },
          { name: 'page-size', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'sort-by', in: 'query', required: false, schema: { type: 'string' } },
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

type Result = { status: number; body: unknown }
const URL_OK = '/members?is-active=true&page-size=5&sort-by=name'
const EXPECTED = { query: { isActive: true, pageSize: 5, sortBy: 'name' } }

async function honoGet(path: string): Promise<Result> {
  const mod = await loadGeneratedModule<{ createRouter: (s: unknown) => Hono }>({
    'router.ts': generateRouter(spec).content,
  })
  const app = mod.createRouter({ listMembers: async (query: unknown) => ({ query }) })
  const res = await app.request(path)
  return { status: res.status, body: await res.json() }
}

async function expressGet(path: string): Promise<Result> {
  const mod = await loadGeneratedModule<{ createRouter: (s: unknown) => express.Router }>({
    'router.ts': generateExpressRouter(spec).content,
  })
  const app = express()
  app.use(mod.createRouter({ listMembers: async (query: unknown) => ({ query }) }))
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

async function fastifyGet(path: string): Promise<Result> {
  const mod = await loadGeneratedModule<{
    createRouter: (s: unknown) => Parameters<ReturnType<typeof Fastify>['register']>[0]
  }>({ 'router.ts': generateFastifyRouter(spec).content })
  const app = Fastify()
  await app.register(
    mod.createRouter({ listMembers: async (input: { query: unknown }) => ({ query: input.query }) })
  )
  const res = await app.inject({ method: 'GET', url: path })
  await app.close()
  return { status: res.statusCode, body: res.json() }
}

describe.each([
  ['Hono', honoGet, 422],
  ['Express', expressGet, 422],
  ['Fastify', fastifyGet, 400],
] as const)('%s: hyphenated query param names', (_, get, invalidStatus) => {
  it('reads number, boolean and string params from their raw URL keys', async () => {
    expect(await get(URL_OK)).toEqual({ status: 200, body: EXPECTED })
  })

  it('?is-active=false reaches the service as false; absent optional params stay undefined', async () => {
    expect(await get('/members?is-active=false')).toEqual({
      status: 200,
      body: { query: { isActive: false } },
    })
  })

  it('a missing required hyphenated param is still rejected', async () => {
    expect((await get('/members?page-size=5')).status).toBe(invalidStatus)
  })

  it('invalid hyphenated number / boolean values are rejected', async () => {
    expect((await get('/members?is-active=yes')).status).toBe(invalidStatus)
    expect((await get('/members?is-active=true&page-size=abc')).status).toBe(invalidStatus)
  })
})

describe('hyphenated query params: generated output typechecks', () => {
  const errors = emitSharedErrorsFile().content
  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s', (label, gen) => {
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateService(spec).content,
      'router.ts': gen(spec).content,
      '_shared/errors.ts': errors,
    })
    assertNoTsDiagnostics(diagnostics, `${label} hyphenated query params`)
  })

  it('Fastify', () => {
    const opts = { schemaNames: new Set<string>(), schemaImportPath: './schemas.js' }
    const diagnostics = compileGeneratedFiles({
      'service.ts': generateFastifyTypedService(spec, opts).content,
      'router.ts': generateFastifyRouter(spec, opts).content,
      '_shared/errors.ts': errors,
    })
    assertNoTsDiagnostics(diagnostics, 'Fastify hyphenated query params')
  })
})
