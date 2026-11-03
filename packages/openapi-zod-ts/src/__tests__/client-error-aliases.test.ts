/**
 * #195: per-operation error type aliases in client.ts.
 *
 * Every operation that documents explicit 4xx/5xx responses gets an additive
 * `export type <Op>Error = ApiError<Status, Body> | ...` alias so callers can
 * narrow on `error.status`.
 */
import { describe, it, expect } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import {
  generateClient,
  generateClientFiles,
  buildOperationErrorTypeNames,
} from '../plugins/client.js'
import { generateClientConfig } from '../plugins/client-config.js'
import { generateTypes } from '../plugins/types.js'
import { generateIndexBarrel } from '../plugins/index-barrel.js'
import { assertNoTsDiagnostics, compileFiles } from './helpers.js'

const json = (ref: string) => ({
  content: { 'application/json': { schema: { $ref: ref } } },
})

const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'ok', ...json('#/components/schemas/Pet') },
          '422': { description: 'invalid', ...json('#/components/schemas/ValidationProblem') },
          '404': { $ref: '#/components/responses/NotFound' },
          '4XX': { description: 'range: skipped' },
          default: { description: 'default: skipped' },
        },
      },
      delete: {
        operationId: 'deletePet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'gone' },
          '500': { description: 'no body', content: { 'text/plain': {} } },
        },
      },
    },
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '200': { description: 'ok' } },
      },
      post: {
        // Collides with the component schema named CreatePetError below.
        operationId: 'createPet',
        responses: {
          '201': { description: 'created' },
          '409': {
            description: 'conflict',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { code: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    responses: {
      NotFound: { description: 'missing', ...json('#/components/schemas/NotFound') },
    },
    schemas: {
      Pet: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      NotFound: { type: 'object', properties: { message: { type: 'string' } } },
      ValidationProblem: {
        type: 'object',
        properties: { errors: { type: 'array', items: { type: 'string' } } },
        required: ['errors'],
      },
      CreatePetError: { type: 'string' },
    },
  },
}

describe('per-operation error type aliases (#195)', () => {
  const { content } = generateClient(spec)

  it('emits a union of explicit 4xx/5xx statuses, sorted, resolving response $refs', () => {
    expect(content).toContain(
      'export type GetPetError = ApiError<404, NotFound> | ApiError<422, ValidationProblem>'
    )
  })

  it('imports error body model types', () => {
    expect(content).toMatch(/import type \{[^}]*NotFound[^}]*ValidationProblem[^}]*\}/)
  })

  it('uses unknown for non-JSON or schema-less error bodies', () => {
    expect(content).toContain('export type DeletePetError = ApiError<500, unknown>')
  })

  it('emits no alias when an operation documents no explicit error status', () => {
    expect(content).not.toContain('ListPetsError')
  })

  it('renders inline error schemas and dedupes against model names', () => {
    expect(content).toContain('export type CreatePetError_2 = ApiError<409, { code?: string }>')
  })

  it('uses the configured error_body_type for bodies without a schema', () => {
    const laravel = generateClient(spec, { errorBodyType: 'laravel' }).content
    expect(laravel).toContain('export type DeletePetError = ApiError<500, LaravelValidationError>')
  })

  it('buildOperationErrorTypeNames returns the same names keyed by function name', () => {
    expect(Object.fromEntries(buildOperationErrorTypeNames(spec))).toEqual({
      getPet: 'GetPetError',
      deletePet: 'DeletePetError',
      createPet: 'CreatePetError_2',
    })
    expect(buildOperationErrorTypeNames({ ...spec, paths: undefined }).size).toBe(0)
  })

  it('compiles through the barrel and narrows on error.status', () => {
    const usage = `
      import { ApiError, type GetPetError } from './index.js'
      export function handle(error: GetPetError): string[] {
        if (error.status === 422) return error.body.errors
        const missing: 404 = error.status
        void missing
        return [error.body.message ?? '']
      }
      export const ok: GetPetError = new ApiError(404 as const, { message: 'x' })
    `
    const diagnostics = compileFiles({
      'models.ts': generateTypes(spec).content,
      'client-config.ts': generateClientConfig().content,
      'client.ts': content,
      'index.ts': generateIndexBarrel().content,
      'usage.ts': usage,
    })
    assertNoTsDiagnostics(diagnostics, 'error alias usage')
  }, 30_000)
})

describe('error-body models whose names collide with client.ts declarations', () => {
  // Fictional spec with component schemas named like the client's own ApiError
  // class and ClientConfig import, used as error bodies (directly and nested).
  const collisionSpec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Collisions', version: '1.0.0' },
    paths: {
      '/widgets/{id}': {
        get: {
          operationId: 'getWidget',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'ok', ...json('#/components/schemas/Widget') },
            '400': { description: 'bad', ...json('#/components/schemas/ApiError') },
            '409': {
              description: 'conflict',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      ApiError: { type: 'string' },
                      errors: { type: 'array', items: { $ref: '#/components/schemas/ApiError' } },
                      config: { $ref: '#/components/schemas/ClientConfig' },
                    },
                    required: ['errors'],
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Widget: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        ApiError: {
          type: 'object',
          properties: { code: { type: 'integer' }, message: { type: 'string' } },
          required: ['code'],
        },
        ClientConfig: { type: 'object', properties: { region: { type: 'string' } } },
      },
    },
  }
  const { content } = generateClient(collisionSpec)

  it('imports colliding models under a Model alias', () => {
    expect(content).toMatch(
      /import type \{[^}]*ApiError as ApiErrorModel[^}]*ClientConfig as ClientConfigModel[^}]*\} from '\.\/models\.js'/
    )
    expect(content).not.toMatch(/import type \{[^}]*\bApiError,/)
  })

  it('references the alias in the union, leaving property keys and ApiError<> alone', () => {
    expect(content).toContain(
      'export type GetWidgetError = ApiError<400, ApiErrorModel> | ApiError<409, { ApiError?: string; errors: ApiErrorModel[]; config?: ClientConfigModel }>'
    )
  })

  it('compiles under tsc --strict and narrows to the model body', () => {
    const usage = `
      import type { GetWidgetError } from './client.js'
      import type { ApiError as ApiErrorBody } from './models.js'
      export function code(error: GetWidgetError): number {
        if (error.status === 400) {
          const body: ApiErrorBody = error.body
          return body.code
        }
        return error.body.errors.length
      }
    `
    const diagnostics = compileFiles({
      'models.ts': generateTypes(collisionSpec).content,
      'client-config.ts': generateClientConfig().content,
      // No barrel: models named ApiError / ClientConfig already make index.ts's
      // \`export *\` ambiguous, independent of the error aliases.
      'client.ts': content,
      'usage.ts': usage,
    })
    assertNoTsDiagnostics(diagnostics, 'colliding error-body models')
  }, 30_000)
})

describe('error aliases with split_by_tag', () => {
  // Fictional tagged spec: a colliding `ApiError` model as an error body in one tag
  // module, a plain model in another, and an untagged op without documented errors.
  const taggedSpec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Tagged', version: '1.0.0' },
    paths: {
      '/gadgets/{id}': {
        get: {
          operationId: 'getGadget',
          tags: ['gadgets'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'ok', ...json('#/components/schemas/Gadget') },
            '404': { description: 'missing', ...json('#/components/schemas/ApiError') },
          },
        },
      },
      '/orders': {
        post: {
          operationId: 'createOrder',
          tags: ['orders'],
          responses: {
            '201': { description: 'created' },
            '422': { description: 'invalid', ...json('#/components/schemas/Problem') },
          },
        },
      },
      '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } },
    },
    components: {
      schemas: {
        Gadget: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        ApiError: {
          type: 'object',
          properties: { code: { type: 'integer' } },
          required: ['code'],
        },
        Problem: {
          type: 'object',
          properties: { detail: { type: 'string' } },
          required: ['detail'],
        },
      },
    },
  }
  const files = new Map(
    generateClientFiles(taggedSpec, { splitByTag: true }).map((f) => [f.filename, f.content])
  )

  it('declares each alias in the tag module of its operation, importing ApiError and ../models.js', () => {
    const gadgets = files.get('client/gadgets.ts')!
    expect(gadgets).toContain('export type GetGadgetError = ApiError<404, ApiErrorModel>')
    expect(gadgets).toContain(
      "import type { ApiError as ApiErrorModel, Gadget } from '../models.js'"
    )
    expect(gadgets).toContain("import { type ApiError, _request } from './_runtime.js'")

    const orders = files.get('client/orders.ts')!
    expect(orders).toContain('export type CreateOrderError = ApiError<422, Problem>')
    expect(orders).toContain("import type { Problem } from '../models.js'")
    expect(orders).toContain("import { type ApiError, _request } from './_runtime.js'")
  })

  it('modules without documented errors do not import ApiError', () => {
    expect(files.get('client/default.ts')).not.toContain('ApiError')
  })

  it('the aliases are reachable through client.ts and compile under tsc --strict', () => {
    const consumer = `
      import { ApiError, type GetGadgetError, type CreateOrderError } from './client.js'
      export function code(error: GetGadgetError): number {
        return error.body.code
      }
      export function detail(error: CreateOrderError): string {
        const status: 422 = error.status
        void status
        return error.body.detail
      }
      export const e: CreateOrderError = new ApiError(422 as const, { detail: 'x' })
    `
    const diagnostics = compileFiles({
      'models.ts': generateTypes(taggedSpec).content,
      'client-config.ts': generateClientConfig().content,
      ...Object.fromEntries(files),
      'consumer.ts': consumer,
    })
    assertNoTsDiagnostics(diagnostics, 'split client error aliases')
  }, 30_000)
})
