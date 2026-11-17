/**
 * Parameter schema constraints in the generated routers.
 *
 * A parameter's `schema` may be a `$ref` to `#/components/schemas/...`, and the constraints a
 * parameter carries (format, enum, default) used to be read from an inline schema only. Most
 * tests drive the generated router through a real request (Fastify `inject()`, Hono
 * `request()`, Express over HTTP). Three kinds assert on the generated source or typecheck it
 * instead, because a request cannot tell the outputs apart: a default the emitted schema cannot
 * carry still answers at runtime but does not compile, and the service interface is a type.
 *
 * Every guard in resolveParam, resolveSchemaRef, the readers that apply a $ref'd schema to a query
 * param (applyResolvedConstraints and what it calls), queryParamItemExpr, queryParamZodExpr,
 * pathParamSchemaExpr and buildParamsSchemaExpr was deleted in turn, and every deletion turns a
 * test here red except four equivalent mutants: the early return for an inline schema in
 * resolveSchemaRef (the loop then returns the schema anyway), the `isArray` check in
 * applyEnumConstraint (only a plain array param reads `itemsEnum`), the length check in
 * queryParamItemExpr (`itemsEnum` is never an empty list) and the numeric branch of
 * pathParamSchemaExpr (a non-string type returns z.string() anyway).
 *
 * Cycle tests run against a lookup budget, so a resolver without a visited set fails at once
 * instead of looping.
 */
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { parseSpec } from 'openapi-zod-ts'
import express from 'express'
import Fastify, { type FastifyPluginAsync } from 'fastify'
import { generateFastifyRouter, generateRouter, generateExpressRouter } from '../plugins/router.js'
import { generateFastifyTypedService } from '../plugins/fastify-service.js'
import { generateService } from '../plugins/service.js'
import { emitSharedErrorsFile } from '../plugins/errors-emitter.js'
import { resolveParam, resolveSchemaRef } from '../plugins/shared.js'
import { cleanupRuntimeScratch, loadGeneratedModule } from './runtime-helpers.js'
import { assertNoTsDiagnostics, compileGeneratedFiles } from './ts-compile-helpers.js'

afterAll(() => cleanupRuntimeScratch())

type ParameterObject = OpenAPIV3_1.ParameterObject

const PET_ID = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b'

const ref = (name: string): OpenAPIV3_1.ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
})

const SCHEMAS: Record<string, OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject> = {
  PetStatus: { type: 'string', enum: ['available', 'pending', 'sold'] },
  PetId: { type: 'string', format: 'uuid' },
  PetName: { type: 'string' },
  Rank: { type: 'integer', enum: [1, 2, 3] },
  PageSize: { type: 'integer', default: 10 },
  NoMembers: { type: 'string', enum: [] },
  StatusAlias: ref('PetStatus'),
  StatusAliasOfAlias: ref('StatusAlias'),
  LabelledAlias: { ...ref('PetId'), description: 'a pet id', format: 'email' },
  CycleA: ref('CycleB'),
  CycleB: ref('CycleA'),
  Loop: ref('Loop'),
}

const JSON_OK = {
  '200': {
    description: 'ok',
    content: { 'application/json': { schema: { type: 'object' as const } } },
  },
}

function makeSpec(paths: OpenAPIV3_1.PathsObject): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title: 'Pet Registry', version: '1.0.0' },
    paths,
    components: { schemas: SCHEMAS },
  }
}

function listPetsSpec(parameters: ParameterObject[]): OpenAPIV3_1.Document {
  return makeSpec({
    '/pets': { get: { operationId: 'listPets', parameters, responses: JSON_OK } },
  })
}

/** The spec with extra component schemas next to the shared ones. */
function withSchemas(
  spec: OpenAPIV3_1.Document,
  extra: Record<string, OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject>
): OpenAPIV3_1.Document {
  return { ...spec, components: { ...spec.components, schemas: { ...SCHEMAS, ...extra } } }
}

const LOOKUP_BUDGET = 1000

/**
 * The spec with its component schemas behind a lookup budget. A resolver without a visited set
 * follows a $ref cycle forever in a synchronous loop that no test timeout can interrupt: the
 * budget turns that into a failure at once.
 */
function withLookupBudget(spec: OpenAPIV3_1.Document): OpenAPIV3_1.Document {
  let lookups = 0
  const schemas = new Proxy(spec.components?.schemas ?? {}, {
    get(target, key, receiver) {
      if (typeof key === 'string' && ++lookups > LOOKUP_BUDGET) {
        throw new Error(`more than ${LOOKUP_BUDGET} component schema lookups: a $ref cycle goes on`)
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { ...spec, components: { ...spec.components, schemas } }
}

function query(
  name: string,
  schema: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject
): ParameterObject {
  return { name, in: 'query', required: false, schema: schema as ParameterObject['schema'] }
}

type RouterModule = {
  createRouter: (service: unknown) => FastifyPluginAsync
}

/** Echo service: every operation returns the `input` object the router built for it. */
const echoService = new Proxy({}, { get: () => async (input: unknown) => input })

async function call(
  spec: OpenAPIV3_1.Document,
  method: 'GET' | 'PUT',
  url: string
): Promise<{ status: number; body: unknown }> {
  const mod = await loadGeneratedModule<RouterModule>({
    'router.ts': generateFastifyRouter(spec).content,
  })
  const app = Fastify()
  await app.register(mod.createRouter(echoService))
  const res = await app.inject({ method, url })
  await app.close()
  return { status: res.statusCode, body: res.json() }
}

const SERVICE_OPTIONS = { schemaNames: new Set<string>(), schemaImportPath: './schemas.js' }

/** Compile the generated Fastify service and router for `spec`, plus any extra files. */
function compileFastify(spec: OpenAPIV3_1.Document, extra: Record<string, string> = {}) {
  return compileGeneratedFiles({
    'service.ts': generateFastifyTypedService(spec, SERVICE_OPTIONS).content,
    'router.ts': generateFastifyRouter(spec, SERVICE_OPTIONS).content,
    '_shared/errors.ts': emitSharedErrorsFile().content,
    ...extra,
  })
}

describe('resolveSchemaRef', () => {
  const spec = makeSpec({})

  it('returns the component schema a #/components/schemas $ref points to', () => {
    expect(resolveSchemaRef(ref('PetStatus'), spec)).toBe(SCHEMAS.PetStatus)
  })

  it('returns an inline schema unchanged', () => {
    const inline: OpenAPIV3_1.SchemaObject = { type: 'string' }
    expect(resolveSchemaRef(inline, spec)).toBe(inline)
    expect(resolveSchemaRef(undefined, spec)).toBeUndefined()
  })

  it('returns the $ref unchanged when it does not point into components/schemas', () => {
    // components/headers/ is as long as components/schemas/, so only the prefix check keeps this
    // ref from resolving to the PetStatus schema.
    const headers = { $ref: '#/components/headers/PetStatus' }
    const parameters = { $ref: '#/components/parameters/PetStatus' }
    const external = { $ref: 'other.yaml#/components/schemas/PetStatus' }
    expect(resolveSchemaRef(headers, spec)).toBe(headers)
    expect(resolveSchemaRef(parameters, spec)).toBe(parameters)
    expect(resolveSchemaRef(external, spec)).toBe(external)
  })

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'returns the $ref unchanged when the name (%s) is a member of Object.prototype',
    (name) => {
      const start = ref(name)
      expect(resolveSchemaRef(start, spec)).toBe(start)
      const withSibling = { ...start, default: 'x' }
      expect(resolveSchemaRef(withSibling, spec)).toBe(withSibling)
    }
  )

  it('returns the $ref unchanged when the component is not an object (an empty YAML entry)', () => {
    const withEmptyEntry: OpenAPIV3_1.Document = {
      ...spec,
      components: { schemas: { Empty: null as unknown as OpenAPIV3_1.SchemaObject } },
    }
    const start = ref('Empty')
    expect(resolveSchemaRef(start, withEmptyEntry)).toBe(start)
  })

  it('returns the $ref unchanged when the component is missing', () => {
    const missing = ref('Missing')
    expect(resolveSchemaRef(missing, spec)).toBe(missing)
    const noComponents = ref('PetStatus')
    const emptySpec: OpenAPIV3_1.Document = { openapi: '3.1.0', info: spec.info, paths: {} }
    expect(resolveSchemaRef(noComponents, emptySpec)).toBe(noComponents)
  })

  it('follows a chain of $refs to the final schema', () => {
    expect(resolveSchemaRef(ref('StatusAlias'), spec)).toBe(SCHEMAS.PetStatus)
    expect(resolveSchemaRef(ref('StatusAliasOfAlias'), spec)).toBe(SCHEMAS.PetStatus)
  })

  it('returns the original $ref when a chain ends in a missing component or another section', () => {
    const dangling = ref('Dangling')
    const toHeader = ref('ToHeader')
    const headerRef: OpenAPIV3_1.ReferenceObject = { $ref: '#/components/headers/PetStatus' }
    const withBrokenChains: OpenAPIV3_1.Document = {
      ...spec,
      components: {
        schemas: {
          ...SCHEMAS,
          Dangling: ref('Missing'),
          ToHeader: headerRef,
        },
      },
    }
    expect(resolveSchemaRef(dangling, withBrokenChains)).toBe(dangling)
    expect(resolveSchemaRef(toHeader, withBrokenChains)).toBe(toHeader)
  })

  it.each(['CycleA', 'CycleB', 'Loop'])(
    'stops at a $ref cycle (%s) and returns the original $ref',
    (name) => {
      const start = ref(name)
      expect(resolveSchemaRef(start, withLookupBudget(spec))).toBe(start)
    }
  )

  it('lets keywords next to a $ref override the target, without touching the component', () => {
    const withDefault = { ...ref('PetStatus'), default: 'sold' }
    expect(resolveSchemaRef(withDefault, spec)).toEqual({
      type: 'string',
      enum: ['available', 'pending', 'sold'],
      default: 'sold',
    })
    expect(SCHEMAS.PetStatus).not.toHaveProperty('default')
  })

  describe('keywords next to a $ref, by OpenAPI version', () => {
    const withDefault = { ...ref('PetStatus'), default: 'sold' }

    it.each(['3.1.0', '3.1.1', '3.2.0', '4.0.0', '10.0.0'])('are taken in %s', (openapi) => {
      expect(resolveSchemaRef(withDefault, { ...spec, openapi })).toEqual({
        type: 'string',
        enum: ['available', 'pending', 'sold'],
        default: 'sold',
      })
    })

    it.each(['3.0.0', '3.0.3'])('are ignored in %s: the target comes back as it is', (openapi) => {
      expect(resolveSchemaRef(withDefault, { ...spec, openapi })).toBe(SCHEMAS.PetStatus)
    })

    it.each(['unknown', 'v3.1.0', ''])(
      'are ignored when the document has no version number (%j)',
      (openapi) => {
        expect(resolveSchemaRef(withDefault, { ...spec, openapi })).toBe(SCHEMAS.PetStatus)
      }
    )

    it('are ignored on every ref of a chain in 3.0, not only the outermost', () => {
      const labelled = { ...ref('LabelledAlias'), format: 'uri' }
      expect(resolveSchemaRef(labelled, { ...spec, openapi: '3.0.3' })).toBe(SCHEMAS.PetId)
    })
  })

  it('lets the outermost $ref win over the refs further down a chain', () => {
    // LabelledAlias sets format email, PetId (its target) sets format uuid.
    const outer = { ...ref('LabelledAlias'), format: 'uri' }
    expect(resolveSchemaRef(outer, spec)).toEqual({
      type: 'string',
      format: 'uri',
      description: 'a pet id',
    })
    expect(resolveSchemaRef(ref('LabelledAlias'), spec)).toEqual({
      type: 'string',
      format: 'email',
      description: 'a pet id',
    })
  })
})

describe('resolveParam', () => {
  const petIdParam: ParameterObject = {
    name: 'petId',
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }
  const spec: OpenAPIV3_1.Document = {
    ...makeSpec({}),
    components: {
      schemas: SCHEMAS,
      parameters: {
        PetIdParam: petIdParam,
        PetIdAlias: { $ref: '#/components/parameters/PetIdParam' },
      },
    },
  }
  const resolve = (entry: unknown, from = spec) => resolveParam(entry as ParameterObject, from)

  it('returns an inline parameter as it is', () => {
    expect(resolve(petIdParam)).toBe(petIdParam)
  })

  it.each([
    ['null (an empty YAML entry)', null],
    ['a string', 'petId'],
    ['a number', 5],
    ['an array', [petIdParam]],
  ])('returns undefined for an entry that is %s', (_label, entry) => {
    expect(resolve(entry)).toBeUndefined()
  })

  it('resolves a $ref to a component parameter', () => {
    expect(resolve({ $ref: '#/components/parameters/PetIdParam' })).toBe(petIdParam)
  })

  it('returns undefined for a $ref the document cannot answer', () => {
    const missing = { $ref: '#/components/parameters/Missing' }
    expect(resolve(missing)).toBeUndefined()
    expect(resolve({ $ref: '#/components/parameters/PetIdAlias' })).toBeUndefined()
    expect(resolve(missing, makeSpec({}))).toBeUndefined()
    const noComponents: OpenAPIV3_1.Document = { openapi: '3.1.0', info: spec.info, paths: {} }
    expect(resolve(missing, noComponents)).toBeUndefined()
  })
})

describe('Fastify router: path param schemas', () => {
  const petId = (schema: ParameterObject['schema']): ParameterObject => ({
    name: 'petId',
    in: 'path',
    required: true,
    schema,
  })

  it('validates a path param whose schema is a $ref to a uuid component', async () => {
    const spec = makeSpec({
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          parameters: [petId(ref('PetId'))],
          responses: JSON_OK,
        },
      },
    })
    expect(generateFastifyRouter(spec).content).toContain('petId: z.uuid()')
    expect((await call(spec, 'GET', '/pets/not-a-uuid')).status).toBe(400)
    expect(await call(spec, 'GET', `/pets/${PET_ID}`)).toEqual({
      status: 200,
      body: { params: { petId: PET_ID } },
    })
  })

  const sharedSpec = makeSpec({
    '/pets/{petId}': {
      parameters: [petId({ type: 'string', format: 'uuid' })],
      get: { operationId: 'getPet', responses: JSON_OK },
      put: { operationId: 'replacePet', responses: JSON_OK },
    },
  })

  it('applies path-item-level path params to every operation on the path', async () => {
    expect((await call(sharedSpec, 'GET', '/pets/not-a-uuid')).status).toBe(400)
    expect((await call(sharedSpec, 'PUT', '/pets/not-a-uuid')).status).toBe(400)
    expect((await call(sharedSpec, 'PUT', `/pets/${PET_ID}`)).status).toBe(200)
  })

  it('lets an operation-level path param override the path-item-level one', async () => {
    const spec = makeSpec({
      '/pets/{petId}': {
        parameters: [petId({ type: 'string', format: 'uuid' })],
        get: { operationId: 'getPet', responses: JSON_OK },
        put: {
          operationId: 'replacePet',
          parameters: [petId({ type: 'string' })],
          responses: JSON_OK,
        },
      },
    })
    expect((await call(spec, 'GET', '/pets/rex')).status).toBe(400)
    expect((await call(spec, 'PUT', '/pets/rex')).status).toBe(200)
  })

  it('ignores path-item parameters that are not a list and reads the operation-level ones', async () => {
    const spec = makeSpec({
      '/pets/{petId}': {
        parameters: { name: 'petId' } as unknown as ParameterObject[],
        get: { operationId: 'getPet', parameters: [petId(ref('PetId'))], responses: JSON_OK },
      },
    })
    expect((await call(spec, 'GET', '/pets/not-a-uuid')).status).toBe(400)
    expect((await call(spec, 'GET', `/pets/${PET_ID}`)).status).toBe(200)
  })

  it('is not overridden by a query param of the same name', async () => {
    const spec = makeSpec({
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          parameters: [
            petId({ type: 'string' }),
            query('petId', { type: 'string', format: 'uuid' }),
          ],
          responses: JSON_OK,
        },
      },
    })
    expect((await call(spec, 'GET', '/pets/rex')).status).toBe(200)
  })

  it('treats a path param that declares no schema, or no declaration at all, as a plain string', async () => {
    const noSchema = makeSpec({
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'petId', in: 'path', required: true }],
          responses: JSON_OK,
        },
      },
    })
    const undeclared = makeSpec({
      '/pets/{petId}': { get: { operationId: 'getPet', responses: JSON_OK } },
    })
    for (const spec of [noSchema, undeclared]) {
      expect(generateFastifyRouter(spec).content).toContain('petId: z.string()')
      expect(await call(spec, 'GET', '/pets/rex')).toEqual({
        status: 200,
        body: { params: { petId: 'rex' } },
      })
    }
  })

  describe('a $ref to a component', () => {
    const getPetSpec = (schema: ParameterObject['schema'], extra = {}) =>
      withSchemas(
        makeSpec({
          '/pets/{petId}': {
            get: { operationId: 'getPet', parameters: [petId(schema)], responses: JSON_OK },
          },
        }),
        extra
      )

    const formats = [
      { format: 'uuid', valid: PET_ID, invalid: 'not-a-uuid' },
      { format: 'email', valid: 'rex@example.com', invalid: 'rex' },
      { format: 'uri', valid: 'https://example.com/rex', invalid: 'rex' },
      { format: 'url', valid: 'https://example.com/rex', invalid: 'rex' },
      { format: 'date-time', valid: '2026-01-02T03:04:05Z', invalid: 'yesterday' },
    ]

    it.each(formats)(
      'carries format $format of a string schema',
      async ({ format, valid, invalid }) => {
        const spec = getPetSpec(ref('Tagged'), { Tagged: { type: 'string', format } })
        expect((await call(spec, 'GET', `/pets/${encodeURIComponent(invalid)}`)).status).toBe(400)
        expect(await call(spec, 'GET', `/pets/${encodeURIComponent(valid)}`)).toEqual({
          status: 200,
          body: { params: { petId: valid } },
        })
      }
    )

    it.each([
      { label: 'an integer', schema: { type: 'integer', format: 'uuid' } },
      { label: 'no type', schema: { format: 'uuid' } },
    ] as Array<{ label: string; schema: OpenAPIV3_1.SchemaObject }>)(
      'does not carry a format of a schema that is $label, not a string',
      async ({ schema }) => {
        const spec = getPetSpec(ref('Untyped'), { Untyped: schema })
        expect((await call(spec, 'GET', '/pets/rex')).status).toBe(200)
      }
    )

    it('does not read a format written next to a $ref that does not resolve', async () => {
      const spec = getPetSpec({ ...ref('Missing'), type: 'string', format: 'uuid' })
      expect(generateFastifyRouter(spec).content).not.toContain('z.uuid()')
      expect((await call(spec, 'GET', '/pets/rex')).status).toBe(200)
    })
  })
})

describe('an empty entry in a parameters list', () => {
  const FIXTURE = join(import.meta.dirname, '../__fixtures__/empty-parameter-entry.yaml')

  async function loadFixture(): Promise<OpenAPIV3_1.Document> {
    return parseSpec(FIXTURE)
  }

  /** The fixture with the empty entry moved from the path item to the operation. */
  async function loadFixtureWithEmptyEntryOnOperation(): Promise<OpenAPIV3_1.Document> {
    const spec = await loadFixture()
    const pathItem = spec.paths?.['/pets/{petId}']
    const [empty, petId] = pathItem?.parameters ?? []
    if (pathItem?.get === undefined) throw new Error('fixture has no GET operation')
    pathItem.get.parameters = [empty, ...(pathItem.get.parameters ?? [])] as ParameterObject[]
    pathItem.parameters = [petId] as ParameterObject[]
    return spec
  }

  const generators: Array<[string, (spec: OpenAPIV3_1.Document) => { content: string }]> = [
    ['service', generateService],
    ['Hono router', generateRouter],
    ['Express router', generateExpressRouter],
    ['Fastify router', generateFastifyRouter],
    ['Fastify service', (spec) => generateFastifyTypedService(spec, SERVICE_OPTIONS)],
  ]

  it('parses from YAML to null', async () => {
    expect((await loadFixture()).paths?.['/pets/{petId}']?.parameters?.[0]).toBeNull()
  })

  it.each(generators)('%s generation skips it on the path item', async (_label, generate) => {
    expect(generate(await loadFixture()).content).toContain('getPet')
  })

  it.each(generators)('%s generation skips it on the operation', async (_label, generate) => {
    expect(generate(await loadFixtureWithEmptyEntryOnOperation()).content).toContain('getPet')
  })

  it('leaves the path param and the query param next to it validated on Fastify', async () => {
    const spec = await loadFixture()
    expect(generateFastifyRouter(spec).content).toContain('petId: z.uuid()')
    expect((await call(spec, 'GET', '/pets/not-a-uuid')).status).toBe(400)
    expect(await call(spec, 'GET', `/pets/${PET_ID}`)).toEqual({
      status: 200,
      body: { params: { petId: PET_ID }, query: { verbose: false } },
    })
  })

  it('typechecks the generated router against the generated service', async () => {
    assertNoTsDiagnostics(compileFastify(await loadFixture()), 'Fastify empty parameter entry')
  })
})

describe('Fastify router: query param constraints', () => {
  it('validates a query param declared with format uuid', async () => {
    const spec = listPetsSpec([query('ownerId', { type: 'string', format: 'uuid' })])
    expect((await call(spec, 'GET', '/pets?ownerId=nobody')).status).toBe(400)
    expect(await call(spec, 'GET', `/pets?ownerId=${PET_ID}`)).toEqual({
      status: 200,
      body: { query: { ownerId: PET_ID } },
    })
  })

  const uuidFormatCases: Array<{
    label: string
    schema: OpenAPIV3_1.SchemaObject
    status: number
  }> = [
    { label: 'type string', schema: { type: 'string', format: 'uuid' }, status: 400 },
    {
      label: 'the nullable form type [string, null]',
      schema: { type: ['string', 'null'], format: 'uuid' },
      status: 400,
    },
    {
      label: 'a type that also allows integers',
      schema: { type: ['string', 'integer'], format: 'uuid' },
      status: 200,
    },
    { label: 'no type', schema: { format: 'uuid' }, status: 200 },
    {
      label: 'a type that only allows null',
      schema: { type: ['null'], format: 'uuid' },
      status: 200,
    },
  ]

  it.each(uuidFormatCases)(
    'format uuid with $label: a value that is no uuid gets $status',
    async ({ schema, status }) => {
      // A query param carries its format for type string and for the nullable form
      // [string, null], and for nothing else. A path param carries it for type string only: its
      // value is a URL segment, never null, so the nullable form stays a plain z.string() there.
      const spec = listPetsSpec([query('ownerId', schema)])
      expect((await call(spec, 'GET', '/pets?ownerId=nobody')).status).toBe(status)
      expect((await call(spec, 'GET', `/pets?ownerId=${PET_ID}`)).status).toBe(200)
    }
  )

  it('validates a query param whose schema is a $ref to a uuid component', async () => {
    const spec = listPetsSpec([query('breederId', ref('PetId'))])
    expect((await call(spec, 'GET', '/pets?breederId=nobody')).status).toBe(400)
    expect((await call(spec, 'GET', `/pets?breederId=${PET_ID}`)).status).toBe(200)
  })

  it('validates a query param whose schema is a $ref to an enum component', async () => {
    const spec = listPetsSpec([query('status', ref('PetStatus'))])
    expect((await call(spec, 'GET', '/pets?status=adopted')).status).toBe(400)
    expect(await call(spec, 'GET', '/pets?status=sold')).toEqual({
      status: 200,
      body: { query: { status: 'sold' } },
    })
  })

  it('validates a query param whose $ref goes through another $ref', async () => {
    const spec = listPetsSpec([query('status', ref('StatusAliasOfAlias'))])
    expect((await call(spec, 'GET', '/pets?status=adopted')).status).toBe(400)
    expect((await call(spec, 'GET', '/pets?status=sold')).status).toBe(200)
  })

  it('treats a $ref cycle as a plain string param', async () => {
    const spec = withLookupBudget(
      listPetsSpec([query('a', ref('CycleA')), query('b', ref('Loop'))])
    )
    expect(await call(spec, 'GET', '/pets?a=x&b=y')).toEqual({
      status: 200,
      body: { query: { a: 'x', b: 'y' } },
    })
  })

  it('does not read a $ref to another section of components as a schema', async () => {
    // components/headers/PetStatus is as long as components/schemas/PetStatus.
    const spec = listPetsSpec([query('status', { $ref: '#/components/headers/PetStatus' })])
    expect(generateFastifyRouter(spec).content).not.toContain('z.enum')
    expect((await call(spec, 'GET', '/pets?status=adopted')).status).toBe(200)
  })

  it('treats a query param that declares no schema as a plain string', async () => {
    const spec = listPetsSpec([{ name: 'q', in: 'query' }])
    expect(await call(spec, 'GET', '/pets?q=x')).toEqual({
      status: 200,
      body: { query: { q: 'x' } },
    })
  })

  it('reads an array query param that declares no items as an array of strings', async () => {
    const spec = listPetsSpec([query('tags', { type: 'array' } as OpenAPIV3_1.ArraySchemaObject)])
    expect(await call(spec, 'GET', '/pets?tags=a&tags=b')).toEqual({
      status: 200,
      body: { query: { tags: ['a', 'b'] } },
    })
  })

  it('does not read an enum written next to an array item $ref that does not resolve', async () => {
    const spec = withLookupBudget(
      listPetsSpec([
        query('kinds', { type: 'array', items: { ...ref('CycleA'), enum: ['x', 'y'] } }),
      ])
    )
    expect(generateFastifyRouter(spec).content).not.toContain('z.enum')
    expect((await call(spec, 'GET', '/pets?kinds=anything&kinds=else')).status).toBe(200)
  })

  describe('keywords next to a $ref', () => {
    it.each([
      { openapi: '3.0.3', body: { query: {} }, optional: 'status?: string' },
      { openapi: '3.1.0', body: { query: { status: 'sold' } }, optional: 'status: string' },
    ])(
      'a sibling default is carried only from OpenAPI 3.1: $openapi',
      async ({ openapi, body, optional }) => {
        const spec = {
          ...listPetsSpec([query('status', { ...ref('PetStatus'), default: 'sold' })]),
          openapi,
        }
        expect(await call(spec, 'GET', '/pets')).toEqual({ status: 200, body })
        expect(generateFastifyTypedService(spec, SERVICE_OPTIONS).content).toContain(optional)
        expect((await call(spec, 'GET', '/pets?status=adopted')).status).toBe(400)
      }
    )

    const unresolved: Array<[string, OpenAPIV3_1.ReferenceObject & Record<string, unknown>]> = [
      ['a $ref cycle', { ...ref('CycleA'), enum: ['x', 'y'], default: 'x' }],
      ['a component that does not exist', { ...ref('Missing'), default: 'x' }],
      [
        'another section of components',
        { $ref: '#/components/headers/PetStatus', enum: ['p', 'q'], default: 'p' },
      ],
      ['a name from Object.prototype', { ...ref('toString'), default: 'x' }],
    ]

    it.each(unresolved)('are not taken when the $ref is %s', async (_label, schema) => {
      const spec = withLookupBudget(listPetsSpec([query('s', schema)]))
      const { content } = generateFastifyRouter(spec)
      expect(content).not.toContain('.default(')
      expect(content).not.toContain('z.enum')
      expect(generateFastifyTypedService(spec, SERVICE_OPTIONS).content).toContain('s?: string')
      expect(await call(spec, 'GET', '/pets')).toEqual({ status: 200, body: { query: {} } })
      expect((await call(spec, 'GET', '/pets?s=anything')).status).toBe(200)
    })

    it('takes a sibling default', async () => {
      const spec = listPetsSpec([query('status', { ...ref('PetStatus'), default: 'sold' })])
      expect(await call(spec, 'GET', '/pets')).toEqual({
        status: 200,
        body: { query: { status: 'sold' } },
      })
      expect((await call(spec, 'GET', '/pets?status=adopted')).status).toBe(400)
    })

    it('takes a sibling enum over the target enum', async () => {
      const spec = listPetsSpec([
        query('status', { ...ref('PetStatus'), enum: ['available', 'sold'] }),
      ])
      expect((await call(spec, 'GET', '/pets?status=pending')).status).toBe(400)
      expect((await call(spec, 'GET', '/pets?status=sold')).status).toBe(200)
    })

    it('takes a sibling format over the target format', async () => {
      const added = listPetsSpec([query('petName', { ...ref('PetName'), format: 'uuid' })])
      expect((await call(added, 'GET', '/pets?petName=rex')).status).toBe(400)
      const replaced = listPetsSpec([query('petId', { ...ref('PetId'), format: 'email' })])
      expect(generateFastifyRouter(replaced).content).not.toContain('z.uuid()')
      expect((await call(replaced, 'GET', '/pets?petId=rex')).status).toBe(200)
    })
  })

  it('validates every item of an array query param whose items are an enum', async () => {
    const spec = listPetsSpec([query('statuses', { type: 'array', items: ref('PetStatus') })])
    expect(await call(spec, 'GET', '/pets?statuses=sold&statuses=pending')).toEqual({
      status: 200,
      body: { query: { statuses: ['sold', 'pending'] } },
    })
    expect((await call(spec, 'GET', '/pets?statuses=sold&statuses=adopted')).status).toBe(400)
  })

  it('accepts the strings true and false as boolean array items', async () => {
    const spec = listPetsSpec([query('flags', { type: 'array', items: { type: 'boolean' } })])
    expect(await call(spec, 'GET', '/pets?flags=true&flags=false')).toEqual({
      status: 200,
      body: { query: { flags: [true, false] } },
    })
    expect((await call(spec, 'GET', '/pets?flags=true&flags=maybe')).status).toBe(400)
  })

  describe('declared default', () => {
    const defaultParams = [
      query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
      query('sort', { type: 'string', enum: ['name', 'age'], default: 'name' }),
      query('offset', { type: 'integer', default: 0 }),
      query('archived', { type: 'boolean', default: false }),
      query('tags', { type: 'array', items: { type: 'string' }, default: ['dog'] }),
    ]
    const spec = listPetsSpec(defaultParams)

    it('reaches the handler when the param is omitted', async () => {
      expect(await call(spec, 'GET', '/pets')).toEqual({
        status: 200,
        body: { query: { limit: 20, sort: 'name', offset: 0, archived: false, tags: ['dog'] } },
      })
    })

    it('yields to a supplied value, which is still validated', async () => {
      const supplied = await call(
        spec,
        'GET',
        '/pets?limit=5&sort=age&archived=true&tags=cat&tags=bird'
      )
      expect(supplied.body).toEqual({
        query: { limit: 5, sort: 'age', offset: 0, archived: true, tags: ['cat', 'bird'] },
      })
      expect((await call(spec, 'GET', '/pets?limit=500')).status).toBe(400)
    })

    it('is not applied to a required param: a missing value is still a 400', async () => {
      const required = listPetsSpec([
        { ...query('limit', { type: 'integer', default: 20 }), required: true },
      ])
      expect((await call(required, 'GET', '/pets')).status).toBe(400)
      expect((await call(required, 'GET', '/pets?limit=5')).body).toEqual({ query: { limit: 5 } })
    })

    it('is carried next to an empty enum, which constrains nothing', async () => {
      const emptyEnum = listPetsSpec([query('sort', { type: 'string', enum: [], default: 'name' })])
      expect(await call(emptyEnum, 'GET', '/pets')).toEqual({
        status: 200,
        body: { query: { sort: 'name' } },
      })
    })

    it('reaches the handler for a comma-delimited array param omitted from the query', async () => {
      const csvSpec = listPetsSpec([
        {
          ...query('ids', { type: 'array', items: { type: 'string' }, default: ['a', 'b'] }),
          style: 'form',
          explode: false,
        },
      ])
      expect((await call(csvSpec, 'GET', '/pets')).body).toEqual({ query: { ids: ['a', 'b'] } })
      expect((await call(csvSpec, 'GET', '/pets?ids=x,y')).body).toEqual({
        query: { ids: ['x', 'y'] },
      })
    })

    // A consumer of the generated service interface that reads every param as a plain value.
    const CONSUMER = `
      import type { PetRegistryService } from './service.js'
      type Query = Parameters<PetRegistryService['listPets']>[0]['query']
      export const read = (q: Query): [number, 'name' | 'age', number, boolean, string[]] => [
        q.limit, q.sort, q.offset, q.archived, q.tags,
      ]
    `

    it('makes the params non-optional in the service interface', () => {
      assertNoTsDiagnostics(
        compileGeneratedFiles({
          'service.ts': generateFastifyTypedService(spec, SERVICE_OPTIONS).content,
          'consumer.ts': CONSUMER,
        }),
        'Fastify service query defaults read as plain values'
      )
    })

    it('would flag an optional param: the same consumer fails against a spec without defaults', () => {
      const withoutDefaults = listPetsSpec(
        defaultParams.map((p) => ({ ...p, schema: { ...p.schema, default: undefined } }))
      )
      const diagnostics = compileGeneratedFiles({
        'service.ts': generateFastifyTypedService(withoutDefaults, SERVICE_OPTIONS).content,
        'consumer.ts': CONSUMER,
      })
      expect(diagnostics.map((d) => d.code)).toContain(2322)
    })

    it('typechecks the generated router against the generated service', () => {
      assertNoTsDiagnostics(compileFastify(spec), 'Fastify query defaults')
    })
  })
})

describe('Fastify router: constraints the emitted schema cannot carry are left out', () => {
  const spec = listPetsSpec([
    query('rank', ref('Rank')),
    query('pageSize', ref('PageSize')),
    query('ranks', { type: 'array', items: ref('Rank'), default: [1, 2] }),
    query('order', { type: 'string', enum: ['name', 'age'], default: 'weight' }),
    query('kinds', { type: 'array', items: ref('PetStatus'), default: ['adopted'] }),
    {
      ...query('sizes', { type: 'array', items: { type: 'integer' }, default: [10] }),
      style: 'form',
      explode: false,
    },
  ])

  it('does not copy an enum that is not made of strings', async () => {
    const { content } = generateFastifyRouter(spec)
    expect(content).not.toContain('z.enum([1')
    expect((await call(spec, 'GET', '/pets?rank=2')).status).toBe(200)
  })

  it('does not copy an enum with a member that is not a string, whatever the other members are', async () => {
    const mixed = withSchemas(listPetsSpec([query('mix', ref('Mixed'))]), {
      Mixed: { type: 'string', enum: ['a', 1] },
    })
    expect(generateFastifyRouter(mixed).content).not.toContain('z.enum')
    expect((await call(mixed, 'GET', '/pets?mix=anything')).status).toBe(200)
  })

  it('does not copy a list default that has a member that is not a string, on a delimited param', () => {
    const delimited = listPetsSpec([
      {
        ...query('ids', { type: 'array', items: { type: 'string' }, default: ['a', 1] }),
        style: 'form',
        explode: false,
      },
    ])
    expect(generateFastifyRouter(delimited).content).not.toContain('.default(')
    assertNoTsDiagnostics(compileFastify(delimited), 'Fastify delimited param with a mixed default')
  })

  it('does not copy a default the param schema cannot carry', () => {
    // pageSize is a $ref to an integer schema (emitted as a string), ranks is an array of
    // $ref'd integers (strings), sizes is delimited (always an array of strings), order and
    // kinds default to a value their own enum does not list.
    expect(generateFastifyRouter(spec).content).not.toContain('.default(')
  })

  it('typechecks the generated router against the generated service', () => {
    assertNoTsDiagnostics(
      compileFastify(spec),
      'Fastify $ref params with non-string enum and mismatched default'
    )
  })

  it('does not carry a default on a deepObject param, which always arrives as an object', async () => {
    // A string default on an object schema is malformed, but a z.object().default('none') does
    // not compile. The preValidation hook hands the schema an object (empty when no bracket key
    // is present), so a default could never apply anyway.
    const deep = listPetsSpec([
      {
        ...query('filter', {
          type: 'object',
          properties: { gte: { type: 'number' } },
          default: 'none',
        }),
        style: 'deepObject',
      },
    ])
    expect(generateFastifyRouter(deep).content).not.toContain('.default(')
    expect(await call(deep, 'GET', '/pets')).toEqual({
      status: 200,
      body: { query: { filter: {} } },
    })
    expect(await call(deep, 'GET', '/pets?filter[gte]=3')).toEqual({
      status: 200,
      body: { query: { filter: { gte: 3 } } },
    })
    assertNoTsDiagnostics(compileFastify(deep), 'Fastify deepObject param with a string default')
  })

  it('keeps a string default on a deepObject param that is emitted as a string', () => {
    // Only an inline object schema with properties becomes an object. A deepObject param whose
    // schema is a $ref, or has no properties, is a z.string() like any other param, and its
    // string default fits.
    const asString = listPetsSpec([
      {
        ...query('byRef', { ...ref('PetName'), default: 'none' } as OpenAPIV3_1.SchemaObject),
        style: 'deepObject',
      },
      { ...query('bare', { type: 'object', default: 'none' }), style: 'deepObject' },
    ])
    const { content } = generateFastifyRouter(asString)
    expect(content).toContain('byRef: z.string().default("none")')
    expect(content).toContain('bare: z.string().default("none")')
    assertNoTsDiagnostics(compileFastify(asString), 'Fastify deepObject params emitted as strings')
  })
})

describe('Fastify router: non-finite numeric defaults', () => {
  const FIXTURE = join(import.meta.dirname, '../__fixtures__/non-finite-default.yaml')

  async function loadFixture(): Promise<OpenAPIV3_1.Document> {
    return parseSpec(FIXTURE)
  }

  it('parses from YAML to the values JSON.stringify would write as null', async () => {
    const parameters = (await loadFixture()).paths?.['/pets']?.get?.parameters as ParameterObject[]
    expect(parameters.map((p) => (p.schema as OpenAPIV3_1.SchemaObject).default)).toEqual([
      Infinity,
      -Infinity,
      NaN,
      [1, Infinity],
      20,
    ])
  })

  it('leaves them out of the router and keeps the finite default', async () => {
    const spec = await loadFixture()
    const { content } = generateFastifyRouter(spec)
    expect(content).not.toContain('default(null)')
    expect(content).not.toContain('default([null')
    expect(content.match(/\.default\(/g)).toHaveLength(1)
    expect(content).toContain('limit: z.coerce.number().default(20)')
    expect(await call(spec, 'GET', '/pets')).toEqual({
      status: 200,
      body: { query: { limit: 20 } },
    })
  })

  it('typechecks the generated router against the generated service', async () => {
    assertNoTsDiagnostics(compileFastify(await loadFixture()), 'Fastify non-finite YAML defaults')
  })
})

describe('Hono and Express routers: enum reached through a $ref', () => {
  const spec = listPetsSpec([query('status', ref('PetStatus'))])

  it('Hono rejects a value outside the enum with 422', async () => {
    type HonoModule = {
      createRouter: (service: unknown) => { request: (url: string) => Promise<Response> }
    }
    const mod = await loadGeneratedModule<HonoModule>({ 'router.ts': generateRouter(spec).content })
    const app = mod.createRouter({ listPets: async (query: unknown) => ({ query }) })
    expect((await app.request('/pets?status=adopted')).status).toBe(422)
    expect((await app.request('/pets?status=sold')).status).toBe(200)
  })

  it('Express rejects a value outside the enum with 422', async () => {
    const mod = await loadGeneratedModule<{ createRouter: (service: unknown) => express.Router }>({
      'router.ts': generateExpressRouter(spec).content,
    })
    const app = express()
    app.use(mod.createRouter({ listPets: async (query: unknown) => ({ query }) }))
    const server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', () => resolve()))
    try {
      const { port } = server.address() as AddressInfo
      const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).status
      expect(await get('/pets?status=adopted')).toBe(422)
      expect(await get('/pets?status=sold')).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('an empty enum reached through a $ref constrains nothing and adds no validation', async () => {
    const empty = listPetsSpec([query('status', ref('NoMembers'))])
    expect(generateRouter(empty).content).not.toContain('_qv')
    expect(generateExpressRouter(empty).content).not.toContain('_qv')
    expect((await call(empty, 'GET', '/pets?status=anything')).status).toBe(200)
  })

  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s output typechecks', (label, gen) => {
    assertNoTsDiagnostics(
      compileGeneratedFiles({
        'service.ts': generateService(spec).content,
        'router.ts': gen(spec).content,
        '_shared/errors.ts': emitSharedErrorsFile().content,
      }),
      `${label} $ref enum query param`
    )
  })
})
