// fallow-ignore-file code-duplication
// Test specs and assertion patterns are intentionally per-test for locality and readability.
import { describe, expect, it, vi } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from '../plugins/router.js'
import { generateFastifyTypes, generateFastifyTypedService } from '../plugins/fastify-service.js'
import {
  emitSharedErrorsFile,
  deriveSharedDir,
  sharedErrorsImportPath,
  findCommonParent,
} from '../plugins/errors-emitter.js'

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeSpec(paths: OpenAPIV3_1.PathsObject, title = 'Pet Store'): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    paths,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateRouter', () => {
  it('returns a GeneratedFile with filename router.ts', () => {
    const spec = makeSpec({})
    const result = generateRouter(spec)
    expect(result).toBeDefined()
    expect(result.filename).toBe('router.ts')
  })

  it('output starts with auto-generated header', () => {
    const spec = makeSpec({})
    const result = generateRouter(spec)
    expect(result.content).toMatch(/^\/\/ This file is auto-generated/)
  })

  it('imports Hono from hono', () => {
    const spec = makeSpec({})
    const result = generateRouter(spec)
    expect(result.content).toContain("import { Hono } from 'hono'")
  })

  it('imports service interface from service.js', () => {
    const spec = makeSpec({})
    const result = generateRouter(spec)
    expect(result.content).toContain("from './service.js'")
  })

  it('exports createRouter function', () => {
    const spec = makeSpec({})
    const result = generateRouter(spec)
    expect(result.content).toContain('export function createRouter(')
  })

  it('GET route uses app.get', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('app.get("/pets"')
  })

  it('POST route uses app.post', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('app.post("/pets"')
  })

  it('DELETE route uses app.delete', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('app.delete("/pets/:id"')
  })

  it('path param {id} becomes :id in Hono route', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('app.get("/pets/:id"')
  })

  it('path param extracted via c.req.param()', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('c.req.param("id")')
  })

  it('query params extracted via c.req.query()', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'species', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain("c.req.query('species')")
  })

  it('numeric query param uses Number() coercion', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('Number(')
  })

  it('POST extracts JSON body via JSON.parse(c.req.text()) cast to typed type', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('JSON.parse(await c.req.text()) as CreatePetRequest')
  })

  it('imports body type from models.js when typed body used', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain("import type { CreatePetRequest } from './models.js'")
  })

  it('no models import when no typed body', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).not.toContain("from './models.js'")
  })

  it('POST with 201 response uses c.json(result, 201)', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('c.json(await service.createPet(')
    expect(result.content).toContain(', 201)')
  })

  it('DELETE with 204 returns new Response(null, { status: 204 })', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('new Response(null, { status: 204 })')
  })

  it('POST with only 202 declared emits c.json(result, 202)', () => {
    // Bug #9: when the single declared 2xx is not 200/201/204, honor that code.
    const spec = makeSpec({
      '/jobs': {
        post: {
          operationId: 'enqueueJob',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '202': {
              description: 'accepted',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } },
            },
          },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('c.json(await service.enqueueJob(')
    expect(result.content).toContain(', 202)')
  })

  it('Bug #10 — GET with 200+202 declared emits envelope dispatch: c.json(_envelope.body, _envelope.status)', () => {
    // Bug #10: when multiple 2xx are declared, the service returns { status, body }
    // and the router forwards both to c.json so the handler can select the status at runtime.
    const spec = makeSpec({
      '/tasks/{id}': {
        get: {
          operationId: 'getTask',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'done',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            '202': {
              description: 'still running',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
          },
        },
      },
    })
    const result = generateRouter(spec)
    expect(result.content).toContain('const _envelope = await service.getTask(')
    expect(result.content).toContain('c.json(_envelope.body, _envelope.status')
    // Must NOT use the old single-status path
    expect(result.content).not.toContain('c.json(await service.getTask(')
  })

  it('returns empty Hono app when no operations', () => {
    const spec = makeSpec({})
    const result = generateRouter(spec)
    expect(result.content).toContain('const app = new Hono()')
    expect(result.content).toContain('return app')
  })

  it('multiple path params passed in order to service', () => {
    const spec = makeSpec({
      '/owners/{ownerId}/pets/{petId}': {
        get: {
          operationId: 'getOwnerPet',
          parameters: [
            { name: 'ownerId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    // Should pass both path params
    expect(result.content).toContain('c.req.param("ownerId")')
    expect(result.content).toContain('c.req.param("petId")')
  })

  it('query param name with [] suffix is normalized to a valid TypeScript identifier', () => {
    const spec = makeSpec({
      '/events': {
        get: {
          operationId: 'listEvents',
          parameters: [
            { name: 'project_ids[]', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'event_types[]', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    // Normalized names must be used as TypeScript property names in the params object
    expect(result.content).toContain('projectIds')
    expect(result.content).toContain('eventTypes')
    // Raw names with [] must not appear in generated TypeScript
    expect(result.content).not.toContain('project_ids[]')
    expect(result.content).not.toContain('event_types[]')
  })

  it('path param with hyphens like {job-id}: c.req.param uses raw name from path', () => {
    const spec = makeSpec({
      '/jobs/{job-id}': {
        get: {
          operationId: 'getJob',
          parameters: [{ name: 'job-id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    // c.req.param uses the raw OpenAPI path param name matching the Hono route :job-id
    expect(result.content).toContain('c.req.param("job-id")')
    // The generated code must call the service method
    expect(result.content).toContain('service.getJob(')
  })

  it('mixed path segment "{maxLat}.{format}" (no operationId) does not break method name derivation', () => {
    const spec = makeSpec({
      '/map/{versionNumber}/tile/{maxLon}/{maxLat}.{format}': {
        get: {
          // no operationId — forces deriveOperationName to handle the mixed segment
          parameters: [
            { name: 'versionNumber', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'maxLon', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'maxLat', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'format', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateRouter(spec)
    // The derived method name must be a valid identifier — no }.{ from mixed segment
    expect(result.content).not.toMatch(/service\.[a-zA-Z]*\}/)
    // A route handler must be generated
    expect(result.content).toContain('app.get(')
  })

  it('service interface reference uses title-derived name', () => {
    const spec = makeSpec({}, 'My API')
    const result = generateRouter(spec)
    expect(result.content).toContain('MyAPIService')
  })
})

// ── Schema validation tests ────────────────────────────────────────────────────

describe('generateRouter with schemaNames (Zod validation)', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('adds safeParse validation when schema is in schemaNames', () => {
    const result = generateRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain('CreatePetRequestSchema.safeParse(body)')
    expect(result.content).toContain('parseResult.success')
    expect(result.content).toContain('422')
  })

  it('uses body (typed via let body: Type) in service call when schema is present', () => {
    const result = generateRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    // Hono: 'let body: CreatePetRequest' is the typed parse variable; after safeParse
    // the service receives parseResult.data (cast to the declared model type) so Zod
    // coercion is preserved while the service-call type stays correct even when the
    // schema infers a different shape (e.g. z.unknown() on inline unions).
    expect(result.content).toContain('let body: CreatePetRequest')
    expect(result.content).toContain('const validatedBody = parseResult.data as CreatePetRequest')
    expect(result.content).toContain('service.createPet(validatedBody')
  })

  it('imports z from zod and schema from schemaImportPath', () => {
    const result = generateRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain("import { z } from 'zod'")
    expect(result.content).toContain("import { CreatePetRequestSchema } from './schemas.js'")
  })

  it('does not import schema when schemaNames does not match the body type', () => {
    const result = generateRouter(postSpec, {
      schemaNames: new Set(['SomeOtherSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).not.toContain("import { z } from 'zod'")
    expect(result.content).not.toContain('safeParse')
  })

  it('does not add validation when options is undefined', () => {
    const result = generateRouter(postSpec)
    expect(result.content).not.toContain('safeParse')
    expect(result.content).not.toContain("import { z } from 'zod'")
    // uses body directly in service call
    expect(result.content).toContain('service.createPet(body')
  })

  it('does not add validation when schemaNames is empty set', () => {
    const result = generateRouter(postSpec, {
      schemaNames: new Set(),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).not.toContain('safeParse')
    expect(result.content).toContain('service.createPet(body')
  })

  it('returns 422 with Zod issues on parse failure', () => {
    const result = generateRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain(
      "{ error: 'Invalid request body', issues: parseResult.error.issues }"
    )
    expect(result.content).toContain('422')
  })

  it('only imports schemas actually used', () => {
    const specWithTwo = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
      '/owners': {
        post: {
          operationId: 'createOwner',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateOwnerRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    // Only CreatePetRequestSchema in schemaNames, not CreateOwnerRequestSchema
    const result = generateRouter(specWithTwo, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain('CreatePetRequestSchema')
    expect(result.content).not.toContain('CreateOwnerRequestSchema')
  })
})

describe('coverage: requestBody as $ref — body type falls back to untyped', () => {
  it('requestBody $ref produces a route handler without a typed body extraction', () => {
    // Covers the `if (isRef(requestBody)) return { typeName: undefined }` branch
    const spec = makeSpec({
      '/items': {
        post: {
          operationId: 'createItem',

          requestBody: { $ref: '#/components/requestBodies/ItemBody' } as any,
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    // Route is still generated, body is just untyped
    expect(content).toContain('app.post("/items"')
    expect(content).toContain('service.createItem(')
  })
})

describe('coverage: 200 response as $ref — falls through to default status 200', () => {
  it('$ref 200 response is treated as a plain 200 with unknown return', () => {
    // Covers the `if (!isRef(resp))` false branch in getResponseStatus
    const spec = makeSpec({
      '/items/{id}': {
        get: {
          operationId: 'getItem',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],

          responses: { '200': { $ref: '#/components/responses/ItemResponse' } as any },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('app.get("/items/:id"')
    expect(content).toContain('service.getItem(')
  })
})

describe('coverage: requestBody with no content property — falls back to untyped body', () => {
  it('requestBody with content: undefined produces untyped body route handler', () => {
    // Covers the `if (content === undefined) return { typeName: undefined }` branch
    const spec = makeSpec({
      '/items': {
        post: {
          operationId: 'createItem',

          requestBody: { required: true } as any, // no content property
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('app.post("/items"')
    expect(content).toContain('service.createItem(')
  })
})

describe('coverage: operation with no responses — falls back to default status', () => {
  it('operation without a responses property generates a handler with default c.json()', () => {
    // Covers the `if (responses !== undefined)` false branch in getResponseStatus
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
        } as any, // no responses property
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('app.get("/items"')
    expect(content).toContain('service.listItems(')
  })
})

describe('coverage: spec with paths=undefined — collectOperations returns empty', () => {
  it('spec without a paths property generates an empty router', () => {
    // Covers the `if (paths === undefined) return []` branch in collectOperations
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Empty', version: '1.0.0' },
      // no paths property
    } as OpenAPIV3_1.Document
    const { content } = generateRouter(spec)
    expect(content).toContain('export function createRouter')
    expect(content).not.toContain('app.get(')
  })
})

describe('coverage: deriveServiceName — spec with no title generates ApiService import', () => {
  it('spec without a title falls back to ApiService in the router service import', () => {
    // Covers `spec.info?.title ?? ''` right side and `pascal.length === 0` true branch
    const spec: OpenAPIV3_1.Document = {
      openapi: '3.1.0',
      info: { version: '1.0.0' } as OpenAPIV3_1.InfoObject,
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    }
    const { content } = generateRouter(spec)
    expect(content).toContain('import type { ApiService }')
  })
})

describe('coverage: sanitizeOperationId — all-punctuation operationId returns unknown', () => {
  it('operationId consisting entirely of non-alphanumeric characters → unknown', () => {
    // Covers `if (parts.length === 0) return 'unknown'` in sanitizeOperationId
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: '---',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('unknown(')
  })

  it('operationId starting with a digit is prefixed with underscore', () => {
    // Covers `/^[0-9]/.test(camel) ? `_${camel}` : camel` true branch
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: '2getItems',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('_2getItems(')
  })
})

describe('coverage: schemaNames provided but operation has no body — typeName is undefined branch', () => {
  it('GET operation (no body) alongside a POST when schemaNames is provided covers the typeName=undefined path', () => {
    // Covers the `if (typeName !== undefined)` false branch in schema name collection loop
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          responses: { '200': { description: 'ok' } },
        },
        post: {
          operationId: 'createItem',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateItemRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateRouter(spec, {
      schemaNames: new Set(['CreateItemRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    // GET has no body (typeName undefined) and POST has a schema match
    expect(result.content).toContain('CreateItemRequestSchema')
    expect(result.content).toContain('app.get("/items"')
  })
})

// ── Express router tests ───────────────────────────────────────────────────────

describe('generateExpressRouter', () => {
  it('returns a GeneratedFile with filename router.ts', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.filename).toBe('router.ts')
  })

  it('output starts with auto-generated header', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.content).toMatch(/^\/\/ This file is auto-generated/)
  })

  it('includes express.json() middleware note in header comment', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('express.json()')
  })

  it('imports Router from express', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("import { Router } from 'express'")
  })

  it('imports Request and Response types from express', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("import type { Request, Response } from 'express'")
  })

  it('exports createRouter function returning Router', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('export function createRouter(')
    expect(result.content).toContain('): Router {')
  })

  it('GET route uses router.get', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('router.get("/pets"')
  })

  it('POST route uses router.post', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('router.post("/pets"')
  })

  it('DELETE route uses router.delete', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('router.delete("/pets/:id"')
  })

  it('path param {id} becomes :id in route', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('router.get("/pets/:id"')
  })

  it('path param extracted via req.params bracket notation with non-null assertion', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("(req.params['id'] as string)")
  })

  it('query params extracted via req.query bracket notation', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'species', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("req.query['species'] as string | undefined")
  })

  it('numeric query param uses Number() coercion', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("Number(req.query['limit'] as string)")
  })

  it('boolean query param is coerced via _toQueryBool', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'active', in: 'query', required: false, schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("active: _toQueryBool(req.query['active'])")
  })

  it('POST extracts body from req.body with type cast', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('req.body as CreatePetRequest')
  })

  it('imports body type from models.js when typed body used', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain("import type { CreatePetRequest } from './models.js'")
  })

  it('no models import when no typed body', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).not.toContain("from './models.js'")
  })

  it('POST with 201 response uses res.status(201).json()', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('res.status(201).json(await service.createPet(')
  })

  it('DELETE with 204 uses res.status(204).end()', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('res.status(204).end()')
  })

  it('POST with only 202 declared emits res.status(202).json()', () => {
    // Bug #9: when the single declared 2xx is not 200/201/204, honor that code.
    const spec = makeSpec({
      '/jobs': {
        post: {
          operationId: 'enqueueJob',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '202': {
              description: 'accepted',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } },
            },
          },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('res.status(202).json(await service.enqueueJob(')
  })

  it('Bug #10 — GET with 200+202 declared emits envelope dispatch: res.status(_envelope.status).json(_envelope.body)', () => {
    // Bug #10: when multiple 2xx are declared, the service returns { status, body }
    // and the router forwards both so the handler can select the status at runtime.
    const spec = makeSpec({
      '/tasks/{id}': {
        get: {
          operationId: 'getTask',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'done',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            '202': {
              description: 'still running',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
          },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('const _envelope = await service.getTask(')
    expect(result.content).toContain('res.status(_envelope.status).json(_envelope.body)')
    // Must NOT use the old single-status path
    expect(result.content).not.toContain('res.json(await service.getTask(')
  })

  it('GET with 200 uses res.json()', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'array', items: {} } } },
            },
          },
        },
      },
    })
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('res.json(await service.listPets(')
  })

  it('returns empty Express router when no operations', () => {
    const spec = makeSpec({})
    const result = generateExpressRouter(spec)
    expect(result.content).toContain('const router = Router()')
    expect(result.content).toContain('return router')
  })
})

// ── Fastify router tests ───────────────────────────────────────────────────────

describe('generateFastifyRouter', () => {
  it('returns a GeneratedFile with filename router.ts', () => {
    const spec = makeSpec({})
    const result = generateFastifyRouter(spec)
    expect(result.filename).toBe('router.ts')
  })

  it('output starts with auto-generated header', () => {
    const spec = makeSpec({})
    const result = generateFastifyRouter(spec)
    expect(result.content).toMatch(/^\/\/ This file is auto-generated/)
  })

  it('imports FastifyPluginAsyncZod as type-only from fastify-type-provider-zod', () => {
    const spec = makeSpec({})
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain(
      "import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'"
    )
    // The compilers are imported as values; CreateRouterOptions derives their types via `typeof`
    // since fastify-type-provider-zod does not export ValidatorCompiler/SerializerCompiler type names.
    expect(result.content).not.toContain('ValidatorCompiler }')
    expect(result.content).not.toContain('SerializerCompiler }')
    // FastifyRequest, FastifyReply and hook handler types are type-only from fastify.
    expect(result.content).toContain("from 'fastify'")
    expect(result.content).toMatch(/import type \{[^}]*FastifyRequest[^}]*\} from 'fastify'/)
    expect(result.content).toMatch(/import type \{[^}]*FastifyReply[^}]*\} from 'fastify'/)
  })

  it('exports createRouter function returning FastifyPluginAsyncZod', () => {
    const spec = makeSpec({})
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('export function createRouter(')
    expect(result.content).toContain('): FastifyPluginAsyncZod {')
    expect(result.content).toContain('return async (app) => {')
    expect(result.content).not.toContain('): void {')
  })

  it('GET route uses app.get', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('app.get')
    expect(result.content).toContain('"/pets"')
  })

  it('POST route uses app.post', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('app.post')
    expect(result.content).toContain('"/pets"')
  })

  it('DELETE route uses app.delete', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('app.delete')
    expect(result.content).toContain('"/pets/:id"')
  })

  it('path param forwarded as { params: req.params } in the service call', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    // New input-object shape: path params bundled as { params: req.params }.
    expect(result.content).toContain('service.getPet({ params: req.params })')
  })

  it('path param adds a params schema (z.string())', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('params:')
    expect(result.content).toContain('id: z.string()')
  })

  it('query params passed via req.query to the service', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'species', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('req.query')
  })

  it('query params add a querystring schema', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'species', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('querystring:')
    expect(result.content).toContain('species: z.string().optional()')
  })

  it('POST body cast to the model type in the service call', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('req.body as CreatePetRequest')
  })

  it('imports body type from models.js when typed body used', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain("import type { CreatePetRequest } from './models.js'")
  })

  it('no models import when no typed body', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).not.toContain("from './models.js'")
  })

  it('POST with 201 uses reply.status(201) then return', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('reply.status(201)')
    expect(result.content).toContain('await service.createPet(')
  })

  it('DELETE with 204 uses reply.status(204).send()', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('reply.status(204).send()')
  })

  it('POST with only 202 declared emits reply.status(202) then return', () => {
    // Bug #9: when the single declared 2xx is not 200/201/204, honor that code.
    const spec = makeSpec({
      '/jobs': {
        post: {
          operationId: 'enqueueJob',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '202': {
              description: 'accepted',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Job' } } },
            },
          },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('reply.status(202)')
    expect(result.content).toContain('await service.enqueueJob(')
  })

  it('Bug #10 — GET with 200+202 declared emits envelope dispatch: reply.status(_envelope.status).send(_envelope.body)', () => {
    // Bug #10: when multiple 2xx are declared, the service returns { status, body }
    // and the router forwards both so the handler can select the status at runtime.
    const spec = makeSpec({
      '/tasks/{id}': {
        get: {
          operationId: 'getTask',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'done',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            '202': {
              description: 'still running',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
          },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('const _envelope = await service.getTask(')
    expect(result.content).toContain('reply.status(_envelope.status).send(_envelope.body)')
    // Must NOT use the old single-status path
    expect(result.content).not.toContain('reply.status(200)')
    expect(result.content).not.toContain('reply.status(202)')
  })

  it('GET with 200 uses return (Fastify auto-serializes)', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'array', items: {} } } },
            },
          },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('await service.listPets(')
  })

  it('route with no params has no generic type argument', () => {
    const spec = makeSpec({
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const result = generateFastifyRouter(spec)
    // No generics when no params/query/body
    expect(result.content).toContain('app.get("/health"')
    expect(result.content).not.toContain('app.get<')
  })

  it('returns empty plugin factory when no operations', () => {
    const spec = makeSpec({})
    const result = generateFastifyRouter(spec)
    expect(result.content).toContain('): FastifyPluginAsyncZod {')
    expect(result.content).toContain('return async (app) => {')
    expect(result.content).not.toContain('app.get(')
  })
})

// ── Express Zod validation tests ──────────────────────────────────────────────

describe('generateExpressRouter with schemaNames (Zod validation)', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('adds safeParse validation when schema is in schemaNames', () => {
    const result = generateExpressRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain('CreatePetRequestSchema.safeParse(req.body)')
    expect(result.content).toContain('parseResult.success')
    expect(result.content).toContain('422')
  })

  it('uses validatedBody (cast to model type) in service call when schema is present', () => {
    const result = generateExpressRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    // parseResult.data is cast to the declared model type so the service receives
    // the correct TypeScript type even when the Zod schema infers a different shape.
    expect(result.content).toContain('parseResult.data as CreatePetRequest')
    expect(result.content).toContain('service.createPet(validatedBody')
  })

  it('returns 422 with void to suppress return-type error', () => {
    const result = generateExpressRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain('return void res.status(422).json(')
    expect(result.content).toContain("error: 'Invalid request body'")
    expect(result.content).toContain('parseResult.error.issues')
  })

  it('imports schema and z from schemaImportPath', () => {
    const result = generateExpressRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain("import { z } from 'zod'")
    expect(result.content).toContain("import { CreatePetRequestSchema } from './schemas.js'")
  })

  it('falls back to plain body cast when schemaNames does not match', () => {
    const result = generateExpressRouter(postSpec, {
      schemaNames: new Set(['SomeOtherSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).not.toContain('safeParse')
    expect(result.content).toContain('req.body as CreatePetRequest')
  })

  it('falls back to plain body cast when options is undefined', () => {
    const result = generateExpressRouter(postSpec)
    expect(result.content).not.toContain('safeParse')
    expect(result.content).toContain('req.body as CreatePetRequest')
    expect(result.content).toContain('service.createPet(body')
  })
})

// ── Fastify Zod validation tests ──────────────────────────────────────────────

describe('generateFastifyRouter with schemaNames (Zod validation)', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('attaches the matched body schema to the route for native validation', () => {
    const result = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    // No hand-rolled safeParse: the body schema drives Fastify's native validatorCompiler.
    expect(result.content).toContain('body: CreatePetRequestSchema')
    expect(result.content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
    expect(result.content).not.toContain('safeParse(req.body)')
  })

  it('passes req.body (cast to the model type) in the service call when schema is present', () => {
    const result = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    // req.body is validated by the validatorCompiler and typed by the ZodTypeProvider; we cast
    // to the declared model type for the service call (specific and safe, since validation ran).
    // New input-object shape bundles body as a facet.
    expect(result.content).toContain('service.createPet({ body: req.body as CreatePetRequest })')
  })

  it('uses native validation (no hand-rolled 422 envelope for the body)', () => {
    const result = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    // Body validation errors are now native (400 FST_ERR_VALIDATION), not the old 422 envelope.
    expect(result.content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
    expect(result.content).not.toContain("error: 'Invalid request body'")
    expect(result.content).not.toContain('(reply as FastifyReply).status(422)')
  })

  it('imports schema and z from schemaImportPath', () => {
    const result = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).toContain("import { z } from 'zod'")
    expect(result.content).toContain("import { CreatePetRequestSchema } from './schemas.js'")
  })

  it('falls back to req.body when schemaNames does not match', () => {
    const result = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['SomeOtherSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(result.content).not.toContain('safeParse')
    // New input-object shape: body facet is present even when schema falls back.
    expect(result.content).toContain('service.createPet({ body: req.body')
  })

  it('falls back to req.body when options is undefined', () => {
    const result = generateFastifyRouter(postSpec)
    expect(result.content).not.toContain('safeParse')
    // New input-object shape: body facet is present even when no options are passed.
    expect(result.content).toContain('service.createPet({ body: req.body')
  })
})

// ── Bug-fix tests: Bug 1 — malformed body returns 400 ─────────────────────────
// Verifies that the Hono generator uses JSON.parse(c.req.text()) instead of
// c.req.json() — because Hono's c.req.json() silently returns null for an empty
// body instead of throwing, causing a 422 from Zod instead of the correct 400.
// JSON.parse('') always throws SyntaxError, so empty and malformed bodies both
// hit the catch block and return 400.

describe('Bug 1 — Hono: malformed/empty JSON body returns 400 instead of 500/422', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('Hono: body extraction uses JSON.parse(c.req.text()) wrapped in try/catch', () => {
    const { content } = generateRouter(postSpec)
    expect(content).toContain('try {')
    expect(content).toContain('body = JSON.parse(await c.req.text()) as CreatePetRequest')
    expect(content).toContain('} catch {')
    expect(content).toContain("return c.json({ error: 'Invalid JSON body' }, 400)")
  })

  it('Hono: body is declared with let before the try block (not const)', () => {
    const { content } = generateRouter(postSpec)
    expect(content).toContain('let body: CreatePetRequest')
    expect(content).not.toContain('const body =')
  })

  it('Hono: untyped inline body also uses JSON.parse(c.req.text()) wrapped in try/catch', () => {
    const inlineSpec = makeSpec({
      '/items': {
        post: {
          operationId: 'createItem',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(inlineSpec)
    expect(content).toContain('let body: unknown')
    expect(content).toContain('body = JSON.parse(await c.req.text()) as unknown')
    expect(content).toContain("return c.json({ error: 'Invalid JSON body' }, 400)")
  })

  it('Hono: GET routes without a body do not emit the body try/catch', () => {
    const getSpec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(getSpec)
    expect(content).not.toContain('Invalid JSON body')
    expect(content).not.toContain('let body:')
  })
})

// ── Bug-fix tests: Bug 2 — wrong Content-Type returns 415 ────────────────────
// Verifies that the Hono generator emits a Content-Type guard that rejects
// requests whose Content-Type does not start with application/json with 415.

describe('Bug 2 — Hono: non-JSON Content-Type returns 415 instead of parsing anyway', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('Hono: emits Content-Type check using c.req.header("content-type")', () => {
    const { content } = generateRouter(postSpec)
    expect(content).toContain("c.req.header('content-type')")
    expect(content).toContain("startsWith('application/json')")
    expect(content).toContain("return c.json({ error: 'Unsupported Media Type' }, 415)")
  })

  it('Hono: Content-Type check appears before the body try/catch', () => {
    const { content } = generateRouter(postSpec)
    const ctPos = content.indexOf("startsWith('application/json')")
    const tryPos = content.indexOf('JSON.parse(await c.req.text())')
    expect(ctPos).toBeGreaterThan(0)
    expect(tryPos).toBeGreaterThan(0)
    expect(ctPos).toBeLessThan(tryPos)
  })

  it('Hono: GET routes do not emit Content-Type check', () => {
    const getSpec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(getSpec)
    expect(content).not.toContain('Unsupported Media Type')
    expect(content).not.toContain('_ct')
  })
})

// ── Bug-fix tests: Bug 3 — HttpError maps to declared status ─────────────────
// Verifies that all three framework generators emit an exported HttpError class
// and wrap service calls in try/catch to map HttpError instances to their status.

describe('Bug 3 — all frameworks: exported HttpError + service try/catch maps to status', () => {
  const spec = makeSpec({
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
      delete: {
        operationId: 'deletePet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
  })

  it('Hono: imports and re-exports HttpError from shared errors module', () => {
    const { content } = generateRouter(spec)
    // HttpError is imported from the shared module, not inlined
    expect(content).toContain("import { HttpError } from './_shared/errors.js'")
    expect(content).toContain("export { HttpError } from './_shared/errors.js'")
    // Class must NOT be inlined in router.ts
    expect(content).not.toContain('class HttpError extends Error')
  })

  it('Hono: GET service call wrapped in try/catch with HttpError mapping', () => {
    const { content } = generateRouter(spec)
    expect(content).toContain('if (err instanceof HttpError)')
    expect(content).toContain(
      "{ status: err.status, headers: { 'content-type': 'application/json' } }"
    )
    expect(content).toContain('throw err')
  })

  it('Hono: 204 void route also wrapped in try/catch', () => {
    const { content } = generateRouter(spec)
    expect(content).toContain('new Response(null, { status: 204 })')
    expect(content).toContain('if (err instanceof HttpError)')
  })

  it('Express: imports and re-exports HttpError from shared errors module', () => {
    const { content } = generateExpressRouter(spec)
    // HttpError is imported from the shared module, not inlined
    expect(content).toContain("import { HttpError } from './_shared/errors.js'")
    expect(content).toContain("export { HttpError } from './_shared/errors.js'")
    // Class must NOT be inlined in router.ts
    expect(content).not.toContain('class HttpError extends Error')
  })

  it('Express: GET service call wrapped in try/catch with HttpError mapping', () => {
    const { content } = generateExpressRouter(spec)
    expect(content).toContain('if (err instanceof HttpError)')
    expect(content).toContain('return void res.status(err.status).json({ error: err.message })')
    expect(content).toContain('throw err')
  })

  it('Fastify: imports and re-exports HttpError from shared _shared/errors.js', () => {
    const { content } = generateFastifyRouter(spec)
    // Default path when no errorsImportPath is provided
    expect(content).toContain("import { HttpError } from './_shared/errors.js'")
    expect(content).toContain("export { HttpError } from './_shared/errors.js'")
    // HttpError class must NOT be inlined in router.ts
    expect(content).not.toContain('export class HttpError extends Error')
  })

  it('Fastify: central setErrorHandler maps HttpError to its status with native envelope', () => {
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain('app.setErrorHandler(')
    expect(content).toContain('if (err instanceof HttpError)')
    expect(content).toContain('statusCode: err.status')
    expect(content).toContain("_HTTP_CODES[err.status] ?? 'APP_ERROR'")
    expect(content).toContain('error: err.message')
    expect(content).toContain('message: err.message')
    expect(content).toContain('throw err')
    // Old single-field envelope must not remain
    expect(content).not.toContain('send({ error: err.message })')
  })

  it('Fastify: 200 JSON branch awaits service call so async HttpError is caught', () => {
    const jsonSpec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(jsonSpec)
    expect(content).toContain('await service.getPet(')
  })

  it('Fastify: 201 JSON branch awaits service call so async HttpError is caught', () => {
    const jsonSpec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(jsonSpec)
    expect(content).toContain('await service.createPet(')
  })
})

// ── Bug #1: inline (non-$ref) JSON request body gets safeParse wired ─────────

describe('bug #1 fix: inline JSON request body synthesizes schema name from operationId', () => {
  const inlineSpec = makeSpec({
    '/lab/inline-body': {
      post: {
        operationId: 'labInlineBody',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'rank'],
                properties: {
                  title: { type: 'string', minLength: 2 },
                  rank: { type: 'integer', minimum: 1, maximum: 5 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'echoed' } },
      },
    },
  })

  it('Hono: synthesizes LabInlineBodySchema name and wires safeParse when schema present', () => {
    const { content } = generateRouter(inlineSpec, {
      schemaNames: new Set(['LabInlineBodySchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('LabInlineBodySchema.safeParse(body)')
    expect(content).toContain('parseResult.success')
    expect(content).toContain('422')
    // Synthesized name must NOT appear in model type import (no models.ts entry)
    expect(content).not.toContain('import type { LabInlineBody }')
  })

  it('Hono: body variable is typed as unknown (synthesized, not a model type)', () => {
    const { content } = generateRouter(inlineSpec, {
      schemaNames: new Set(['LabInlineBodySchema']),
      schemaImportPath: './schemas.js',
    })
    // Type declaration for the body parse variable must be unknown, not LabInlineBody
    expect(content).toContain('let body: unknown')
    expect(content).not.toContain('let body: LabInlineBody')
  })

  it('Hono: uses validatedBody (coerced) in service call when inline schema is matched', () => {
    const { content } = generateRouter(inlineSpec, {
      schemaNames: new Set(['LabInlineBodySchema']),
      schemaImportPath: './schemas.js',
    })
    // After safeParse the service receives parseResult.data (cast to unknown for an
    // inline/synthesized schema) so Zod coercion is preserved.
    expect(content).toContain('const validatedBody = parseResult.data as unknown')
    expect(content).toContain('service.labInlineBody(validatedBody')
  })

  it('Hono: no safeParse emitted when LabInlineBodySchema not in schemaNames', () => {
    const { content } = generateRouter(inlineSpec)
    expect(content).not.toContain('safeParse')
    expect(content).toContain('service.labInlineBody(body')
  })

  it('Express: synthesizes LabInlineBodySchema name and wires safeParse when schema present', () => {
    const { content } = generateExpressRouter(inlineSpec, {
      schemaNames: new Set(['LabInlineBodySchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('LabInlineBodySchema.safeParse(req.body)')
    expect(content).toContain('422')
    expect(content).not.toContain('import type { LabInlineBody }')
  })

  it('Fastify: synthesizes LabInlineBodySchema name and wires safeParse when schema present', () => {
    const { content } = generateFastifyRouter(inlineSpec, {
      schemaNames: new Set(['LabInlineBodySchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('body: LabInlineBodySchema')
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
    // No per-route generics in the type-provider emitter.
    expect(content).not.toContain('post<')
  })
})

// ── Bug #7 fix: application/x-www-form-urlencoded body decoded via parseBody() ─

describe('bug #7 fix: form-urlencoded request body uses parseBody() not JSON.parse()', () => {
  const formSpec = makeSpec({
    '/lab/form-body': {
      post: {
        operationId: 'labFormBody',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                required: ['label', 'quantity'],
                properties: {
                  label: { type: 'string' },
                  quantity: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'echoed' } },
      },
    },
  })

  it('Hono: emits parseBody() for form-urlencoded body, not JSON.parse()', () => {
    const { content } = generateRouter(formSpec)
    expect(content).toContain('c.req.parseBody()')
    expect(content).not.toContain('JSON.parse(await c.req.text())')
  })

  it('Hono: checks for application/x-www-form-urlencoded Content-Type', () => {
    const { content } = generateRouter(formSpec)
    expect(content).toContain('application/x-www-form-urlencoded')
    expect(content).not.toContain("startsWith('application/json')")
  })

  it('Hono: synthesizes LabFormBodySchema name and wires safeParse when schema present', () => {
    const { content } = generateRouter(formSpec, {
      schemaNames: new Set(['LabFormBodySchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('LabFormBodySchema.safeParse(body)')
    expect(content).toContain('parseResult.success')
    expect(content).toContain('422')
    // Synthesized name must NOT appear in model type import
    expect(content).not.toContain('import type { LabFormBody }')
  })

  it('Hono: uses validatedBody (coerced) in service call when form schema is matched', () => {
    const { content } = generateRouter(formSpec, {
      schemaNames: new Set(['LabFormBodySchema']),
      schemaImportPath: './schemas.js',
    })
    // Form-urlencoded values arrive as strings; the service must receive the COERCED
    // data (parseResult.data), not the raw parsed body, so e.g. z.coerce.number() takes
    // effect. Cast to unknown for the synthesized form schema name.
    expect(content).toContain('const validatedBody = parseResult.data as unknown')
    expect(content).toContain('service.labFormBody(validatedBody')
  })

  it('Express: form-urlencoded body uses req.body (pre-parsed by express.urlencoded middleware)', () => {
    const { content } = generateExpressRouter(formSpec, {
      schemaNames: new Set(['LabFormBodySchema']),
      schemaImportPath: './schemas.js',
    })
    // Express pre-parses form body into req.body — same code path as JSON
    expect(content).toContain('LabFormBodySchema.safeParse(req.body)')
    expect(content).toContain('422')
  })

  it('Fastify: form-urlencoded body uses req.body (pre-parsed by fastify plugin)', () => {
    const { content } = generateFastifyRouter(formSpec, {
      schemaNames: new Set(['LabFormBodySchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('body: LabFormBodySchema')
    expect(content).toContain('req.body')
  })
})

// ── Bug #11 fix: non-JSON responses (text/plain + octet-stream) ───────────────

describe('bug #11 fix: text/plain and application/octet-stream responses', () => {
  const textSpec = makeSpec({
    '/lab/plain-text': {
      get: {
        operationId: 'labPlainText',
        responses: {
          '200': {
            description: 'plain text',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
  })

  const binarySpec = makeSpec({
    '/lab/download': {
      get: {
        operationId: 'labDownload',
        responses: {
          '200': {
            description: 'binary download',
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
    },
  })

  // ── text/plain ──────────────────────────────────────────────────────────────

  it('Hono: text/plain response emits c.text() not c.json()', () => {
    const { content } = generateRouter(textSpec)
    expect(content).toContain('c.text(')
    expect(content).not.toContain('c.json(await service.labPlainText')
  })

  it('Hono: text/plain response does NOT call c.json()', () => {
    const { content } = generateRouter(textSpec)
    // No c.json call for the service result
    expect(content).not.toContain('c.json(await service.labPlainText')
  })

  it('Express: text/plain response emits res.type("text/plain").send()', () => {
    const { content } = generateExpressRouter(textSpec)
    expect(content).toContain("res.type('text/plain')")
    expect(content).not.toContain('res.json(')
  })

  it('Fastify: text/plain response emits reply.type("text/plain").send()', () => {
    const { content } = generateFastifyRouter(textSpec)
    expect(content).toContain("reply.type('text/plain')")
    expect(content).not.toContain('return service.labPlainText')
  })

  // ── application/octet-stream ───────────────────────────────────────────────

  it('Hono: octet-stream response emits new Response with application/octet-stream header', () => {
    const { content } = generateRouter(binarySpec)
    expect(content).toContain('application/octet-stream')
    expect(content).not.toContain('c.json(await service.labDownload')
    // The Uint8Array result is cast to BodyInit: under TS 5.7+ a Uint8Array<ArrayBufferLike>
    // is no longer structurally assignable to BodyInit, so the generated code must cast.
    expect(content).toContain('new Response(_result as BodyInit')
  })

  it('Express: octet-stream response emits setHeader + Buffer.from().send()', () => {
    const { content } = generateExpressRouter(binarySpec)
    expect(content).toContain("setHeader('Content-Type', 'application/octet-stream')")
    expect(content).toContain('Buffer.from(')
    expect(content).not.toContain('res.json(')
  })

  it('Fastify: octet-stream response emits reply.type("application/octet-stream").send()', () => {
    const { content } = generateFastifyRouter(binarySpec)
    expect(content).toContain("reply.type('application/octet-stream')")
    expect(content).toContain('Buffer.from(')
  })

  // ── JSON path unaffected ───────────────────────────────────────────────────

  it('Hono: JSON response still uses c.json()', () => {
    const jsonSpec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
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
    })
    const { content } = generateRouter(jsonSpec)
    expect(content).toContain('c.json(await service.listPets')
    expect(content).not.toContain('c.text(')
  })
})

// ── Bug #8 fix: multipart/form-data request bodies decoded via parseBody({ all: true }) ──

describe('bug #8 fix: multipart/form-data request body uses parseBody({ all: true })', () => {
  const multipartSpec = makeSpec({
    '/lab/gallery': {
      post: {
        operationId: 'labGallery',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['photos'],
                properties: {
                  photos: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'upload ack' } },
      },
    },
  })

  it('Hono: emits parseBody({ all: true }) for multipart body, not JSON.parse()', () => {
    const { content } = generateRouter(multipartSpec)
    expect(content).toContain('parseBody({ all: true })')
    expect(content).not.toContain('JSON.parse(await c.req.text())')
  })

  it('Hono: does NOT check for application/json Content-Type for multipart body', () => {
    const { content } = generateRouter(multipartSpec)
    expect(content).not.toContain("startsWith('application/json')")
  })

  it('Hono: does NOT emit the Unsupported Media Type 415 guard for multipart body', () => {
    const { content } = generateRouter(multipartSpec)
    // The multipart path skips the content-type check entirely; no 415 guard
    // should be emitted for this operation.
    const gallerySection = content.slice(content.indexOf('/lab/gallery'))
    expect(gallerySection.slice(0, gallerySection.indexOf('\n  })'))).not.toContain('415')
  })

  it('Hono: forwards multipart body to the service call', () => {
    const { content } = generateRouter(multipartSpec)
    expect(content).toContain('service.labGallery(body)')
  })

  it('Express: multipart body uses req.files + req.body merge (assumes multer middleware)', () => {
    const { content } = generateExpressRouter(multipartSpec)
    expect(content).toContain('req.files')
    expect(content).toContain('req.body')
    // Should not attempt JSON parsing
    expect(content).not.toContain('JSON.parse')
  })

  it('Fastify: multipart body uses req.body (assumes @fastify/multipart plugin)', () => {
    const { content } = generateFastifyRouter(multipartSpec)
    // Should reference req.body for the service call
    expect(content).toContain('req.body')
    // Should not attempt JSON parsing
    expect(content).not.toContain('JSON.parse')
  })

  it('all three frameworks generate without throwing', () => {
    expect(() => generateRouter(multipartSpec)).not.toThrow()
    expect(() => generateExpressRouter(multipartSpec)).not.toThrow()
    expect(() => generateFastifyRouter(multipartSpec)).not.toThrow()
  })
})

// ── Context type (issue #310) ─────────────────────────────────────────────────

describe('context type option (issue #310)', () => {
  const petSpec = makeSpec({
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
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
  })

  describe('Hono — no contextType (backward compat)', () => {
    it('createRouter signature does not include a generic type arg', () => {
      const { content } = generateRouter(petSpec)
      // PetStoreService (no generic) must appear in the factory signature
      expect(content).toContain('createRouter(service: PetStoreService): Hono')
      expect(content).not.toContain('PetStoreService<')
    })

    it('service calls do NOT include c as an extra arg', () => {
      const { content } = generateRouter(petSpec)
      expect(content).toContain('service.listPets(')
      // Verify c is not passed as ctx: the call must not end with ", c)"
      expect(content).not.toMatch(/service\.listPets\([^)]*,\s*c\)/)
    })
  })

  describe('Hono — with contextType', () => {
    it('createRouter signature uses the generic service reference', () => {
      const { content } = generateRouter(petSpec, { contextType: 'RequestContext' })
      expect(content).toContain('createRouter(service: PetStoreService<RequestContext>): Hono')
    })

    it('service calls pass c as the final argument (no other args for GET /pets)', () => {
      const { content } = generateRouter(petSpec, { contextType: 'RequestContext' })
      // service.listPets(c) — only arg is c
      expect(content).toContain('service.listPets(c)')
    })

    it('service call with path param passes path param then c', () => {
      const { content } = generateRouter(petSpec, { contextType: 'RequestContext' })
      expect(content).toContain('service.getPet(c.req.param("id"), c)')
    })

    it('service call with body passes body then c', () => {
      const { content } = generateRouter(petSpec, { contextType: 'RequestContext' })
      expect(content).toContain('service.createPet(body, c)')
    })
  })

  describe('Express — with contextType', () => {
    it('createRouter signature uses the generic service reference', () => {
      const { content } = generateExpressRouter(petSpec, { contextType: 'RequestContext' })
      expect(content).toContain('createRouter(service: PetStoreService<RequestContext>): Router')
    })

    it('service calls pass req as the final argument (only arg for GET /pets)', () => {
      const { content } = generateExpressRouter(petSpec, { contextType: 'RequestContext' })
      expect(content).toContain('service.listPets(req)')
    })

    it('path-param route passes path param then req: service.getPet(req.params[id]!, req)', () => {
      const { content } = generateExpressRouter(petSpec, { contextType: 'RequestContext' })
      // Path comes first, ctx (req) is last
      expect(content).toContain("service.getPet((req.params['id'] as string), req)")
    })

    it('body route passes body then req: service.createPet(body, req)', () => {
      const { content } = generateExpressRouter(petSpec, { contextType: 'RequestContext' })
      // Body comes before ctx (req)
      expect(content).toContain('service.createPet(body, req)')
    })
  })

  describe('Express — no contextType (backward compat)', () => {
    it('service calls do NOT include req as an extra ctx arg', () => {
      const { content } = generateExpressRouter(petSpec)
      // GET /pets has no path params, body, or query — service call has no args at all
      expect(content).toContain('service.listPets()')
    })
  })

  describe('Fastify — with contextType', () => {
    it('createRouter is generic over Ctx with required options; no bare context type name is baked in', () => {
      const { content } = generateFastifyRouter(petSpec, { contextType: 'RequestContext' })
      // The router is generic over Ctx so the principal type is inferred at the call site.
      // options is required (no ?) when contextType is set because createContext is required.
      expect(content).toContain(
        'export function createRouter<Ctx = never>(service: PetStoreService<Ctx>, options: CreateRouterOptions<Ctx>): FastifyPluginAsyncZod'
      )
      // The configured type name must NOT appear as an unresolved reference in the output.
      expect(content).not.toContain('PetStoreService<RequestContext>')
      expect(content).not.toContain('CreateRouterOptions<RequestContext>')
    })

    it('emits CreateRouterOptions<Ctx = never> generic interface with createContext field when contextType set', () => {
      const { content } = generateFastifyRouter(petSpec, { contextType: 'RequestContext' })
      expect(content).toContain('export interface CreateRouterOptions<Ctx = never> {')
      expect(content).toContain('createContext: (req: FastifyRequest) => Ctx | Promise<Ctx>')
    })

    it('service calls pass ctx (from createContext) as the final argument (only arg for GET /pets)', () => {
      const { content } = generateFastifyRouter(petSpec, { contextType: 'RequestContext' })
      // createContext is called first, result is ctx; service receives ctx not raw req
      expect(content).toContain('const ctx = await options.createContext(req)')
      expect(content).toContain('service.listPets(ctx)')
    })

    it('path-param route passes path params inside input object, ctx follows: service.getPet({ params: req.params }, ctx)', () => {
      const { content } = generateFastifyRouter(petSpec, { contextType: 'RequestContext' })
      // New input-object shape: params bundled inside input; ctx (from createContext) follows separately.
      expect(content).toContain('service.getPet({ params: req.params }, ctx)')
    })
  })

  describe('Fastify — no contextType (backward compat)', () => {
    it('service calls do NOT include req as an extra ctx arg', () => {
      const { content } = generateFastifyRouter(petSpec)
      // GET /pets has no path params, body, or query — service call has no args
      expect(content).toContain('service.listPets()')
    })
  })

  describe('context arg ordering: path + body + query simultaneously with contextType', () => {
    // A route that has ALL three input kinds at once. The generated service call must
    // follow the fixed order: path params, body, query params (as params), then ctx.
    const fullArgSpec = makeSpec({
      '/pets/{id}': {
        patch: {
          operationId: 'updatePet',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'dryRun', in: 'query', required: false, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UpdatePetRequest' } },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    })

    it('Express: arg order is path, body, query params, req', () => {
      const { content } = generateExpressRouter(fullArgSpec, { contextType: 'RequestContext' })
      // Full call: service.updatePet((req.params['id'] as string), body, params, req)
      expect(content).toContain(
        "service.updatePet((req.params['id'] as string), body, params, req)"
      )
    })

    it('Fastify: all request dimensions bundled inside single input object, ctx follows', () => {
      const { content } = generateFastifyRouter(fullArgSpec, { contextType: 'RequestContext' })
      // New input-object shape: params, body, query are facets of a single required input;
      // ctx (from createContext) is a separate trailing arg. Eliminates TS1016.
      expect(content).toContain(
        'service.updatePet({ params: req.params, body: req.body as UpdatePetRequest, query: req.query }, ctx)'
      )
    })
  })
})

// ── Issue #308: Fastify schema.response for runtime response validation ─────────

describe('issue #308: Fastify schema.response wiring', () => {
  const getPetSpec = makeSpec({
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
  })

  const listPetsSpec = makeSpec({
    '/pets': {
      get: {
        operationId: 'listPets',
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
  })

  const noSchemaSpec = makeSpec({
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
  })

  it('direct $ref response: emits schema.response with TypeSchema when schema is in schemaNames', () => {
    const { content } = generateFastifyRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('response: { 200: PetSchema }')
  })

  it('direct $ref response: schema.response appears in the route registration options', () => {
    const { content } = generateFastifyRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    // The options object must be between the path and the handler (no per-route generics).
    expect(content).toMatch(/app\.get\("\/pets\/:id", \{ schema:/)
  })

  it('array-of-$ref response: emits z.array(TypeSchema) in schema.response', () => {
    const { content } = generateFastifyRouter(listPetsSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('schema: { response: { 200: z.array(PetSchema) } }')
  })

  it('array response schema: imports z from zod for z.array() expression', () => {
    const { content } = generateFastifyRouter(listPetsSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain("import { z } from 'zod'")
  })

  it('no matching response schema: route still uses an options object (params + config, no response)', () => {
    const { content } = generateFastifyRouter(noSchemaSpec, {
      schemaNames: new Set(['SomeOtherSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).not.toContain('response: {')
    // The options object is always present (path-param schema + config.operationId).
    expect(content).toContain("config: { operationId: 'getPet' }")
    expect(content).toContain('"/pets/:id",')
  })

  it('no schemaNames option: no schema.response added', () => {
    const { content } = generateFastifyRouter(getPetSpec)
    expect(content).not.toContain('schema: { response:')
  })

  it('response schema import is added to the generated file', () => {
    const { content } = generateFastifyRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain("import { PetSchema } from './schemas.js'")
  })

  it('response schema and body schema share a single import statement', () => {
    const postGetSpec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(postGetSpec, {
      schemaNames: new Set(['CreatePetRequestSchema', 'PetSchema']),
      schemaImportPath: './schemas.js',
    })
    // Both must appear in a single import line
    const importMatch = content.match(/^import \{ ([^}]+) \} from '\.\/schemas\.js'/m)
    expect(importMatch).not.toBeNull()
    expect(importMatch![1]).toContain('CreatePetRequestSchema')
    expect(importMatch![1]).toContain('PetSchema')
  })

  it('setSerializerCompiler uses the fastify-type-provider-zod compiler', () => {
    const { content } = generateFastifyRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain(
      'app.setSerializerCompiler(options?.serializerCompiler ?? serializerCompiler)'
    )
    expect(content).toContain(
      "import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'"
    )
    expect(content).toContain(
      "import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'"
    )
  })

  it('compilers are registered once regardless of response-schema matches', () => {
    const { content } = generateFastifyRouter(getPetSpec, {
      schemaNames: new Set(['SomeOtherSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain(
      'app.setSerializerCompiler(options?.serializerCompiler ?? serializerCompiler)'
    )
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
  })

  it('compilers are registered once even when schemaNames is not provided', () => {
    const { content } = generateFastifyRouter(getPetSpec)
    expect(content).toContain(
      'app.setSerializerCompiler(options?.serializerCompiler ?? serializerCompiler)'
    )
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
  })

  it('void (DELETE 204) operation: no schema.response added', () => {
    const deleteSpec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const { content } = generateFastifyRouter(deleteSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).not.toContain('schema: { response:')
  })

  it('multi-status operation (200+202): no schema.response added', () => {
    const multiStatusSpec = makeSpec({
      '/tasks/{id}': {
        get: {
          operationId: 'getTask',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'done',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            '202': {
              description: 'still running',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(multiStatusSpec, {
      schemaNames: new Set(['TaskSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).not.toContain('schema: { response:')
  })

  it('201 response: schema.response uses status code 201', () => {
    const postSpec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['CreatePetRequestSchema', 'PetSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('response: { 201: PetSchema }')
  })

  it('z is imported when the route needs it (e.g. a params schema)', () => {
    const { content } = generateFastifyRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    // getPetSpec has a path param whose params schema uses z.string(), so z is imported.
    expect(content).toMatch(/^import \{ z \} from 'zod'/m)
  })

  it('Hono and Express generators are unaffected by response schema options', () => {
    const honoContent = generateRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    }).content
    expect(honoContent).not.toContain('schema: { response:')
    expect(honoContent).not.toContain('setSerializerCompiler')

    const expressContent = generateExpressRouter(getPetSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    }).content
    expect(expressContent).not.toContain('schema: { response:')
    expect(expressContent).not.toContain('setSerializerCompiler')
  })
})

// ── Issue #309: Fastify operationId in route config ───────────────────────────

describe('issue #309: Fastify config.operationId in every route', () => {
  it('every Fastify route includes config.operationId matching the method name', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain("config: { operationId: 'listPets' }")
    expect(content).toContain("config: { operationId: 'createPet' }")
    expect(content).toContain("config: { operationId: 'getPet' }")
    expect(content).toContain("config: { operationId: 'deletePet' }")
  })

  it('config.operationId appears in route options even without schema.response', () => {
    const spec = makeSpec({
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain("config: { operationId: 'getHealth' }")
    // Route registration uses a 3-arg form with the options object
    expect(content).toContain('"/health", {')
  })

  it('config.operationId and schema.response are merged in the same options object', () => {
    const spec = makeSpec({
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
    })
    const { content } = generateFastifyRouter(spec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: './schemas.js',
    })
    // Both must appear in the same options object on the route registration line.
    expect(content).toContain('response: { 200: PetSchema }')
    expect(content).toContain("config: { operationId: 'getPet' }")
  })

  it('void (DELETE 204) route also gets config.operationId', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'deleted' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain("config: { operationId: 'deletePet' }")
    // No schema.response on void routes
    expect(content).not.toContain('schema: { response:')
  })

  it('derived method name (no operationId) is used in config.operationId', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          // no operationId — name is derived from path+method
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // Derived name for GET /pets is getPets
    expect(content).toContain("config: { operationId: 'getPets' }")
  })

  it('Hono and Express generators do NOT include config.operationId', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const honoContent = generateRouter(spec).content
    expect(honoContent).not.toContain('config: { operationId:')

    const expressContent = generateExpressRouter(spec).content
    expect(expressContent).not.toContain('config: { operationId:')
  })
})

// ── Issue #318: octet-stream REQUEST body parser (Fastify) ────────────────────

describe('issue #318: Fastify octet-stream request body parser', () => {
  const octetRequestSpec = makeSpec({
    '/upload': {
      post: {
        operationId: 'uploadBinary',
        requestBody: {
          required: true,
          content: {
            'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  const jsonOnlySpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('emits addContentTypeParser for octet-stream when an operation has an octet-stream request body', () => {
    const { content } = generateFastifyRouter(octetRequestSpec)
    expect(content).toContain("app.addContentTypeParser('application/octet-stream'")
    expect(content).toContain("parseAs: 'buffer'")
    expect(content).toContain('done(null, body)')
  })

  it('does NOT emit addContentTypeParser when no operation has an octet-stream request body', () => {
    const { content } = generateFastifyRouter(jsonOnlySpec)
    expect(content).not.toContain('addContentTypeParser')
  })

  it('emits a comment about the octet-stream buffer parser in the route handler', () => {
    const { content } = generateFastifyRouter(octetRequestSpec)
    expect(content).toContain('application/octet-stream: req.body is a Buffer')
  })

  it('file header includes form-urlencoded plugin requirement comment', () => {
    const { content } = generateFastifyRouter(jsonOnlySpec)
    expect(content).toContain('@fastify/formbody')
  })

  it('Hono and Express generators do NOT emit addContentTypeParser', () => {
    const honoContent = generateRouter(octetRequestSpec).content
    expect(honoContent).not.toContain('addContentTypeParser')

    const expressContent = generateExpressRouter(octetRequestSpec).content
    expect(expressContent).not.toContain('addContentTypeParser')
  })
})

// ── Component B: zero-cast path (zeroCast: true) ──────────────────────────────

describe('generateFastifyTypes (schema-types.ts emitter)', () => {
  const petSchemas = new Set(['PetSchema', 'CreatePetRequestSchema', 'ErrorSchema'])

  it('returns filename schema-types.ts', () => {
    const result = generateFastifyTypes(petSchemas, '../schemas.js')
    expect(result.filename).toBe('schema-types.ts')
  })

  it('emits z.infer alias for every schema in schemaNames', () => {
    const result = generateFastifyTypes(petSchemas, '../schemas.js')
    expect(result.content).toContain('export type Pet = z.infer<typeof PetSchema>')
    expect(result.content).toContain(
      'export type CreatePetRequest = z.infer<typeof CreatePetRequestSchema>'
    )
    expect(result.content).toContain('export type Error = z.infer<typeof ErrorSchema>')
  })

  it('imports all schema names from the provided schemaImportPath', () => {
    const result = generateFastifyTypes(petSchemas, '../schemas.js')
    expect(result.content).toContain("from '../schemas.js'")
    expect(result.content).toContain('PetSchema')
    expect(result.content).toContain('CreatePetRequestSchema')
  })

  it('imports z from zod', () => {
    const result = generateFastifyTypes(petSchemas, '../schemas.js')
    expect(result.content).toContain("import { z } from 'zod'")
  })

  it('skips schema names that do not end with Schema', () => {
    const mixed = new Set(['PetSchema', 'SomeHelper'])
    const result = generateFastifyTypes(mixed, '../schemas.js')
    expect(result.content).toContain('export type Pet = z.infer<typeof PetSchema>')
    expect(result.content).not.toContain('SomeHelper')
  })

  it('produces deterministic sorted output', () => {
    const unsorted = new Set(['ZSchema', 'ASchema', 'MSchema'])
    const result = generateFastifyTypes(unsorted, '../schemas.js')
    const lines = result.content.split('\n')
    const exportLines = lines.filter((l) => l.startsWith('export type'))
    expect(exportLines[0]).toContain('A =')
    expect(exportLines[1]).toContain('M =')
    expect(exportLines[2]).toContain('Z =')
  })
})

describe('generateFastifyTypedService (service.ts emitter for zero-cast path)', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  })

  const schemaNames = new Set(['PetSchema', 'CreatePetRequestSchema'])

  it('returns filename service.ts', () => {
    const result = generateFastifyTypedService(postSpec, {
      schemaNames,
      schemaImportPath: '../schemas.js',
    })
    expect(result.filename).toBe('service.ts')
  })

  it('imports alias types from schema-types.js (not models.js)', () => {
    const result = generateFastifyTypedService(postSpec, {
      schemaNames,
      schemaImportPath: '../schemas.js',
    })
    expect(result.content).toContain("from './schema-types.js'")
    expect(result.content).not.toContain("from './models.js'")
  })

  it('uses schema-derived alias types for body and response', () => {
    const result = generateFastifyTypedService(postSpec, {
      schemaNames,
      schemaImportPath: '../schemas.js',
    })
    expect(result.content).toContain('body: CreatePetRequest')
    expect(result.content).toContain('Promise<Pet>')
  })

  it('falls back to unknown when no schema matches', () => {
    const result = generateFastifyTypedService(postSpec, {
      schemaNames: new Set<string>(),
      schemaImportPath: '../schemas.js',
    })
    // No matching schemas: body and return type fall back to unknown.
    expect(result.content).toContain('body: unknown')
    expect(result.content).toContain('Promise<unknown>')
  })
})

describe('generateFastifyRouter zero-cast path (zeroCast: true)', () => {
  const postSpec = makeSpec({
    '/pets': {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreatePetRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  })

  const zeroOpts = {
    schemaNames: new Set(['PetSchema', 'CreatePetRequestSchema']),
    schemaImportPath: '../schemas.js',
    zeroCast: true,
  }

  it('does not import from models.js when zeroCast is set', () => {
    const result = generateFastifyRouter(postSpec, zeroOpts)
    expect(result.content).not.toContain("from './models.js'")
  })

  it('passes req.body without a cast to the service call', () => {
    const result = generateFastifyRouter(postSpec, zeroOpts)
    // Zero-cast: no `as CreatePetRequest`, no `as any`.
    // New input-object shape bundles body as a facet.
    expect(result.content).toContain('service.createPet({ body: req.body })')
    expect(result.content).not.toContain('req.body as CreatePetRequest')
    expect(result.content).not.toContain('req.body as any')
  })

  it('does not emit a response cast when zeroCast is set', () => {
    const getSpec = makeSpec({
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
    })
    const result = generateFastifyRouter(getSpec, {
      schemaNames: new Set(['PetSchema']),
      schemaImportPath: '../schemas.js',
      zeroCast: true,
    })
    // Zero-cast: no `as z.infer<...>` appended to the service call result.
    expect(result.content).not.toContain('as z.infer<typeof PetSchema>')
    // The send call should include the service result without a trailing cast.
    expect(result.content).toContain('reply.send((await service.getPet(')
  })

  it('still applies body schema for Fastify native validation', () => {
    const result = generateFastifyRouter(postSpec, zeroOpts)
    expect(result.content).toContain('body: CreatePetRequestSchema')
  })

  it('falls back to req.body as unknown for multipart/form-data (no body schema)', () => {
    const multipartSpec = makeSpec({
      '/gallery': {
        post: {
          operationId: 'uploadGallery',
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object' } } },
          },
          responses: { '204': { description: 'accepted' } },
        },
      },
    })
    const result = generateFastifyRouter(multipartSpec, {
      schemaNames: new Set<string>(),
      schemaImportPath: '../schemas.js',
      zeroCast: true,
    })
    expect(result.content).toContain('req.body as unknown')
  })

  it('legacy path (no zeroCast) still emits the body cast', () => {
    const result = generateFastifyRouter(postSpec, {
      schemaNames: new Set(['PetSchema', 'CreatePetRequestSchema']),
      schemaImportPath: '../schemas.js',
    })
    expect(result.content).toContain('req.body as CreatePetRequest')
  })
})

// ── Component C2: synthesized response schema lookup (C2) ─────────────────────

describe('generateFastifyRouter synthesized response schema (C2)', () => {
  const inlineResponseSpec = makeSpec({
    '/lab/inline-response': {
      get: {
        operationId: 'labInlineResponse',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  })

  it('wires schema.response when a synthesized response schema is in schemaNames', () => {
    const result = generateFastifyRouter(inlineResponseSpec, {
      schemaNames: new Set(['LabInlineResponseSchema']),
      schemaImportPath: '../schemas.js',
    })
    expect(result.content).toContain('response: { 200: LabInlineResponseSchema }')
  })

  it('does NOT wire schema.response when the synthesized schema is absent from schemaNames', () => {
    const result = generateFastifyRouter(inlineResponseSpec, {
      schemaNames: new Set<string>(),
      schemaImportPath: '../schemas.js',
    })
    expect(result.content).not.toContain('response: { 200: LabInlineResponseSchema }')
  })

  it('does not misidentify a body schema as a response schema (collision guard)', () => {
    const collidingSpec = makeSpec({
      '/lab/form-body': {
        post: {
          operationId: 'labFormBody',
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
          },
          responses: {
            '200': {
              description: 'echoed',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    })
    // LabFormBodySchema exists for body validation but must NOT be wired as response schema.
    const result = generateFastifyRouter(collidingSpec, {
      schemaNames: new Set(['LabFormBodySchema']),
      schemaImportPath: '../schemas.js',
    })
    expect(result.content).toContain('body: LabFormBodySchema')
    expect(result.content).not.toContain('response: { 200: LabFormBodySchema }')
  })
})

// ── Item 6: HttpError shared runtime ──────────────────────────────────────────

describe('emitSharedErrorsFile: HttpError in _shared/errors.ts', () => {
  it('returns filename _shared/errors.ts', () => {
    const result = emitSharedErrorsFile()
    expect(result.filename).toBe('_shared/errors.ts')
  })

  it('_shared/errors.ts starts with auto-generated header', () => {
    const result = emitSharedErrorsFile()
    expect(result.content).toMatch(/^\/\/ This file is auto-generated/)
  })

  it('_shared/errors.ts exports HttpError class', () => {
    const result = emitSharedErrorsFile()
    expect(result.content).toContain('export class HttpError extends Error {')
  })

  it('_shared/errors.ts HttpError class accepts status and message constructor params', () => {
    const result = emitSharedErrorsFile()
    expect(result.content).toContain('constructor(public readonly status: number, message: string)')
  })

  it('generateFastifyRouter imports HttpError from ./_shared/errors.js by default', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain("import { HttpError } from './_shared/errors.js'")
    // HttpError class must NOT be inlined in router.ts
    expect(content).not.toContain('export class HttpError extends Error')
  })

  it('generateFastifyRouter does NOT contain HttpError class definition', () => {
    const spec = makeSpec({})
    const { content } = generateFastifyRouter(spec)
    expect(content).not.toContain('class HttpError')
  })

  it('generateFastifyRouter uses custom errorsImportPath when provided', () => {
    const spec = makeSpec({})
    const { content } = generateFastifyRouter(spec, { errorsImportPath: '../_shared/errors.js' })
    expect(content).toContain("import { HttpError } from '../_shared/errors.js'")
    expect(content).toContain("export { HttpError } from '../_shared/errors.js'")
  })

  it('generateRouter (Hono) uses custom errorsImportPath when provided', () => {
    const spec = makeSpec({})
    const { content } = generateRouter(spec, { errorsImportPath: '../_shared/errors.js' })
    expect(content).toContain("import { HttpError } from '../_shared/errors.js'")
    expect(content).toContain("export { HttpError } from '../_shared/errors.js'")
  })

  it('generateExpressRouter uses custom errorsImportPath when provided', () => {
    const spec = makeSpec({})
    const { content } = generateExpressRouter(spec, { errorsImportPath: '../_shared/errors.js' })
    expect(content).toContain("import { HttpError } from '../_shared/errors.js'")
    expect(content).toContain("export { HttpError } from '../_shared/errors.js'")
  })
})

// ── Item 5: native error envelope ─────────────────────────────────────────────

describe('generateFastifyRouter: native HttpError envelope (FST_ERR_VALIDATION shape)', () => {
  const spec = makeSpec({
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '200': { description: 'ok' } },
      },
    },
  })
  // Hoist: generateFastifyRouter is pure — generate once, assert in each it block.
  const { content } = generateFastifyRouter(spec)

  it('emits _HTTP_CODES lookup object in the plugin body', () => {
    expect(content).toContain('_HTTP_CODES')
    expect(content).toContain("400: 'BAD_REQUEST'")
    expect(content).toContain("404: 'NOT_FOUND'")
    expect(content).toContain("500: 'INTERNAL_ERROR'")
  })

  it('send() uses statusCode, code, error, and message fields', () => {
    expect(content).toContain('statusCode: err.status')
    expect(content).toContain("_HTTP_CODES[err.status] ?? 'APP_ERROR'")
    expect(content).toContain('error: err.message')
    expect(content).toContain('message: err.message')
  })

  it('reply.status(err.status) is still set correctly', () => {
    expect(content).toContain('reply.status(err.status)')
  })

  it('Hono and Express generators are unaffected (still have try/catch with HttpError)', () => {
    const honoContent = generateRouter(spec).content
    expect(honoContent).toContain('if (err instanceof HttpError)')
    expect(honoContent).not.toContain('_HTTP_CODES')

    const expressContent = generateExpressRouter(spec).content
    expect(expressContent).toContain('if (err instanceof HttpError)')
    expect(expressContent).not.toContain('_HTTP_CODES')
  })
})

// ── Item 2b: response collision fallback ──────────────────────────────────────

describe('generateFastifyRouter: response schema collision fallback (item 2b)', () => {
  it('wires ${operationId}ResponseSchema when it is in schemaNames (candidate 2)', () => {
    const spec = makeSpec({
      '/lab/inline-body': {
        post: {
          operationId: 'labInlineBody',
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
          },
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    })
    // LabInlineBodySchema exists for body; LabInlineBodyResponseSchema exists for response.
    const { content } = generateFastifyRouter(spec, {
      schemaNames: new Set(['LabInlineBodySchema', 'LabInlineBodyResponseSchema']),
      schemaImportPath: '../schemas.js',
    })
    expect(content).toContain('body: LabInlineBodySchema')
    expect(content).toContain('response: { 200: LabInlineBodyResponseSchema }')
  })

  it('wires ${operationId}${statusCode}Schema when it is in schemaNames (candidate 3)', () => {
    const spec = makeSpec({
      '/lab/inline-body': {
        post: {
          operationId: 'labInlineBody',
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
          },
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
    })
    // Only the status-code variant exists in schemaNames.
    const { content } = generateFastifyRouter(spec, {
      schemaNames: new Set(['LabInlineBodySchema', 'LabInlineBody200Schema']),
      schemaImportPath: '../schemas.js',
    })
    expect(content).toContain('body: LabInlineBodySchema')
    expect(content).toContain('response: { 200: LabInlineBody200Schema }')
  })

  it('multi-status (labDualStatus): { status; body: T } envelope is unchanged', () => {
    const multiStatusSpec = makeSpec({
      '/tasks/{id}': {
        get: {
          operationId: 'getTask',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'done',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
            '202': {
              description: 'pending',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(multiStatusSpec, {
      schemaNames: new Set(['TaskSchema']),
      schemaImportPath: '../schemas.js',
    })
    // Multi-status operations get the dual-status envelope, not schema.response
    expect(content).not.toContain('schema: { response:')
    expect(content).toContain('_envelope.status')
    expect(content).toContain('_envelope.body')
  })

  it('emits console.warn when a named $ref response schema is absent from schemaNames', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const spec = makeSpec({
        '/pets/{id}': {
          get: {
            operationId: 'getPet',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      })
      // PetSchema is NOT in schemaNames: triggers the drift warning
      generateFastifyRouter(spec, {
        schemaNames: new Set(['SomeOtherSchema']),
        schemaImportPath: '../schemas.js',
      })
      expect(warnSpy).toHaveBeenCalled()
      const warnMsg = warnSpy.mock.calls[0]?.[0] as string
      expect(warnMsg).toContain('PetSchema')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('does NOT warn when named $ref response schema IS in schemaNames', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const spec = makeSpec({
        '/pets/{id}': {
          get: {
            operationId: 'getPet',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      })
      generateFastifyRouter(spec, {
        schemaNames: new Set(['PetSchema']),
        schemaImportPath: '../schemas.js',
      })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ── Item 1: header + cookie forwarding ────────────────────────────────────────

describe('generateFastifyRouter: header + cookie forwarding to service (item 1)', () => {
  it('emits { "x-api-key": req.headers["x-api-key"] } in service call with no cast', () => {
    const spec = makeSpec({
      '/secure': {
        get: {
          operationId: 'getSecure',
          parameters: [
            { name: 'X-Api-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // Service call must include the header object with no `as` cast.
    expect(content).toContain('req.headers["x-api-key"]')
    expect(content).not.toContain('as string')
    expect(content).not.toContain('as string | undefined')
  })

  it('header key is lowercased in schema.headers and in the service arg object', () => {
    const spec = makeSpec({
      '/secure': {
        get: {
          operationId: 'getSecure',
          parameters: [
            { name: 'X-Trace-ID', in: 'header', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // schema.headers key is lowercase; the service arg object key must be lowercase too.
    expect(content).toContain('"x-trace-id"')
    expect(content).not.toContain('"X-Trace-ID"')
  })

  it('emits _ckv.data as cookies arg after validation block', () => {
    const spec = makeSpec({
      '/me': {
        get: {
          operationId: 'getMe',
          parameters: [
            { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // Cookie validation via _ckv safeParse must be present.
    expect(content).toContain('_ckv')
    // Service call must pass _ckv.data (the validated cookie object).
    expect(content).toContain('_ckv.data')
    // No `as` cast on the cookie arg.
    expect(content).not.toContain('_ckv.data as')
  })

  it('operation with no headers or cookies has neither in service call', () => {
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // No header or cookie forwarding when params are absent.
    expect(content).not.toContain('req.headers[')
    expect(content).not.toContain('_ckv.data')
  })
})

// ── Commit 6: CreateRouterOptions ────────────────────────────────────────────

describe('generateFastifyRouter: CreateRouterOptions escape hatch (commit 6)', () => {
  function simpleSpec() {
    return makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
  }

  it('emits CreateRouterOptions interface in generated router.ts', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('export interface CreateRouterOptions {')
    expect(content).toContain('errorHandler?:')
    expect(content).toContain('validatorCompiler?:')
    expect(content).toContain('serializerCompiler?:')
    expect(content).toContain('registerParsers?:')
  })

  it('emits options? param in createRouter signature', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('options?: CreateRouterOptions')
    expect(content).toContain('createRouter(')
  })

  it('emits options?.validatorCompiler ?? validatorCompiler', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('options?.validatorCompiler ?? validatorCompiler')
    expect(content).toContain('options?.serializerCompiler ?? serializerCompiler')
  })

  it('emits conditional options?.errorHandler block', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('if (options?.errorHandler !== undefined)')
    expect(content).toContain('app.setErrorHandler(options.errorHandler)')
  })

  it('types CreateRouterOptions compilers via typeof, without importing nonexistent compiler type names', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    // fastify-type-provider-zod exports the compilers as values only; the option types are derived
    // via `typeof` so the generated file type-checks without phantom type-name imports.
    expect(content).toContain('validatorCompiler?: typeof validatorCompiler')
    expect(content).toContain('serializerCompiler?: typeof serializerCompiler')
    // No type-only import of ValidatorCompiler/SerializerCompiler (they are not exported).
    expect(content).not.toMatch(/import type \{[^}]*ValidatorCompiler/)
    expect(content).not.toMatch(/import type \{[^}]*SerializerCompiler/)
  })

  it('emits import type FastifyRequest and FastifyReply from fastify', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain("from 'fastify'")
    expect(content).toContain('FastifyRequest')
    expect(content).toContain('FastifyReply')
  })

  it('octet-stream parser is gated on options?.registerParsers !== false', () => {
    const spec = makeSpec({
      '/upload': {
        post: {
          operationId: 'upload',
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain('options?.registerParsers !== false')
    expect(content).toContain('addContentTypeParser')
  })

  it('spec without octet-stream body does not emit the registerParsers runtime gate', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    // No octet-stream body => no addContentTypeParser call and no runtime gate.
    // The CreateRouterOptions interface still declares registerParsers as a field,
    // but the conditional `if (options?.registerParsers !== false)` is only emitted
    // when the spec actually has an octet-stream body.
    expect(content).not.toContain('addContentTypeParser')
    expect(content).not.toContain('options?.registerParsers !== false')
  })
})

// ── Commit 7: auto-register formbody/multipart ───────────────────────────────

describe('generateFastifyRouter: auto-register formbody/multipart (commit 7)', () => {
  it('emits dynamic import of @fastify/formbody when spec has form-urlencoded body', () => {
    const spec = makeSpec({
      '/submit': {
        post: {
          operationId: 'submit',
          requestBody: {
            required: true,
            content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain("import('@fastify/formbody')")
    expect(content).toContain('app.register(_formbody.default ?? _formbody)')
    // Gated on registerParsers check.
    expect(content).toContain('options?.registerParsers !== false')
  })

  it('emits dynamic import of @fastify/multipart when spec has multipart body', () => {
    const spec = makeSpec({
      '/upload': {
        post: {
          operationId: 'uploadFile',
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain("import('@fastify/multipart')")
    expect(content).toContain(
      "app.register(_multipart.default ?? _multipart, { attachFieldsToBody: 'keyValues', ...options?.multipart })"
    )
  })

  it('spec with only JSON body emits neither formbody nor multipart imports', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // No dynamic plugin imports when spec has only JSON bodies.
    expect(content).not.toContain("import('@fastify/formbody')")
    expect(content).not.toContain("import('@fastify/multipart')")
    expect(content).not.toContain('_formbody')
    expect(content).not.toContain('_multipart')
  })

  it('generated router header comment mentions auto-registration and registerParsers opt-out', () => {
    // The header comment is the same for all specs (not conditional on body types).
    const spec = makeSpec({
      '/items': {
        get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
      },
    })
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain('auto-registered inside the plugin')
    expect(content).toContain('registerParsers: false')
  })
})

describe('generateFastifyRouter: emit_response_validation opt-in (commit 8)', () => {
  it('default off: no schema.response emitted when emitResponseValidation is not set', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // No schema.response when emitResponseValidation is not enabled.
    expect(content).not.toContain('response: {')
  })

  it('emitResponseValidation: true synthesizes z.object for flat inline object response', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'string' },
                      count: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(spec, { emitResponseValidation: true })
    expect(content).toContain('response:')
    expect(content).toContain('z.object({')
    expect(content).toContain('id: z.string()')
    expect(content).toContain('count: z.number()')
    // count is not in required, should be optional.
    expect(content).toContain('count: z.number().optional()')
  })

  it('emitResponseValidation: true falls back to z.unknown() for allOf response', () => {
    const spec = makeSpec({
      '/pets': {
        get: {
          operationId: 'listPets',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    allOf: [{ type: 'object', properties: { id: { type: 'string' } } }],
                  },
                },
              },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(spec, { emitResponseValidation: true })
    // allOf triggers z.unknown() from synthesizeResponseSchemaExpr.
    expect(content).toContain('response:')
    expect(content).toContain('200: z.unknown()')
  })

  it('emitResponseValidation: true synthesizes z.array(z.string()) for array-of-string response', () => {
    const spec = makeSpec({
      '/tags': {
        get: {
          operationId: 'listTags',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(spec, { emitResponseValidation: true })
    expect(content).toContain('response:')
    expect(content).toContain('z.array(z.string())')
  })

  it('emitResponseValidation: true does NOT add schema.response for void (204) routes', () => {
    const spec = makeSpec({
      '/pets/{id}': {
        delete: {
          operationId: 'deletePet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '204': { description: 'no content' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec, { emitResponseValidation: true })
    // Void operations must never get a response schema.
    expect(content).not.toContain('response: {')
  })

  it('emitResponseValidation: true with 201 response uses 201 as the status key', () => {
    const spec = makeSpec({
      '/pets': {
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: {
            '201': {
              description: 'created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: { id: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const { content } = generateFastifyRouter(spec, { emitResponseValidation: true })
    expect(content).toContain('response:')
    // Status code 201 should appear in the response schema map.
    expect(content).toContain('201:')
    expect(content).toContain('z.object({')
    expect(content).toContain('id: z.string()')
  })

  it('emitResponseValidation: true with $ref response schema emits nothing (isRef skipped)', () => {
    const spec: OpenAPIV3_1.Document = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Pet' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    }
    const { content } = generateFastifyRouter(spec, { emitResponseValidation: true })
    // $ref inline schemas are skipped by the synthesizer (isRef guard).
    // No schema.response should be emitted.
    expect(content).not.toContain('response: {')
  })
})

// ── synthesizePropExpr and synthesizeResponseSchemaExpr branch coverage ────────
// Drives every conditional branch via generateFastifyRouter(..., { emitResponseValidation: true })
// so that CRAP scores drop below the 30 threshold.

describe('generateFastifyRouter emit_response_validation: synthesizer branch coverage', () => {
  // Shared helpers — defined once to keep each test body short and unique.
  function makeRespSpec(
    schema: Record<string, unknown>,
    operationId = 'listItems'
  ): OpenAPIV3_1.Document {
    return makeSpec({
      '/items': {
        get: {
          operationId,
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema } },
            },
          },
        },
      },
    })
  }

  function genContent(schema: Record<string, unknown>): string {
    return generateFastifyRouter(makeRespSpec(schema), { emitResponseValidation: true }).content
  }

  // ── synthesizePropExpr branches (exercised via object property types) ─────────

  it('synthesizePropExpr: string with enum produces z.enum([...])', () => {
    const content = genContent({
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['active', 'inactive'] } },
    })
    expect(content).toContain('status: z.enum(["active", "inactive"])')
  })

  it('synthesizePropExpr: string with minLength/maxLength/pattern applies constraints', () => {
    const content = genContent({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[a-z]+$' } },
    })
    expect(content).toContain('name: z.string().min(1).max(50).regex(/^[a-z]+$/)')
  })

  it('synthesizePropExpr: number type produces z.number()', () => {
    const content = genContent({
      type: 'object',
      required: ['score'],
      properties: { score: { type: 'number' } },
    })
    expect(content).toContain('score: z.number()')
  })

  it('synthesizePropExpr: integer type produces z.number()', () => {
    const content = genContent({
      type: 'object',
      required: ['age'],
      properties: { age: { type: 'integer' } },
    })
    expect(content).toContain('age: z.number()')
  })

  it('synthesizePropExpr: boolean type produces z.boolean()', () => {
    const content = genContent({
      type: 'object',
      required: ['enabled'],
      properties: { enabled: { type: 'boolean' } },
    })
    expect(content).toContain('enabled: z.boolean()')
  })

  it('synthesizePropExpr: array property with $ref items falls back to z.unknown()', () => {
    // isRef(s.items) = true inside synthesizePropExpr -> falls through to z.unknown()
    const content = genContent({
      type: 'object',
      required: ['tags'],
      properties: {
        tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
      },
    })
    expect(content).toContain('tags: z.unknown()')
  })

  it('synthesizePropExpr: array property with no items falls back to z.unknown()', () => {
    // s.items === undefined -> array branch not entered -> falls through to z.unknown()
    const content = genContent({
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array' } },
    })
    expect(content).toContain('items: z.unknown()')
  })

  it('synthesizePropExpr: array property whose items are an object falls back to z.unknown()', () => {
    // synthesizePropExpr(items) returns 'z.unknown()' for object items; the
    // !itemExpr.startsWith('z.unknown') guard prevents wrapping -> z.unknown()
    const content = genContent({
      type: 'object',
      required: ['data'],
      properties: { data: { type: 'array', items: { type: 'object' } } },
    })
    expect(content).toContain('data: z.unknown()')
  })

  // ── synthesizeResponseSchemaExpr branches (root-level response schema) ────────

  it.each([
    ['oneOf', { oneOf: [{ type: 'object', properties: { id: { type: 'string' } } }] }],
    ['anyOf', { anyOf: [{ type: 'object', properties: { id: { type: 'string' } } }] }],
  ] as [string, Record<string, unknown>][])(
    'synthesizeResponseSchemaExpr: %s at root produces z.unknown()',
    (_, schema) => {
      const content = genContent(schema)
      expect(content).toContain('200: z.unknown()')
    }
  )

  it('synthesizeResponseSchemaExpr: array with no items produces z.array(z.unknown())', () => {
    // s.items === undefined -> synthesizeResponseSchemaExpr returns z.array(z.unknown())
    const content = genContent({ type: 'array' })
    expect(content).toContain('z.array(z.unknown())')
  })

  it('synthesizeResponseSchemaExpr: array with $ref items falls back to z.unknown()', () => {
    // isRef(s.items) = true in synthesizeResponseSchemaExpr -> returns z.unknown()
    const content = genContent({
      type: 'array',
      items: { $ref: '#/components/schemas/Tag' },
    })
    expect(content).toContain('200: z.unknown()')
  })

  it('synthesizeResponseSchemaExpr: nested object property (required) uses z.unknown()', () => {
    // type === 'object' inside property map -> required entry -> z.unknown()
    const content = genContent({
      type: 'object',
      required: ['meta'],
      properties: { meta: { type: 'object', properties: { x: { type: 'string' } } } },
    })
    expect(content).toContain('meta: z.unknown()')
  })

  it('synthesizeResponseSchemaExpr: nested object property (optional) uses z.unknown().optional()', () => {
    // type === 'object' inside property map -> optional entry -> z.unknown().optional()
    const content = genContent({
      type: 'object',
      properties: { meta: { type: 'object', properties: { x: { type: 'string' } } } },
    })
    expect(content).toContain('meta: z.unknown().optional()')
  })

  it('synthesizeResponseSchemaExpr: non-identifier property key is JSON-quoted', () => {
    // Key 'content-type' fails /[^a-zA-Z0-9_$]/ check -> JSON.stringify(key) wrapping
    const content = genContent({
      type: 'object',
      required: ['content-type'],
      properties: { 'content-type': { type: 'string' } },
    })
    expect(content).toContain('"content-type": z.string()')
  })

  it('synthesizeResponseSchemaExpr: $ref object property falls back to z.unknown() via synthesizePropExpr', () => {
    // synthesizePropExpr called for $ref property -> isRef(schema) = true -> z.unknown()
    const content = genContent({
      type: 'object',
      required: ['pet'],
      properties: { pet: { $ref: '#/components/schemas/Pet' } },
    })
    expect(content).toContain('pet: z.unknown()')
  })

  it('synthesizeResponseSchemaExpr: primitive string type at root delegates to synthesizePropExpr', () => {
    // s.type is not 'array'/'object' -> falls through to synthesizePropExpr(s) -> z.string()
    const content = genContent({ type: 'string' })
    expect(content).toContain('200: z.string()')
  })
})

// ── Shared errors location helpers ────────────────────────────────────────────

describe('findCommonParent: longest common directory prefix', () => {
  it('single path: returns parent directory of the given path', () => {
    expect(findCommonParent(['/gen/output'])).toBe('/gen')
  })

  it('two paths with shared parent: returns the shared parent', () => {
    expect(findCommonParent(['/gen/public', '/gen/admin'])).toBe('/gen')
  })

  it('deeper common ancestor: returns the longest common prefix dir', () => {
    expect(findCommonParent(['/a/b/c', '/a/b/d'])).toBe('/a/b')
  })

  it('no common ancestor beyond root: returns root', () => {
    expect(findCommonParent(['/foo/x', '/bar/y'])).toBe('/')
  })

  it('three sibling outputs: returns their common parent', () => {
    expect(findCommonParent(['/out/s1', '/out/s2', '/out/s3'])).toBe('/out')
  })
})

describe('sharedErrorsImportPath: relative import from outputDir to shared errors module', () => {
  it('single project: shared is inside output, so ./_shared/errors.js', () => {
    const outputDir = '/pkg/generated'
    const sharedDir = '/pkg/generated/_shared'
    expect(sharedErrorsImportPath(outputDir, sharedDir)).toBe('./_shared/errors.js')
  })

  it('multi project: shared is one level up, so ../_shared/errors.js', () => {
    const outputDir = '/gen/public'
    const sharedDir = '/gen/_shared'
    expect(sharedErrorsImportPath(outputDir, sharedDir)).toBe('../_shared/errors.js')
  })
})

describe('deriveSharedDir: resolves shared directory from configs', () => {
  const cwd = '/workspace'

  it('single project without shared_output: shared inside output dir', () => {
    const configs = [{ input_openapi: 'spec.json', output: 'generated' }]
    const result = deriveSharedDir(cwd, configs)
    expect(result).toBe('/workspace/generated/_shared')
  })

  it('multi project without shared_output: shared at common parent', () => {
    const configs = [
      { input_openapi: 'spec.json', output: 'gen/public' },
      { input_openapi: 'spec2.json', output: 'gen/admin' },
    ]
    const result = deriveSharedDir(cwd, configs)
    expect(result).toBe('/workspace/gen/_shared')
  })

  it('shared_output override wins over derivation', () => {
    const configs = [
      { input_openapi: 'spec.json', output: 'gen/public', shared_output: 'runtime/shared' },
      { input_openapi: 'spec2.json', output: 'gen/admin' },
    ]
    const result = deriveSharedDir(cwd, configs)
    expect(result).toBe('/workspace/runtime/shared')
  })
})

// ── Cross-router HttpError shared reference ───────────────────────────────────

describe('cross-router shared HttpError: both routers reference the same _shared/errors.js', () => {
  const petSpec = makeSpec({
    '/pets': {
      get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } },
    },
  })

  it('two Hono routers with different errorsImportPath still resolve to same logical module', () => {
    // Simulates public (output: gen/public) and admin (output: gen/admin) routers
    // with shared dir at gen/_shared. Both import ../_shared/errors.js.
    const publicContent = generateRouter(petSpec, {
      errorsImportPath: '../_shared/errors.js',
    }).content
    const adminContent = generateRouter(petSpec, {
      errorsImportPath: '../_shared/errors.js',
    }).content
    expect(publicContent).toContain("import { HttpError } from '../_shared/errors.js'")
    expect(adminContent).toContain("import { HttpError } from '../_shared/errors.js'")
    // Neither file contains an inline class (both share the same source)
    expect(publicContent).not.toContain('class HttpError extends Error')
    expect(adminContent).not.toContain('class HttpError extends Error')
  })

  it('Fastify router with multi-spec path: uses ../_shared/errors.js', () => {
    const { content } = generateFastifyRouter(petSpec, { errorsImportPath: '../_shared/errors.js' })
    expect(content).toContain("import { HttpError } from '../_shared/errors.js'")
    expect(content).toContain("export { HttpError } from '../_shared/errors.js'")
  })
})

// ── registerCustomRoutes hook ─────────────────────────────────────────────────

describe('generateFastifyRouter: registerCustomRoutes hook in CreateRouterOptions', () => {
  const spec = makeSpec({
    '/pets': {
      get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } },
    },
  })

  it('emits registerCustomRoutes field on CreateRouterOptions interface', () => {
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain('registerCustomRoutes?:')
  })

  it('emits await options.registerCustomRoutes(app) call inside plugin body', () => {
    const { content } = generateFastifyRouter(spec)
    expect(content).toContain('await options.registerCustomRoutes(app)')
  })

  it('registerCustomRoutes call appears after setErrorHandler setup', () => {
    const { content } = generateFastifyRouter(spec)
    // Search for the actual call in the plugin body, not the interface definition.
    const callFragment = 'await options.registerCustomRoutes(app)'
    const lastErrorHandlerPos = content.lastIndexOf('setErrorHandler')
    const callPos = content.indexOf(callFragment)
    expect(lastErrorHandlerPos).toBeGreaterThan(0)
    expect(callPos).toBeGreaterThan(0)
    // The call must appear after the last setErrorHandler statement
    expect(callPos).toBeGreaterThan(lastErrorHandlerPos)
  })

  it('registerCustomRoutes call appears before the spec routes', () => {
    const withRouteSpec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(withRouteSpec)
    // Probe the actual call site, not the interface field (which always precedes routes).
    const customRoutesPos = content.indexOf('await options.registerCustomRoutes(app)')
    const firstRoutePos = content.indexOf('app.get("/pets/:id"')
    expect(customRoutesPos).toBeGreaterThan(0)
    expect(firstRoutePos).toBeGreaterThan(0)
    expect(customRoutesPos).toBeLessThan(firstRoutePos)
  })
})

// ── Issue #337: global runtime hooks on generated Fastify routes ──────────────

describe('generateFastifyRouter: global hook fields in CreateRouterOptions (issue #337)', () => {
  function simpleSpec() {
    return makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          responses: { '200': { description: 'ok' } },
        },
      },
    })
  }

  it('emits onRequest field on CreateRouterOptions interface', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('onRequest?: onRequestHookHandler | onRequestHookHandler[]')
  })

  it('emits preHandler field on CreateRouterOptions interface', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('preHandler?: preHandlerHookHandler | preHandlerHookHandler[]')
  })

  it('emits onSend field on CreateRouterOptions interface', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('onSend?: onSendHookHandler | onSendHookHandler[]')
  })

  it('emits onError field on CreateRouterOptions interface', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('onError?: onErrorHookHandler | onErrorHookHandler[]')
  })

  it('imports hook handler types as type-only from fastify', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('onRequestHookHandler')
    expect(content).toContain('preHandlerHookHandler')
    expect(content).toContain('onSendHookHandler')
    expect(content).toContain('onErrorHookHandler')
    // Must be part of a type-only import from fastify
    expect(content).toMatch(/import type \{[^}]*onRequestHookHandler[^}]*\} from 'fastify'/)
  })

  it('emits app.addHook for all four hooks in the plugin body', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain("app.addHook('onRequest', _h)")
    expect(content).toContain("app.addHook('preHandler', _h)")
    expect(content).toContain("app.addHook('onSend', _h)")
    expect(content).toContain("app.addHook('onError', _h)")
  })

  it('emits _asHookArray helper in the plugin body', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    expect(content).toContain('_asHookArray')
    expect(content).toContain('Array.isArray(v)')
  })

  it('hook registration appears after setErrorHandler', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    const lastErrorHandlerPos = content.lastIndexOf('setErrorHandler')
    const firstAddHookPos = content.indexOf('app.addHook(')
    expect(lastErrorHandlerPos).toBeGreaterThan(0)
    expect(firstAddHookPos).toBeGreaterThan(0)
    expect(firstAddHookPos).toBeGreaterThan(lastErrorHandlerPos)
  })

  it('hook registration appears before registerCustomRoutes call', () => {
    const { content } = generateFastifyRouter(simpleSpec())
    const firstAddHookPos = content.indexOf('app.addHook(')
    const customRoutesPos = content.indexOf('await options.registerCustomRoutes(app)')
    expect(firstAddHookPos).toBeGreaterThan(0)
    expect(customRoutesPos).toBeGreaterThan(0)
    expect(firstAddHookPos).toBeLessThan(customRoutesPos)
  })

  it('hook registration appears before spec routes', () => {
    const withRouteSpec = makeSpec({
      '/pets/{id}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(withRouteSpec)
    const firstAddHookPos = content.indexOf('app.addHook(')
    const firstRoutePos = content.indexOf('app.get("/pets/:id"')
    expect(firstAddHookPos).toBeGreaterThan(0)
    expect(firstRoutePos).toBeGreaterThan(0)
    expect(firstAddHookPos).toBeLessThan(firstRoutePos)
  })
})

// ---------------------------------------------------------------------------
// Writable variant threading in Hono + Express routers (#nested-response-variant)
// ---------------------------------------------------------------------------

function makeContainerSpec(): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title: 'Container API', version: '1' },
    paths: {
      '/containers': {
        post: {
          operationId: 'createContainer',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Container' },
              },
            },
          },
          responses: {
            '201': {
              description: 'created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Container' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Item: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            serverId: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
            secret: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
          },
        },
        Container: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/Item' },
            } as OpenAPIV3_1.SchemaObject,
          },
        } as OpenAPIV3_1.SchemaObject,
      },
    },
  }
}

describe('generateRouter (Hono): readOnly/writeOnly transitive container body variant', () => {
  it('body type declaration uses ContainerWritable for a transitive container split', () => {
    const { content } = generateRouter(makeContainerSpec())
    // The `let body: ...` declaration in the handler should use ContainerWritable.
    expect(content).toContain('let body: ContainerWritable')
    expect(content).not.toContain('let body: Container\n')
  })

  it('body cast uses ContainerWritable', () => {
    const { content } = generateRouter(makeContainerSpec())
    // The JSON.parse cast should use ContainerWritable.
    expect(content).toContain('as ContainerWritable')
  })

  it('body validation schema name stays ContainerSchema (base name, not writable)', () => {
    const spec = makeContainerSpec()
    const schemaNames = new Set(['ContainerSchema', 'ItemSchema'])
    const { content } = generateRouter(spec, { schemaNames, schemaImportPath: './schemas.js' })
    // Validation uses the base schema name; the Zod schema matches the write shape.
    expect(content).toContain('ContainerSchema.safeParse')
    expect(content).not.toContain('ContainerWritableSchema')
  })

  it('imports ContainerWritable from models.js', () => {
    const { content } = generateRouter(makeContainerSpec())
    // ContainerWritable must be imported alongside Container.
    expect(content).toMatch(/import type \{[^}]*ContainerWritable[^}]*\} from '\.\/models\.js'/)
  })

  it('response handling uses Container (read shape), not ContainerWritable', () => {
    const { content } = generateRouter(makeContainerSpec())
    // The service call return is not cast to ContainerWritable.
    expect(content).toContain('service.createContainer(')
    // Response line (c.json) should NOT mention ContainerWritable.
    const responseSection = content.slice(content.indexOf('service.createContainer('))
    const firstReturn = responseSection.indexOf('return c.json')
    expect(responseSection.slice(0, firstReturn)).not.toContain('ContainerWritable')
  })

  it('non-variant body is unchanged when schema has no readOnly/writeOnly', () => {
    const spec: OpenAPIV3_1.Document = {
      openapi: '3.1.0',
      info: { title: 'Plain API', version: '1' },
      paths: {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } },
              },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
      components: {
        schemas: {
          Item: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
      },
    }
    const { content } = generateRouter(spec)
    expect(content).toContain('let body: Item')
    expect(content).not.toContain('ItemWritable')
  })
})

describe('generateExpressRouter: readOnly/writeOnly transitive container body variant', () => {
  it('validated body cast uses ContainerWritable for a transitive container split', () => {
    const spec = makeContainerSpec()
    // Use schema-enhanced mode so the Zod validation + cast path is exercised.
    const schemaNames = new Set(['ContainerSchema', 'ItemSchema'])
    const { content } = generateExpressRouter(spec, {
      schemaNames,
      schemaImportPath: './schemas.js',
    })
    // After safeParse, the validatedBody is cast to ContainerWritable.
    expect(content).toContain('as ContainerWritable')
  })

  it('no-Zod path: plain body assignment casts to ContainerWritable', () => {
    // Without schemaNames, the Express router uses `const body = req.body as Type`.
    const { content } = generateExpressRouter(makeContainerSpec())
    expect(content).toContain('as ContainerWritable')
    expect(content).not.toContain('as Container\n')
  })

  it('body validation schema name stays ContainerSchema (base name)', () => {
    const spec = makeContainerSpec()
    const schemaNames = new Set(['ContainerSchema', 'ItemSchema'])
    const { content } = generateExpressRouter(spec, {
      schemaNames,
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain('ContainerSchema.safeParse')
    expect(content).not.toContain('ContainerWritableSchema')
  })

  it('imports ContainerWritable from models.js', () => {
    const { content } = generateExpressRouter(makeContainerSpec())
    expect(content).toMatch(/import type \{[^}]*ContainerWritable[^}]*\} from '\.\/models\.js'/)
  })
})
