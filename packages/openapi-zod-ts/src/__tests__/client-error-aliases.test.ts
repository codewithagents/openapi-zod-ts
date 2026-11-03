/**
 * #195: per-operation error type aliases in client.ts.
 *
 * Every operation that documents explicit 4xx/5xx responses gets an additive
 * `export type <Op>Error = ApiError<Status, Body> | ...` alias so callers can
 * narrow on `error.status`.
 */
import { describe, it, expect } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateClient, buildOperationErrorTypeNames } from '../plugins/client.js'
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
  })
})
