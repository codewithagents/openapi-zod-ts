// All requests in this suite use raw global fetch (undici), NOT the generated client.
// The generated client runs Schema.parse(body) on the client side, which short-circuits
// divergence cases: an invalid payload would be rejected before it ever reached the wire.
// Raw fetch bypasses that, so we can send bad bodies and assert per-framework behaviour.

import { describe, beforeEach, afterEach, it, expect } from 'vitest'
import { startServer, type Framework, type ServerHandle } from '../startServer.js'

// Per-framework divergence expectations. A lookup table keeps the cognitive complexity
// low and makes additions trivial without branching logic.
type DivergenceExpectation = {
  invalidBody: {
    status: number
    check: (json: Record<string, unknown>) => void
  }
  wrongContentType: {
    status: number
  }
}

// Hono and express share the two-pass validation shape (JSON parse, then Zod safeParse),
// so they return an identical 422 envelope. Fastify validates natively and diverges.
const TWO_PASS_INVALID_BODY: DivergenceExpectation['invalidBody'] = {
  status: 422,
  check: (json) => {
    expect(json['error']).toBe('Invalid request body')
    expect(Array.isArray(json['issues'])).toBe(true)
  },
}

const DIVERGENCE: Record<Framework, DivergenceExpectation> = {
  fastify: {
    invalidBody: {
      status: 400,
      check: (json) => {
        expect(json['code']).toBe('FST_ERR_VALIDATION')
      },
    },
    wrongContentType: {
      status: 400,
    },
  },
  hono: {
    invalidBody: TWO_PASS_INVALID_BODY,
    wrongContentType: {
      status: 415,
    },
  },
  express: {
    invalidBody: TWO_PASS_INVALID_BODY,
    wrongContentType: {
      status: 422,
    },
  },
}

// Minimal fetch helper to keep test bodies readable.
async function req(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{
  status: number
  contentType: string | null
  json: () => Promise<Record<string, unknown>>
  text: () => Promise<string>
}> {
  const opts: RequestInit = { method }
  const hdrs: Record<string, string> = headers ?? {}

  if (body !== undefined && !headers?.['content-type']) {
    hdrs['content-type'] = 'application/json'
  }

  if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  opts.headers = hdrs

  const res = await fetch(`${baseUrl}${path}`, opts)
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    json: () => res.json() as Promise<Record<string, unknown>>,
    text: () => res.text(),
  }
}

describe.each(['fastify', 'hono', 'express'] as const)('%s', (fw: Framework) => {
  let handle: ServerHandle

  beforeEach(async () => {
    handle = await startServer(fw)
  })

  afterEach(async () => {
    await handle.close()
  })

  // 1. POST /api/pets creates a pet with a string id and matching name/species
  it('POST /api/pets returns 201 with id, name, species', async () => {
    const res = await req(handle.baseUrl, 'POST', '/api/pets', { name: 'Buddy', species: 'dog' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(typeof body['id']).toBe('string')
    expect((body['id'] as string).length).toBeGreaterThan(0)
    expect(body['name']).toBe('Buddy')
    expect(body['species']).toBe('dog')
  })

  // 2. GET /api/pets returns an array containing all created pets (by id)
  it('GET /api/pets returns 200 with array containing created pets', async () => {
    const r1 = await req(handle.baseUrl, 'POST', '/api/pets', { name: 'Alpha', species: 'dog' })
    const p1 = await r1.json()
    const r2 = await req(handle.baseUrl, 'POST', '/api/pets', { name: 'Beta', species: 'cat' })
    const p2 = await r2.json()

    const listRes = await req(handle.baseUrl, 'GET', '/api/pets')
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as unknown as Array<Record<string, unknown>>
    const ids = list.map((p) => p['id'])
    expect(ids).toContain(p1['id'])
    expect(ids).toContain(p2['id'])
  })

  // 3. GET /api/pets?species=cat filters to only cats, including the cat we created
  it('GET /api/pets?species=cat returns only cats', async () => {
    const catRes = await req(handle.baseUrl, 'POST', '/api/pets', {
      name: 'Whiskers',
      species: 'cat',
    })
    const cat = await catRes.json()
    await req(handle.baseUrl, 'POST', '/api/pets', { name: 'Rex', species: 'dog' })

    const listRes = await req(handle.baseUrl, 'GET', '/api/pets?species=cat')
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as unknown as Array<Record<string, unknown>>
    expect(list.every((p) => p['species'] === 'cat')).toBe(true)
    expect(list.some((p) => p['id'] === cat['id'])).toBe(true)
  })

  // 4. GET /api/pets/:id returns the exact pet by id
  it('GET /api/pets/:id returns 200 with the correct pet', async () => {
    const createRes = await req(handle.baseUrl, 'POST', '/api/pets', {
      name: 'Spot',
      species: 'dog',
    })
    const created = await createRes.json()
    const id = created['id'] as string

    const getRes = await req(handle.baseUrl, 'GET', `/api/pets/${id}`)
    expect(getRes.status).toBe(200)
    const body = await getRes.json()
    expect(body['id']).toBe(id)
  })

  // 5. DELETE /api/pets/:id returns 204 with empty body
  it('DELETE /api/pets/:id returns 204 with empty body', async () => {
    const createRes = await req(handle.baseUrl, 'POST', '/api/pets', {
      name: 'Temp',
      species: 'bird',
    })
    const created = await createRes.json()
    const id = created['id'] as string

    const delRes = await req(handle.baseUrl, 'DELETE', `/api/pets/${id}`)
    expect(delRes.status).toBe(204)
    const body = await delRes.text()
    expect(body).toBe('')
  })

  // 6. Invalid body divergence: fastify returns 400 FST_ERR_VALIDATION,
  //    hono and express return 422 with error/issues
  it('POST /api/pets with invalid body returns framework-specific error', async () => {
    const expected = DIVERGENCE[fw].invalidBody
    const res = await req(handle.baseUrl, 'POST', '/api/pets', { name: '' })
    expect(res.status).toBe(expected.status)
    const body = await res.json()
    expected.check(body)
  })

  // 7. Wrong content-type divergence: fastify 400, hono 415, express 422
  it('POST /api/pets with wrong content-type returns framework-specific status', async () => {
    const expected = DIVERGENCE[fw].wrongContentType
    const res = await req(handle.baseUrl, 'POST', '/api/pets', '{"name":"Ghost","species":"cat"}', {
      'content-type': 'text/plain',
    })
    expect(res.status).toBe(expected.status)
  })

  // 8. Missing pet: all frameworks map an unknown id to 404 JSON carrying the not-found
  //    message. The body shape differs (fastify uses a structured envelope, hono and express
  //    a flat { error }), so we assert status + content-type + the message, not the shape.
  //    (Express previously returned 500 HTML because its getPet threw a plain Error; that was
  //    a real bug the harness surfaced, now fixed to HttpError(404) to match fastify and hono.)
  it('GET /api/pets/:id for a missing pet returns 404 JSON', async () => {
    const res = await req(handle.baseUrl, 'GET', '/api/pets/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    expect(res.contentType).toMatch(/json/)
    const body = await res.json()
    expect(String(body['error'])).toMatch(/not found/)
  })
})
