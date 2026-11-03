/**
 * Tests for path / query / header parameter validation in generated routers.
 * Covers all three frameworks (Hono, Express, Fastify) and verifies:
 *   - Path param format (uuid) validation generates Zod checks
 *   - Required query param enforcement generates Zod checks
 *   - Integer/number query param validation generates Zod checks
 *   - Header param enforcement generates Zod checks
 *   - The 422 error shape matches the body-validation shape
 *   - Specs without params produce no validation code (no drift)
 *   - All three framework generators produce consistent output
 */
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from '../plugins/router.js'

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeSpec(paths: OpenAPIV3_1.PathsObject, title = 'Library API'): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    paths,
  }
}

type FrameworkGen = (spec: OpenAPIV3_1.Document) => { content: string }

const allFrameworks: [string, FrameworkGen][] = [
  ['Hono', generateRouter],
  ['Express', generateExpressRouter],
  ['Fastify', generateFastifyRouter],
]

// ── No-param specs: output must be unchanged (no drift) ───────────────────────

describe('no-param spec produces no param validation code', () => {
  const noParamSpec = makeSpec({
    '/books': {
      get: {
        operationId: 'listBooks',
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as [string, FrameworkGen][])('%s: no _pv/_qv/_hv variables when no params', (_, gen) => {
    const { content } = gen(noParamSpec)
    expect(content).not.toContain('_pv')
    expect(content).not.toContain('_qv')
    expect(content).not.toContain('_hv')
    expect(content).not.toContain("import { z } from 'zod'")
  })

  it('Fastify: no _pv/_qv/_hv variables when no params (z always imported for type provider)', () => {
    const { content } = generateFastifyRouter(noParamSpec)
    expect(content).not.toContain('_pv')
    expect(content).not.toContain('_qv')
    expect(content).not.toContain('_hv')
    // Fastify type-provider emitter always imports z for schema expressions
    expect(content).toContain("import { z } from 'zod'")
  })
})

describe('optional string-only params produce no validation code (no drift)', () => {
  const optionalStringSpec = makeSpec({
    '/books': {
      get: {
        operationId: 'listBooks',
        parameters: [{ name: 'author', in: 'query', required: false, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/books/{id}': {
      get: {
        operationId: 'getBook',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as [string, FrameworkGen][])(
    '%s: optional string query + plain string path produce no validation code',
    (_, gen) => {
      const { content } = gen(optionalStringSpec)
      expect(content).not.toContain('_qv')
      expect(content).not.toContain('_pv')
      expect(content).not.toContain("import { z } from 'zod'")
    }
  )

  it('Fastify: optional string query + plain string path: uses schema.querystring, z always imported', () => {
    const { content } = generateFastifyRouter(optionalStringSpec)
    expect(content).not.toContain('_qv')
    expect(content).not.toContain('_pv')
    // Fastify type-provider emitter always imports z
    expect(content).toContain("import { z } from 'zod'")
    // Query param is in querystring schema
    expect(content).toContain('querystring: z.object({ author: z.string().optional() })')
    // Path param is in params schema
    expect(content).toContain('params: z.object({ id: z.string() })')
  })
})

// ── Path param: uuid format validation ────────────────────────────────────────

describe('path param with format:uuid generates Zod validation', () => {
  const uuidSpec = makeSpec({
    '/books/{id}': {
      get: {
        operationId: 'getBook',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: generates _pv with z.uuid() for uuid path param (Zod 4 top-level form)', () => {
    const { content } = generateRouter(uuidSpec)
    expect(content).toContain('_pv')
    expect(content).toContain('z.uuid()')
    expect(content).toContain("import { z } from 'zod'")
  })

  it('Hono: _pv.safeParse passes the raw c.req.param() value', () => {
    const { content } = generateRouter(uuidSpec)
    expect(content).toContain('c.req.param("id")')
    expect(content).toContain('_pv.success')
  })

  it('Hono: 422 response uses Invalid path parameters error label', () => {
    const { content } = generateRouter(uuidSpec)
    expect(content).toContain("error: 'Invalid path parameters'")
    expect(content).toContain('_pv.error.issues')
    expect(content).toContain('422')
  })

  it('Express: generates _pv with z.uuid() (Zod 4 top-level form)', () => {
    const { content } = generateExpressRouter(uuidSpec)
    expect(content).toContain('_pv')
    expect(content).toContain('z.uuid()')
    expect(content).toContain("import { z } from 'zod'")
  })

  it("Express: _pv.safeParse passes req.params['id']", () => {
    const { content } = generateExpressRouter(uuidSpec)
    expect(content).toContain('req.params["id"] as string')
    expect(content).toContain('_pv.success')
  })

  it('Express: returns 422 with void pattern on failure', () => {
    const { content } = generateExpressRouter(uuidSpec)
    expect(content).toContain('return void res.status(422).json(')
    expect(content).toContain("error: 'Invalid path parameters'")
    expect(content).toContain('_pv.error.issues')
  })

  it('Fastify: wires z.uuid() in schema.params (native validation, Zod 4 top-level form)', () => {
    const { content } = generateFastifyRouter(uuidSpec)
    expect(content).not.toContain('_pv')
    expect(content).toContain('z.uuid()')
    expect(content).toContain("import { z } from 'zod'")
    // Validation via schema.params using native type-provider
    expect(content).toContain('params: z.object({ id: z.uuid() })')
  })

  it('Fastify: path param forwarded as { params: req.params } (ZodTypeProvider infers from schema.params)', () => {
    const { content } = generateFastifyRouter(uuidSpec)
    // Service receives the whole narrowed req.params object bundled inside the input object.
    expect(content).toContain('params: req.params')
    // No individual field destructuring (e.g. req.params.id) - ZodTypeProvider handles narrowing.
    // No manual safeParse - native validation
    expect(content).not.toContain('_pv.success')
  })

  it('Fastify: validation errors are native 400 FST_ERR_VALIDATION (no manual 422)', () => {
    const { content } = generateFastifyRouter(uuidSpec)
    // No manual 422 reply - validatorCompiler handles validation natively
    expect(content).not.toContain('status(422)')
    // setValidatorCompiler registered for native validation
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
  })

  it('plain string path param (no format) does NOT generate _pv', () => {
    const plainSpec = makeSpec({
      '/books/{id}': {
        get: {
          operationId: 'getBook',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(plainSpec)
    expect(content).not.toContain('_pv')
    expect(content).not.toContain('z.uuid()')
  })
})

// ── Query param: required enforcement ─────────────────────────────────────────

describe('required query param generates Zod validation', () => {
  const requiredQuerySpec = makeSpec({
    '/books': {
      get: {
        operationId: 'listBooks',
        parameters: [
          { name: 'genre', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'author', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: generates _qv with z.string() for required and z.string().optional() for optional', () => {
    const { content } = generateRouter(requiredQuerySpec)
    expect(content).toContain('_qv')
    expect(content).toContain('genre: z.string()')
    expect(content).toContain('author: z.string().optional()')
    expect(content).toContain("import { z } from 'zod'")
  })

  it('Hono: 422 response uses Invalid query parameters error label', () => {
    const { content } = generateRouter(requiredQuerySpec)
    expect(content).toContain("error: 'Invalid query parameters'")
    expect(content).toContain('_qv.error.issues')
    expect(content).toContain('422')
  })

  it('Express: generates _qv with required/optional Zod schema', () => {
    const { content } = generateExpressRouter(requiredQuerySpec)
    expect(content).toContain('_qv')
    expect(content).toContain('genre: z.string()')
    expect(content).toContain('author: z.string().optional()')
  })

  it('Fastify: wires required/optional query params in schema.querystring', () => {
    const { content } = generateFastifyRouter(requiredQuerySpec)
    expect(content).not.toContain('_qv')
    expect(content).toContain('querystring: z.object({')
    expect(content).toContain('genre: z.string()')
    expect(content).toContain('author: z.string().optional()')
  })

  it('Express: returns 422 with void pattern on failure', () => {
    const { content } = generateExpressRouter(requiredQuerySpec)
    expect(content).toContain('return void res.status(422).json(')
    expect(content).toContain("error: 'Invalid query parameters'")
  })

  it('Fastify: validation errors are native 400 FST_ERR_VALIDATION (no manual 422)', () => {
    const { content } = generateFastifyRouter(requiredQuerySpec)
    expect(content).not.toContain('status(422)')
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
  })
})

// ── Query param: integer coercion validation ──────────────────────────────────

describe('integer query param generates z.coerce.number() validation', () => {
  const intQuerySpec = makeSpec({
    '/books': {
      get: {
        operationId: 'listBooks',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          { name: 'page', in: 'query', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: generates _qv with z.coerce.number().optional() for optional integer', () => {
    const { content } = generateRouter(intQuerySpec)
    expect(content).toContain('_qv')
    expect(content).toContain('limit: z.coerce.number().optional()')
    expect(content).toContain('page: z.coerce.number()')
  })

  it('Hono: still uses Number() coercion in params extraction', () => {
    const { content } = generateRouter(intQuerySpec)
    expect(content).toContain('Number(')
  })

  it('Express: generates _qv with z.coerce.number() for integer params', () => {
    const { content } = generateExpressRouter(intQuerySpec)
    expect(content).toContain('_qv')
    expect(content).toContain('limit: z.coerce.number().optional()')
    expect(content).toContain('page: z.coerce.number()')
  })

  it('Fastify: wires z.coerce.number() in schema.querystring for integer params', () => {
    const { content } = generateFastifyRouter(intQuerySpec)
    expect(content).not.toContain('_qv')
    expect(content).toContain('querystring: z.object({')
    expect(content).toContain('limit: z.coerce.number().optional()')
    expect(content).toContain('page: z.coerce.number()')
  })
})

// ── Query param: boolean coercion (#314) ─────────────────────────────────────

describe('boolean query param coerces from the query string (#314)', () => {
  const boolQuerySpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          { name: 'active', in: 'query', required: true, schema: { type: 'boolean' } },
          { name: 'deleted', in: 'query', required: false, schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  // Fastify's querystring parser never converts types, so z.boolean() rejected ?active=true
  // with 400 (see query-scalar-coercion.test.ts for the runtime proof). The querystring
  // schema now accepts exactly 'true'/'false' and transforms them to a boolean.
  const boolExpr = "z.enum(['true', 'false']).transform((v) => v === 'true')"

  it('Fastify: wires boolean params as a strict string->boolean transform (no z.coerce.boolean)', () => {
    const { content } = generateFastifyRouter(boolQuerySpec)
    expect(content).toContain(boolExpr)
    // z.coerce.boolean would turn any non-empty string (e.g. 'false') into true.
    expect(content).not.toContain('z.coerce.boolean')
  })

  it('Fastify: required boolean param appears in querystring schema without .optional()', () => {
    const { content } = generateFastifyRouter(boolQuerySpec)
    expect(content).toContain(`active: ${boolExpr},`)
  })

  it('Fastify: optional boolean param appears in querystring schema with .optional()', () => {
    const { content } = generateFastifyRouter(boolQuerySpec)
    expect(content).toContain(`deleted: ${boolExpr}.optional()`)
  })

  it('Express: coerces boolean params via the _toQueryBool helper in extraction', () => {
    const { content } = generateExpressRouter(boolQuerySpec)
    expect(content).toContain("active: _toQueryBool(req.query['active'])")
    expect(content).toContain("deleted: _toQueryBool(req.query['deleted'])")
  })
})

// ── Header param: required header enforcement ─────────────────────────────────

describe('required header param generates Zod validation', () => {
  const headerSpec = makeSpec({
    '/books': {
      post: {
        operationId: 'createBook',
        parameters: [
          { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'x-trace-id', in: 'header', required: false, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  })

  it('Hono: generates _hv with z.string() for required header', () => {
    const { content } = generateRouter(headerSpec)
    expect(content).toContain('_hv')
    expect(content).toContain('"x-api-key": z.string()')
    expect(content).toContain('"x-trace-id": z.string().optional()')
    expect(content).toContain("import { z } from 'zod'")
  })

  it('Hono: uses c.req.header() to read header values', () => {
    const { content } = generateRouter(headerSpec)
    expect(content).toContain('c.req.header("x-api-key")')
  })

  it('Hono: 422 response uses Invalid request headers error label', () => {
    const { content } = generateRouter(headerSpec)
    expect(content).toContain("error: 'Invalid request headers'")
    expect(content).toContain('_hv.error.issues')
    expect(content).toContain('422')
  })

  it('Express: generates _hv with required/optional header schema', () => {
    const { content } = generateExpressRouter(headerSpec)
    expect(content).toContain('_hv')
    expect(content).toContain('"x-api-key": z.string()')
    expect(content).toContain('"x-trace-id": z.string().optional()')
  })

  it('Fastify: wires header params in schema.headers (keys lowercased per Fastify convention)', () => {
    const { content } = generateFastifyRouter(headerSpec)
    expect(content).not.toContain('_hv')
    expect(content).toContain('headers: z.object({')
    // Fastify normalizes header names to lowercase in schema.headers
    expect(content).toContain('"x-api-key": z.string()')
    expect(content).toContain('"x-trace-id": z.string().optional()')
  })

  it('Express: reads headers via req.headers[...] with string cast', () => {
    const { content } = generateExpressRouter(headerSpec)
    expect(content).toContain('req.headers["x-api-key"] as string | undefined')
  })

  it('Express: returns 422 with void pattern on header failure', () => {
    const { content } = generateExpressRouter(headerSpec)
    expect(content).toContain('return void res.status(422).json(')
    expect(content).toContain("error: 'Invalid request headers'")
    expect(content).toContain('_hv.error.issues')
  })

  it('Fastify: header validation is native (no manual req.headers lookup or 422)', () => {
    const { content } = generateFastifyRouter(headerSpec)
    // ZodTypeProvider validates headers via schema.headers natively
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
    // No manual header extraction or 422 reply
    expect(content).not.toContain('status(422)')
    expect(content).not.toContain('_hv.error.issues')
  })
})

// ── Header param: mixed-case name lowercased in value lookup (#313) ───────────

describe('header param mixed-case name: value lookup is lowercased on Fastify/Express', () => {
  const mixedCaseHeaderSpec = makeSpec({
    '/tokens': {
      post: {
        operationId: 'issueToken',
        parameters: [
          { name: 'X-Lab-Token', in: 'header', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Fastify: header key is lowercased in schema.headers (Fastify normalizes headers)', () => {
    const { content } = generateFastifyRouter(mixedCaseHeaderSpec)
    // schema.headers keys must be lowercase per Fastify header normalization
    expect(content).toContain('"x-lab-token": z.string()')
    // No manual req.headers lookup - native type-provider validation
    expect(content).not.toContain('_hv')
  })

  it('Fastify: validation is native via schema.headers (no manual req.headers extraction)', () => {
    const { content } = generateFastifyRouter(mixedCaseHeaderSpec)
    expect(content).toContain('headers: z.object({ "x-lab-token": z.string() })')
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
  })

  it('Express: looks up header by lowercased key in req.headers', () => {
    const { content } = generateExpressRouter(mixedCaseHeaderSpec)
    expect(content).toContain('req.headers["x-lab-token"] as string | undefined')
  })

  it('Express: safeParse object field still uses original-cased key', () => {
    const { content } = generateExpressRouter(mixedCaseHeaderSpec)
    expect(content).toContain('"X-Lab-Token": z.string()')
    expect(content).toContain('"X-Lab-Token": req.headers["x-lab-token"] as string | undefined')
  })

  it('Hono: still uses case-insensitive c.req.header() with original casing', () => {
    const { content } = generateRouter(mixedCaseHeaderSpec)
    expect(content).toContain('c.req.header("X-Lab-Token")')
  })
})

// ── 422 shape consistency across param types ──────────────────────────────────

describe('422 shape is consistent with body validation shape', () => {
  it('Hono path: uses c.json({ error, issues }, 422) like body validation', () => {
    const uuidSpec = makeSpec({
      '/books/{id}': {
        get: {
          operationId: 'getBook',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(uuidSpec)
    expect(content).toMatch(/c\.json\(\{[^}]*error:[^}]*issues:[^}]*\},\s*422\)/)
  })

  it('Express query: uses { error, issues } object shape', () => {
    const spec = makeSpec({
      '/books': {
        get: {
          operationId: 'listBooks',
          parameters: [{ name: 'page', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateExpressRouter(spec)
    expect(content).toContain("error: 'Invalid query parameters'")
    expect(content).toContain('_qv.error.issues')
  })

  it('Fastify header: uses native schema.headers validation (400 FST_ERR_VALIDATION, not 422)', () => {
    const spec = makeSpec({
      '/books': {
        get: {
          operationId: 'listBooks',
          parameters: [
            { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateFastifyRouter(spec)
    // Native validation via schema.headers: no manual _hv or 422 reply
    expect(content).toContain('headers: z.object({ "x-api-key": z.string() })')
    expect(content).toContain(
      'app.setValidatorCompiler(options?.validatorCompiler ?? validatorCompiler)'
    )
    expect(content).not.toContain('_hv')
    expect(content).not.toContain('status(422)')
  })
})

// ── Path param: hyphenated name uses quoted Zod key ───────────────────────────

describe('path param with hyphens uses quoted key in Zod object', () => {
  const hyphenSpec = makeSpec({
    '/jobs/{job-id}': {
      get: {
        operationId: 'getJob',
        parameters: [
          {
            name: 'job-id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: uses quoted "job-id" key in z.object()', () => {
    const { content } = generateRouter(hyphenSpec)
    expect(content).toContain('"job-id": z.uuid()')
  })

  it('Hono: passes c.req.param("job-id") to safeParse', () => {
    const { content } = generateRouter(hyphenSpec)
    expect(content).toContain('c.req.param("job-id")')
  })

  it('Express: uses req.params["job-id"] as string in safeParse', () => {
    const { content } = generateExpressRouter(hyphenSpec)
    expect(content).toContain('req.params["job-id"] as string')
  })

  it('Fastify: path params forwarded as { params: req.params } (ZodTypeProvider handles narrowing)', () => {
    const { content } = generateFastifyRouter(hyphenSpec)
    // The router now passes the whole narrowed req.params object as a facet of the input object.
    // Individual bracket-notation field access (req.params["job-id"]) is no longer emitted;
    // ZodTypeProvider infers the typed shape from schema.params and the service receives it whole.
    expect(content).toContain('params: req.params')
    expect(content).not.toContain('req.params["job-id"]')
  })
})

// ── Other format constraints ───────────────────────────────────────────────────

describe('additional format constraints generate appropriate Zod modifiers', () => {
  it('email format generates z.email() (Zod 4 top-level form)', () => {
    const spec = makeSpec({
      '/users/{email}': {
        get: {
          operationId: 'getUser',
          parameters: [
            {
              name: 'email',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'email' },
            },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('z.email()')
  })

  it('date-time format generates z.iso.datetime() (Zod 4 top-level form)', () => {
    const spec = makeSpec({
      '/events/{ts}': {
        get: {
          operationId: 'getEvent',
          parameters: [
            {
              name: 'ts',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'date-time' },
            },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('z.iso.datetime()')
  })

  it('uri format generates z.url() (Zod 4 top-level form)', () => {
    const spec = makeSpec({
      '/resources/{url}': {
        get: {
          operationId: 'getResource',
          parameters: [
            { name: 'url', in: 'path', required: true, schema: { type: 'string', format: 'uri' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).toContain('z.url()')
  })

  it('unknown format does not generate path param validation', () => {
    const spec = makeSpec({
      '/items/{code}': {
        get: {
          operationId: 'getItem',
          parameters: [
            {
              name: 'code',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'custom-format' },
            },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(spec)
    expect(content).not.toContain('_pv')
  })
})

// ── Zod import gating ─────────────────────────────────────────────────────────

describe('z import is added only when param validation is needed', () => {
  it('Hono: adds z import when uuid path param exists', () => {
    const spec = makeSpec({
      '/items/{id}': {
        get: {
          operationId: 'getItem',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    expect(generateRouter(spec).content).toContain("import { z } from 'zod'")
  })

  it('Hono: adds z import when required query param exists', () => {
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    expect(generateRouter(spec).content).toContain("import { z } from 'zod'")
  })

  it('Hono: adds z import when header param exists', () => {
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    expect(generateRouter(spec).content).toContain("import { z } from 'zod'")
  })

  it('Hono: adds z import when integer query param exists (NaN guard)', () => {
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    expect(generateRouter(spec).content).toContain("import { z } from 'zod'")
  })

  it('Hono: does NOT add z import for optional string query only', () => {
    const spec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    expect(generateRouter(spec).content).not.toContain("import { z } from 'zod'")
  })
})

// ── $ref params resolve correctly ─────────────────────────────────────────────

describe('$ref path params resolve to their schema for validation', () => {
  it('Hono: resolves $ref path param and validates uuid format', () => {
    const spec: OpenAPIV3_1.Document = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/books/{id}': {
          get: {
            operationId: 'getBook',
            parameters: [{ $ref: '#/components/parameters/BookId' }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        parameters: {
          BookId: {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        },
      },
    }
    const { content } = generateRouter(spec)
    expect(content).toContain('z.uuid()')
    expect(content).toContain('_pv')
  })
})

// ── Query param: enum constraint ──────────────────────────────────────────────

describe('query param with enum emits z.enum([...])', () => {
  const enumQuerySpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'tier',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['bronze', 'silver', 'gold'] },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)('%s: emits z.enum([...]) for string enum constraint', (fw, gen) => {
    const { content } = gen(enumQuerySpec)
    // Fastify carries the constraint in the route schema block; Hono/Express in a _qv safeParse var.
    expect(content).toContain(fw === 'Fastify' ? 'querystring:' : '_qv')
    expect(content).toContain('z.enum(["bronze", "silver", "gold"])')
    expect(content).toContain("import { z } from 'zod'")
  })
})

// ── Query param: min/max constraints ─────────────────────────────────────────

describe('query param with minimum/maximum emits .min()/.max() on z.coerce.number()', () => {
  const rangeQuerySpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'count',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)('%s: emits z.coerce.number().min(1).max(100)', (fw, gen) => {
    const { content } = gen(rangeQuerySpec)
    expect(content).toContain(fw === 'Fastify' ? 'querystring:' : '_qv')
    expect(content).toContain('z.coerce.number().min(1).max(100)')
  })
})

// ── Query param: pattern constraint ──────────────────────────────────────────

describe('query param with pattern emits .regex() on z.string()', () => {
  const patternQuerySpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'code',
            in: 'query',
            required: true,
            schema: { type: 'string', pattern: '^[A-Z]{3}$' },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)(
    '%s: emits z.string().regex(/^[A-Z]{3}$/) for pattern constraint',
    (fw, gen) => {
      const { content } = gen(patternQuerySpec)
      expect(content).toContain(fw === 'Fastify' ? 'querystring:' : '_qv')
      expect(content).toContain('z.string().regex(/^[A-Z]{3}$/)')
    }
  )
})

// ── Query param: optional string with constraint still emits _qv ─────────────

describe('optional string query param with enum constraint still emits validation', () => {
  const optionalEnumSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['active', 'inactive'] },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)(
    '%s: optional enum param still emits validation with z.enum([...]).optional()',
    (fw, gen) => {
      const { content } = gen(optionalEnumSpec)
      expect(content).toContain(fw === 'Fastify' ? 'querystring:' : '_qv')
      expect(content).toContain('z.enum(["active", "inactive"]).optional()')
    }
  )
})

// ── Header param: pattern constraint ─────────────────────────────────────────

describe('header param with pattern emits .regex() on z.string()', () => {
  const patternHeaderSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'x-token',
            in: 'header',
            required: true,
            schema: { type: 'string', pattern: '^tok-[0-9]{4}$' },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)(
    '%s: emits z.string().regex(/^tok-[0-9]{4}$/) for header pattern',
    (fw, gen) => {
      const { content } = gen(patternHeaderSpec)
      expect(content).toContain(fw === 'Fastify' ? 'headers:' : '_hv')
      expect(content).toContain('z.string().regex(/^tok-[0-9]{4}$/)')
    }
  )
})

// ── Path param: integer range constraint ──────────────────────────────────────

describe('integer path param with minimum/maximum generates Zod coerce validation', () => {
  const intPathSpec = makeSpec({
    '/items/{score}': {
      get: {
        operationId: 'getItem',
        parameters: [
          {
            name: 'score',
            in: 'path',
            required: true,
            schema: { type: 'integer', minimum: 10, maximum: 20 },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)('%s: validates the integer path param', (fw, gen) => {
    const { content } = gen(intPathSpec)
    if (fw === 'Fastify') {
      // Fastify path params stay z.string() (path segments are strings); no numeric coercion.
      expect(content).toContain('params:')
      expect(content).toContain('z.string()')
    } else {
      expect(content).toContain('_pv')
      expect(content).toContain('z.coerce.number().min(10).max(20)')
    }
    expect(content).toContain("import { z } from 'zod'")
  })

  it('Hono: _pv.safeParse uses c.req.param("score") accessor', () => {
    const { content } = generateRouter(intPathSpec)
    expect(content).toContain('c.req.param("score")')
    expect(content).toContain('_pv.success')
    expect(content).toContain("error: 'Invalid path parameters'")
  })

  it('integer path param without min/max does NOT generate _pv', () => {
    const noConstraintSpec = makeSpec({
      '/items/{id}': {
        get: {
          operationId: 'getItem',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(noConstraintSpec)
    expect(content).not.toContain('_pv')
    expect(content).not.toContain('z.coerce.number()')
  })
})

// ── Bug #4: delimited array query params (style/explode:false) ────────────────

describe('delimited array query param (style:form, explode:false) splits on comma', () => {
  const csvSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'csv',
            in: 'query',
            required: true,
            style: 'form',
            explode: false,
            schema: { type: 'array', items: { type: 'string' } },
          } as OpenAPIV3_1.ParameterObject,
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: emits .split(",") for csv param and z.array(z.string()) for validation', () => {
    const { content } = generateRouter(csvSpec)
    expect(content).toContain('.split(",")')
    expect(content).toContain('z.array(z.string())')
    expect(content).toContain('_qv')
  })

  it('Express: emits .split(",") for csv param', () => {
    const { content } = generateExpressRouter(csvSpec)
    expect(content).toContain('.split(",")')
    expect(content).toContain('z.array(z.string())')
  })

  it('Fastify: emits _dq cast and .split(",") for csv param', () => {
    const { content } = generateFastifyRouter(csvSpec)
    expect(content).toContain('_dq')
    expect(content).toContain('.split(",")')
    expect(content).toContain('z.array(z.string())')
  })
})

describe('spaceDelimited array query param splits on space', () => {
  const ssvSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'ssv',
            in: 'query',
            required: true,
            style: 'spaceDelimited',
            explode: false,
            schema: { type: 'array', items: { type: 'string' } },
          } as OpenAPIV3_1.ParameterObject,
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)('%s: emits .split(" ") for ssv param', (_, gen) => {
    const { content } = gen(ssvSpec)
    expect(content).toContain('.split(" ")')
    expect(content).toContain('z.array(z.string())')
  })
})

describe('pipeDelimited array query param splits on pipe', () => {
  const psvSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'psv',
            in: 'query',
            required: true,
            style: 'pipeDelimited',
            explode: false,
            schema: { type: 'array', items: { type: 'string' } },
          } as OpenAPIV3_1.ParameterObject,
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it.each(allFrameworks)('%s: emits .split("|") for psv param', (_, gen) => {
    const { content } = gen(psvSpec)
    expect(content).toContain('.split("|")')
    expect(content).toContain('z.array(z.string())')
  })
})

// ── Bug #5: deepObject query param assembly ───────────────────────────────────

describe('deepObject query param assembles bracket-notation keys into object', () => {
  const deepSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          {
            name: 'filter',
            in: 'query',
            required: true,
            style: 'deepObject',
            explode: true,
            schema: {
              type: 'object',
              required: ['gte', 'lte'],
              properties: {
                gte: { type: 'number' },
                lte: { type: 'number' },
                color: { type: 'string' },
              },
            },
          } as OpenAPIV3_1.ParameterObject,
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: emits c.req.queries() and filter[ prefix assembly', () => {
    const { content } = generateRouter(deepSpec)
    expect(content).toContain('c.req.queries()')
    expect(content).toContain("startsWith('filter[')")
    expect(content).toContain('_dq')
    expect(content).toContain('z.coerce.number()')
    expect(content).toContain('_qv')
  })

  it('Hono: Zod object uses coerce.number for numeric properties', () => {
    const { content } = generateRouter(deepSpec)
    expect(content).toContain('gte: z.coerce.number().optional()')
    expect(content).toContain('lte: z.coerce.number().optional()')
    expect(content).toContain('color: z.string().optional()')
  })

  it('Express: emits bracket-notation deepObject access via req.query', () => {
    const { content } = generateExpressRouter(deepSpec)
    expect(content).toContain("req.query['filter']")
    expect(content).toContain('z.coerce.number()')
  })

  it('Fastify: reshapes deepObject via preValidation hook and filter[ prefix assembly', () => {
    const { content } = generateFastifyRouter(deepSpec)
    expect(content).toContain('preValidation:')
    expect(content).toContain('startsWith("filter[")')
    expect(content).toContain('z.coerce.number()')
  })

  it('deepObject param without properties does NOT generate deepObject assembly', () => {
    // If the schema has no properties, isDeepObject stays unset
    const noPropsSpec = makeSpec({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [
            {
              name: 'filter',
              in: 'query',
              required: true,
              style: 'deepObject',
              explode: true,
              schema: { type: 'object' },
            } as OpenAPIV3_1.ParameterObject,
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    })
    const { content } = generateRouter(noPropsSpec)
    // Falls back to plain string extraction, no bracket assembly
    expect(content).not.toContain('c.req.queries()')
    expect(content).not.toContain("startsWith('filter[')")
  })
})

// ── Cookie param: required cookie enforcement (#319) ─────────────────────────

describe('required cookie param generates Zod validation', () => {
  const cookieSpec = makeSpec({
    '/profile': {
      get: {
        operationId: 'getProfile',
        parameters: [
          { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
          { name: 'locale', in: 'cookie', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: generates _ckv with z.string() for required cookie and z.string().optional() for optional', () => {
    const { content } = generateRouter(cookieSpec)
    expect(content).toContain('_ckv')
    expect(content).toContain('"session": z.string()')
    expect(content).toContain('"locale": z.string().optional()')
    expect(content).toContain("import { z } from 'zod'")
  })

  it('Hono: reads cookie via getCookie(c, "session")', () => {
    const { content } = generateRouter(cookieSpec)
    expect(content).toContain('getCookie(c, "session")')
  })

  it('Hono: imports getCookie from hono/cookie', () => {
    const { content } = generateRouter(cookieSpec)
    expect(content).toContain("import { getCookie } from 'hono/cookie'")
  })

  it('Hono: 422 response uses Invalid request cookies error label', () => {
    const { content } = generateRouter(cookieSpec)
    expect(content).toContain("error: 'Invalid request cookies'")
    expect(content).toContain('_ckv.error.issues')
    expect(content).toContain('422')
  })

  it.each([
    ['Express', generateExpressRouter] as const,
    ['Fastify', generateFastifyRouter] as const,
  ])('%s: generates _ckv with required/optional cookie schema', (_, gen) => {
    const { content } = gen(cookieSpec)
    expect(content).toContain('_ckv')
    expect(content).toContain('"session": z.string()')
    expect(content).toContain('"locale": z.string().optional()')
  })

  it('Express: reads cookie via req.cookies["session"]', () => {
    const { content } = generateExpressRouter(cookieSpec)
    expect(content).toContain('req.cookies["session"] as string | undefined')
  })

  it('Express: returns 422 with void pattern on cookie failure', () => {
    const { content } = generateExpressRouter(cookieSpec)
    expect(content).toContain('return void res.status(422).json(')
    expect(content).toContain("error: 'Invalid request cookies'")
    expect(content).toContain('_ckv.error.issues')
  })

  it('Fastify: reads cookie via guarded _cookies["session"] (safe when @fastify/cookie is absent)', () => {
    const { content } = generateFastifyRouter(cookieSpec)
    expect(content).toContain('_cookies["session"]')
    expect(content).toContain(
      '(req as { cookies?: Record<string, string | undefined> }).cookies ?? {}'
    )
  })

  it('Fastify: returns 422 via reply.status(422).send() on cookie failure', () => {
    const { content } = generateFastifyRouter(cookieSpec)
    expect(content).toContain('reply.status(422).send(')
    expect(content).toContain("error: 'Invalid request cookies'")
    expect(content).toContain('_ckv.error.issues')
  })
})

// ── Cookie param: names are case-sensitive (no lowercasing) ──────────────────

describe('cookie param names are case-sensitive: no lowercasing applied', () => {
  const mixedCaseCookieSpec = makeSpec({
    '/auth': {
      get: {
        operationId: 'checkAuth',
        parameters: [
          { name: 'SessionToken', in: 'cookie', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: uses exact cookie name (no lowercasing) in getCookie call', () => {
    const { content } = generateRouter(mixedCaseCookieSpec)
    expect(content).toContain('getCookie(c, "SessionToken")')
    expect(content).not.toContain('getCookie(c, "sessiontoken")')
  })

  it('Fastify: uses exact cookie name in _cookies lookup (case-sensitive, guarded read)', () => {
    const { content } = generateFastifyRouter(mixedCaseCookieSpec)
    expect(content).toContain('_cookies["SessionToken"]')
    expect(content).not.toContain('_cookies["sessiontoken"]')
  })

  it('Express: uses exact cookie name in req.cookies lookup', () => {
    const { content } = generateExpressRouter(mixedCaseCookieSpec)
    expect(content).toContain('req.cookies["SessionToken"] as string | undefined')
    expect(content).not.toContain('req.cookies["sessiontoken"]')
  })
})

// ── No-cookie spec: getCookie import must not appear ─────────────────────────

describe('spec without cookie params emits no getCookie import and no cookie validation', () => {
  const noCookieSpec = makeSpec({
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  })

  it('Hono: no getCookie import when no cookie params', () => {
    const { content } = generateRouter(noCookieSpec)
    expect(content).not.toContain('getCookie')
    expect(content).not.toContain('hono/cookie')
  })

  it('Hono: no _ckv variable when no cookie params', () => {
    const { content } = generateRouter(noCookieSpec)
    expect(content).not.toContain('_ckv')
  })

  it.each([
    ['Express', generateExpressRouter] as const,
    ['Fastify', generateFastifyRouter] as const,
  ])('%s: no _ckv variable when no cookie params', (_, gen) => {
    const { content } = gen(noCookieSpec)
    expect(content).not.toContain('_ckv')
  })
})
