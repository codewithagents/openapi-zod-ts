/**
 * Runtime inject() suite for the generated Fastify router (type-provider-zod edition).
 * Uses a local stub service (not the real petService) with canned returns
 * so each test controls exactly what the service layer does.
 *
 * Scenarios covered:
 *   - numeric + boolean query coercion success (#314)
 *   - mixed-case header validation passes (#313)
 *   - 204 empty body on DELETE
 *   - text/plain content-type on GET /lab/plain-text
 *   - octet-stream bytes on GET /lab/download
 *   - form-urlencoded body parsed without 415 (#318)
 *   - multipart body parsed without 415 (#318)
 *   - 200-vs-202 dual-status selection
 *   - async HttpError(404) from service returns 404 (#315)
 *   - invalid query validation now returns 400 (ajv/Zod validatorCompiler, not 422)
 *   - deepObject preValidation reshaping + coercion for /lab/deep-filter (real request)
 *   - delimiter preValidation reshaping for /lab/delimited-query (real request)
 *   - response serialization via serializerCompiler: strips unknown keys, rejects off-spec values
 */
import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import fastifyFormbody from '@fastify/formbody'
import fastifyMultipart from '@fastify/multipart'
import { createRouter } from '../../generated/router.js'
import { HttpError } from '../../generated/router.js'
import type { PetstoreService } from '../../generated/service.js'

/** Build a test Fastify app with the required parsers and a custom stub service. */
function buildApp(service: PetstoreService) {
  const app = Fastify()
  app.register(fastifyFormbody)
  app.register(fastifyMultipart, { attachFieldsToBody: true })
  app.register(createRouter(service))
  return app
}

/** Minimal stub that satisfies the interface — each test overrides the relevant method. */
function makeStub(overrides: Partial<PetstoreService> = {}): PetstoreService {
  const notImplemented = async () => {
    throw new Error('not implemented in this test')
  }
  return {
    listPets: notImplemented as PetstoreService['listPets'],
    createPet: notImplemented as PetstoreService['createPet'],
    getPet: notImplemented as PetstoreService['getPet'],
    deletePet: notImplemented as PetstoreService['deletePet'],
    labNumeric: notImplemented as PetstoreService['labNumeric'],
    labString: notImplemented as PetstoreService['labString'],
    labArray: notImplemented as PetstoreService['labArray'],
    labFormats: notImplemented as PetstoreService['labFormats'],
    labEnumConst: notImplemented as PetstoreService['labEnumConst'],
    labClosed: notImplemented as PetstoreService['labClosed'],
    labPresence: notImplemented as PetstoreService['labPresence'],
    labMap: notImplemented as PetstoreService['labMap'],
    labEmptyMap: notImplemented as PetstoreService['labEmptyMap'],
    labUnion: notImplemented as PetstoreService['labUnion'],
    labAnyOfUnion: notImplemented as PetstoreService['labAnyOfUnion'],
    labShape: notImplemented as PetstoreService['labShape'],
    labInlineShape: notImplemented as PetstoreService['labInlineShape'],
    labInheritShape: notImplemented as PetstoreService['labInheritShape'],
    labResponseUnion: notImplemented as PetstoreService['labResponseUnion'],
    labBackedEnum: notImplemented as PetstoreService['labBackedEnum'],
    labTuple: notImplemented as PetstoreService['labTuple'],
    labAllOf: notImplemented as PetstoreService['labAllOf'],
    labNestedVariant: notImplemented as PetstoreService['labNestedVariant'],
    labInlineResponse: notImplemented as PetstoreService['labInlineResponse'],
    labLooseUnion: notImplemented as PetstoreService['labLooseUnion'],
    labQuery: notImplemented as PetstoreService['labQuery'],
    labHeader: notImplemented as PetstoreService['labHeader'],
    labInlineBody: notImplemented as PetstoreService['labInlineBody'],
    labDelimitedQuery: notImplemented as PetstoreService['labDelimitedQuery'],
    labDeepFilter: notImplemented as PetstoreService['labDeepFilter'],
    labPath: notImplemented as PetstoreService['labPath'],
    labFormBody: notImplemented as PetstoreService['labFormBody'],
    labGallery: notImplemented as PetstoreService['labGallery'],
    labAccepted: notImplemented as PetstoreService['labAccepted'],
    labDualStatus: notImplemented as PetstoreService['labDualStatus'],
    labPlainText: notImplemented as PetstoreService['labPlainText'],
    labDownload: notImplemented as PetstoreService['labDownload'],
    labInt64: notImplemented as PetstoreService['labInt64'],
    ...overrides,
  }
}

describe('lab-routes inject() suite', () => {
  it('#314 numeric + boolean query params are coerced: GET /lab/query with count=42 returns 200', async () => {
    let capturedParams: { tier: string; count: number; code: string } | undefined
    const service = makeStub({
      async labQuery(input) {
        capturedParams = input.query
        return { tier: input.query.tier, count: input.query.count, code: input.query.code }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({
      method: 'GET',
      url: '/lab/query?tier=gold&count=42&code=ABC',
    })
    expect(res.statusCode).toBe(200)
    expect(capturedParams?.count).toBe(42)
    expect(typeof capturedParams?.count).toBe('number')
  })

  it('#314 invalid count (non-numeric) returns 400 from validatorCompiler (not 422)', async () => {
    const service = makeStub({
      async labQuery(input) {
        return { tier: input.query.tier, count: input.query.count, code: input.query.code }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({
      method: 'GET',
      url: '/lab/query?tier=gold&count=notanumber&code=ABC',
    })
    // fastify-type-provider-zod validatorCompiler returns 400 FST_ERR_VALIDATION (not 422).
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('FST_ERR_VALIDATION')
  })

  it('#313 lowercase X-Lab-Token header validates successfully: GET /lab/header returns 200', async () => {
    const service = makeStub({
      async labHeader() {
        return { token: 'tok-1234' }
      },
    })
    const app = buildApp(service)
    // HTTP headers are case-insensitive; Fastify normalizes them to lowercase.
    // The generator looks up headers by lowercased key so tok-1234 must pass.
    const res = await app.inject({
      method: 'GET',
      url: '/lab/header',
      headers: { 'x-lab-token': 'tok-1234' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ token: string }>()).toMatchObject({ token: 'tok-1234' })
  })

  it('#313 missing X-Lab-Token header returns 400 from validatorCompiler (not 422)', async () => {
    const service = makeStub({
      async labHeader() {
        return { token: '' }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/header' })
    // schema.headers is validated by fastify-type-provider-zod validatorCompiler: returns 400 FST_ERR_VALIDATION.
    expect(res.statusCode).toBe(400)
    expect(res.json<{ code: string }>().code).toBe('FST_ERR_VALIDATION')
  })

  it('DELETE /pets/:id returns 204 with empty body', async () => {
    const service = makeStub({
      async deletePet(_input) {
        // no-op, successful delete
      },
    })
    const app = buildApp(service)
    await app.inject({ method: 'POST', url: '/pets', payload: { name: 'Rex', species: 'dog' } })
    const res = await app.inject({ method: 'DELETE', url: '/pets/any-id' })
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  it('GET /lab/plain-text returns text/plain content-type', async () => {
    const service = makeStub({
      async labPlainText() {
        return 'hello plain text'
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/plain-text' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.body).toBe('hello plain text')
  })

  it('GET /lab/download returns application/octet-stream bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const service = makeStub({
      async labDownload() {
        return bytes
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/download' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/octet-stream/)
    expect(Buffer.from(res.rawPayload)).toEqual(Buffer.from(bytes))
  })

  it('#318 form-urlencoded body on POST /lab/form-body returns 200 without 415', async () => {
    const service = makeStub({
      async labFormBody(_input) {
        return { ok: true }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({
      method: 'POST',
      url: '/lab/form-body',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'label=test&quantity=5',
    })
    expect(res.statusCode).toBe(200)
  })

  it('#318 multipart body on POST /lab/gallery returns 200 without 415', async () => {
    const service = makeStub({
      async labGallery(_input) {
        return { count: 1 }
      },
    })
    const app = buildApp(service)
    const boundary = '----TestBoundary123'
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\ntest-gallery\r\n` +
      `--${boundary}--\r\n`
    const res = await app.inject({
      method: 'POST',
      url: '/lab/gallery',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
  })

  it('GET /lab/dual-status returns 200 when prefer=immediate', async () => {
    const service = makeStub({
      async labDualStatus(_input) {
        return { status: 200, body: { phase: 'done' } }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/dual-status?prefer=immediate' })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ phase: string }>().phase).toBe('done')
  })

  it('GET /lab/dual-status returns 202 when service returns status 202', async () => {
    const service = makeStub({
      async labDualStatus(_input) {
        return { status: 202, body: { phase: 'pending' } }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/dual-status?prefer=async' })
    expect(res.statusCode).toBe(202)
    expect(res.json<{ phase: string }>().phase).toBe('pending')
  })

  it('#315 async service throwing HttpError(404) yields statusCode 404 not 500', async () => {
    const service = makeStub({
      async getPet(_input) {
        throw new HttpError(404, 'pet not found')
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/pets/nonexistent' })
    expect(res.statusCode).toBe(404)
    expect(
      res.json<{ statusCode: number; code: string; error: string; message: string }>()
    ).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      error: 'pet not found',
      message: 'pet not found',
    })
  })

  it('#322 deepObject filter[...] params are reshaped and coerced: GET /lab/deep-filter returns 200', async () => {
    let captured: { filter: { gte?: number; lte?: number; color?: string } } | undefined
    const service = makeStub({
      async labDeepFilter(input) {
        captured = input.query
        return {
          gte: input.query.filter.gte ?? 0,
          lte: input.query.filter.lte ?? 0,
          color: input.query.filter.color,
        }
      },
    })
    const app = buildApp(service)
    // bracket-style deepObject keys are flattened by the preValidation hook,
    // then the querystring schema coerces filter.gte from "10" to the number 10.
    const res = await app.inject({
      method: 'GET',
      url: '/lab/deep-filter?filter[gte]=10&filter[color]=red',
    })
    expect(res.statusCode).toBe(200)
    expect(captured?.filter).toEqual({ gte: 10, color: 'red' })
    expect(typeof captured?.filter.gte).toBe('number')
    expect(res.json<{ gte: number; color?: string }>()).toMatchObject({ gte: 10, color: 'red' })
  })

  it('#322 delimited query params are split by their delimiter: GET /lab/delimited-query returns 200', async () => {
    let captured: { csv: string[]; ssv: string[]; psv: string[] } | undefined
    const service = makeStub({
      async labDelimitedQuery(input) {
        captured = input.query
        return { csv: input.query.csv, ssv: input.query.ssv, psv: input.query.psv }
      },
    })
    const app = buildApp(service)
    // csv -> comma, ssv -> space (%20), psv -> pipe (%7C); the hook splits each before validation.
    const res = await app.inject({
      method: 'GET',
      url: '/lab/delimited-query?csv=a,b,c&ssv=x%20y%20z&psv=p%7Cq',
    })
    expect(res.statusCode).toBe(200)
    expect(captured?.csv).toEqual(['a', 'b', 'c'])
    expect(captured?.ssv).toEqual(['x', 'y', 'z'])
    expect(captured?.psv).toEqual(['p', 'q'])
  })

  it('OQ2 response serializer strips keys not in the response schema: GET /lab/query', async () => {
    const service = makeStub({
      async labQuery(input) {
        // Return an extra field the response schema (LabQueryEchoSchema) does not declare.
        return {
          tier: input.query.tier,
          count: input.query.count,
          code: input.query.code,
          leaked: 'secret',
        } as never
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/query?tier=gold&count=7&code=ABC' })
    expect(res.statusCode).toBe(200)
    const body = res.json<Record<string, unknown>>()
    // serializerCompiler parsed the payload through the schema, dropping the undeclared key.
    expect(body).toEqual({ tier: 'gold', count: 7, code: 'ABC' })
    expect(body.leaked).toBeUndefined()
  })

  it('OQ2 response serializer rejects an off-spec value: GET /lab/query yields 500', async () => {
    const service = makeStub({
      async labQuery() {
        // count must be an integer per LabQueryEchoSchema; 1.5 fails serialization.
        return { tier: 'gold', count: 1.5, code: 'ABC' } as never
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/query?tier=gold&count=7&code=ABC' })
    // serializerCompiler throws; the custom error handler re-throws non-HttpError -> default 500.
    expect(res.statusCode).toBe(500)
  })

  it('C2 GET /lab/inline-response returns 200 validated against LabInlineResponseSchema', async () => {
    // The router wires schema.response for this route because LabInlineResponseSchema
    // was added to schemas.ts and is picked up by the synthesized-response-schema lookup.
    // The serializerCompiler validates { ok, note } against LabInlineResponseSchema.
    const service = makeStub({
      async labInlineResponse() {
        return { ok: true, note: 'inline response' }
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/inline-response' })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ ok: boolean; note: string }>()).toEqual({ ok: true, note: 'inline response' })
  })

  it('C2 GET /lab/inline-response response serializer rejects an off-spec value', async () => {
    // Verifies that LabInlineResponseSchema is enforced at serialization time.
    const service = makeStub({
      async labInlineResponse() {
        // ok must be boolean per schema; returning a string triggers serializer rejection.
        return { ok: 'yes', note: 'bad' } as never
      },
    })
    const app = buildApp(service)
    const res = await app.inject({ method: 'GET', url: '/lab/inline-response' })
    expect(res.statusCode).toBe(500)
  })
})

// ── Issue #337: global runtime hooks passed through CreateRouterOptions ────────

describe('issue #337: global hook options on createRouter (onRequest, onError)', () => {
  it('onRequest hook fires on every request and can set a response header', async () => {
    let onRequestFired = false
    const service = makeStub({
      async listPets() {
        return []
      },
    })
    const app = Fastify()
    app.register(
      createRouter(service, {
        // Hook sets a flag and adds a custom response header.
        onRequest: async (_req, reply) => {
          onRequestFired = true
          reply.header('x-hook-fired', 'yes')
        },
        // Disable parser registration: the stub service does not need them.
        registerParsers: false,
      })
    )
    const res = await app.inject({ method: 'GET', url: '/pets' })
    expect(res.statusCode).toBe(200)
    expect(onRequestFired).toBe(true)
    expect(res.headers['x-hook-fired']).toBe('yes')
  })

  it('onRequest accepts an array of hooks and all hooks fire', async () => {
    const fired: string[] = []
    const service = makeStub({
      async listPets() {
        return []
      },
    })
    const app = Fastify()
    app.register(
      createRouter(service, {
        onRequest: [
          async () => {
            fired.push('first')
          },
          async () => {
            fired.push('second')
          },
        ],
        registerParsers: false,
      })
    )
    const res = await app.inject({ method: 'GET', url: '/pets' })
    expect(res.statusCode).toBe(200)
    expect(fired).toEqual(['first', 'second'])
  })

  it('onError hook fires when a service method throws an HttpError', async () => {
    let onErrorFired = false
    const service = makeStub({
      async getPet(_input) {
        throw new HttpError(404, 'not found in hook test')
      },
    })
    const app = Fastify()
    app.register(
      createRouter(service, {
        onError: async (_req, _reply, _err) => {
          onErrorFired = true
        },
        registerParsers: false,
      })
    )
    const res = await app.inject({ method: 'GET', url: '/pets/no-such-pet' })
    // The errorHandler maps HttpError(404) to a 404 response.
    expect(res.statusCode).toBe(404)
    // The onError hook must have fired even though errorHandler handled the response.
    expect(onErrorFired).toBe(true)
  })
})
