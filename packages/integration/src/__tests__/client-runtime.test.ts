/**
 * MSW runtime tests for the generated client.
 *
 * These tests verify correct HTTP behaviour at runtime — method, path, query
 * params, request headers, body serialisation, response parsing, and error
 * handling — things that `tsc --noEmit` cannot catch.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  ApiError,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  uploadTaskAttachment,
} from '../../generated/client.js'
import { configureClient } from '../../generated/client-config.js'
import { createServerClient } from '../../generated/server.js'
import type { Task, TaskPage } from '../../generated/models.js'

// ---------------------------------------------------------------------------
// MSW server — module-level, shared across all describe blocks
// ---------------------------------------------------------------------------

const BASE = 'https://api.test'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TASK: Task = {
  id: 'task-1',
  title: 'Buy milk',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00Z',
}

const TASK_PAGE: TaskPage = {
  items: [TASK],
  total: 1,
  page: 1,
  pageSize: 20,
}

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe('listTasks', () => {
  it('calls GET /api/v1/tasks with no params', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedRequest = request
        return HttpResponse.json(TASK_PAGE)
      })
    )

    await listTasks(undefined, { baseUrl: BASE })

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('GET')
    expect(new URL(capturedRequest!.url).pathname).toBe('/api/v1/tasks')
  })

  it('passes status, page, pageSize as query string params', async () => {
    let capturedUrl: URL | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(TASK_PAGE)
      })
    )

    await listTasks({ status: 'in_progress', page: 2, pageSize: 10 }, { baseUrl: BASE })

    expect(capturedUrl).toBeDefined()
    expect(capturedUrl!.searchParams.get('status')).toBe('in_progress')
    expect(capturedUrl!.searchParams.get('page')).toBe('2')
    expect(capturedUrl!.searchParams.get('pageSize')).toBe('10')
  })

  it('returns parsed TaskPage response', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks`, () => HttpResponse.json(TASK_PAGE)))

    const result = await listTasks(undefined, { baseUrl: BASE })

    expect(result).toEqual(TASK_PAGE)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(TASK)
  })

  it('omits query params that are undefined', async () => {
    let capturedUrl: URL | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json(TASK_PAGE)
      })
    )

    await listTasks({ status: undefined, page: 1 }, { baseUrl: BASE })

    expect(capturedUrl).toBeDefined()
    expect(capturedUrl!.searchParams.has('status')).toBe(false)
    expect(capturedUrl!.searchParams.get('page')).toBe('1')
  })
})

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('calls POST /api/v1/tasks', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.post(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedRequest = request
        return HttpResponse.json(TASK, { status: 201 })
      })
    )

    await createTask({ title: 'Buy milk' }, { baseUrl: BASE })

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('POST')
  })

  it('sends Content-Type: application/json', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.post(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedRequest = request
        return HttpResponse.json(TASK)
      })
    )

    await createTask({ title: 'Buy milk' }, { baseUrl: BASE })

    expect(capturedRequest!.headers.get('content-type')).toContain('application/json')
  })

  it('serializes body as JSON', async () => {
    let parsedBody: unknown

    server.use(
      http.post(`${BASE}/api/v1/tasks`, async ({ request }) => {
        parsedBody = await request.json()
        return HttpResponse.json(TASK)
      })
    )

    await createTask({ title: 'Buy milk', priority: 3 }, { baseUrl: BASE })

    expect(parsedBody).toEqual({ title: 'Buy milk', priority: 3 })
  })

  it('returns parsed Task response', async () => {
    server.use(http.post(`${BASE}/api/v1/tasks`, () => HttpResponse.json(TASK)))

    const result = await createTask({ title: 'Buy milk' }, { baseUrl: BASE })

    expect(result).toEqual(TASK)
  })
})

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

describe('getTask', () => {
  it('calls GET /api/v1/tasks/{id} with correct path', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedRequest = request
        return HttpResponse.json(TASK)
      })
    )

    await getTask('task-1', { baseUrl: BASE })

    expect(capturedRequest).toBeDefined()
    expect(new URL(capturedRequest!.url).pathname).toBe('/api/v1/tasks/task-1')
  })

  it('URL-encodes special characters in id', async () => {
    let capturedPathname: string | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedPathname = new URL(request.url).pathname
        return HttpResponse.json({ ...TASK, id: 'hello world' })
      })
    )

    await getTask('hello world', { baseUrl: BASE })

    expect(capturedPathname).toBe('/api/v1/tasks/hello%20world')
  })

  it('returns parsed Task', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(TASK)))

    const result = await getTask('task-1', { baseUrl: BASE })

    expect(result).toEqual(TASK)
  })
})

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('calls PATCH /api/v1/tasks/{id}', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.patch(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedRequest = request
        return HttpResponse.json({ ...TASK, title: 'Updated' })
      })
    )

    await updateTask('task-1', { title: 'Updated' }, { baseUrl: BASE })

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('PATCH')
  })

  it('sends JSON body', async () => {
    let parsedBody: unknown

    server.use(
      http.patch(`${BASE}/api/v1/tasks/:id`, async ({ request }) => {
        parsedBody = await request.json()
        return HttpResponse.json({ ...TASK, status: 'done' })
      })
    )

    await updateTask('task-1', { status: 'done' }, { baseUrl: BASE })

    expect(parsedBody).toEqual({ status: 'done' })
  })

  it('returns parsed Task', async () => {
    const updated = { ...TASK, title: 'Updated title' }

    server.use(http.patch(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(updated)))

    const result = await updateTask('task-1', { title: 'Updated title' }, { baseUrl: BASE })

    expect(result).toEqual(updated)
  })
})

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe('deleteTask', () => {
  it('calls DELETE /api/v1/tasks/{id}', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.delete(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedRequest = request
        return new HttpResponse(null, { status: 204 })
      })
    )

    await deleteTask('task-1', { baseUrl: BASE })

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('DELETE')
  })

  it('resolves with void on 204', async () => {
    server.use(
      http.delete(`${BASE}/api/v1/tasks/:id`, () => new HttpResponse(null, { status: 204 }))
    )

    const result = await deleteTask('task-1', { baseUrl: BASE })

    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  it('static token adds Authorization: Bearer <token> header', async () => {
    let capturedAuth: string | null = null

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json(TASK_PAGE)
      })
    )

    await listTasks(undefined, { baseUrl: BASE, token: 'my-static-token' })

    expect(capturedAuth).toBe('Bearer my-static-token')
  })

  it('async token function is resolved and added as header', async () => {
    let capturedAuth: string | null = null

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json(TASK_PAGE)
      })
    )

    const asyncToken = async () => 'resolved-async-token'
    await listTasks(undefined, { baseUrl: BASE, token: asyncToken })

    expect(capturedAuth).toBe('Bearer resolved-async-token')
  })

  it('no auth header when token is omitted', async () => {
    let capturedAuth: string | null = 'sentinel'

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json(TASK_PAGE)
      })
    )

    await listTasks(undefined, { baseUrl: BASE })

    expect(capturedAuth).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('404 response throws ApiError with status: 404 and parsed body', async () => {
    const errorBody = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Task not found',
    }

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(errorBody, { status: 404 }))
    )

    await expect(getTask('missing', { baseUrl: BASE })).rejects.toMatchObject({
      status: 404,
      body: errorBody,
    })
  })

  it('422 response throws ApiError with status: 422 and validation error body', async () => {
    const errorBody = {
      title: 'Unprocessable Entity',
      status: 422,
      errors: { title: ['must not be blank'] },
    }

    server.use(
      http.post(`${BASE}/api/v1/tasks`, () => HttpResponse.json(errorBody, { status: 422 }))
    )

    await expect(createTask({ title: '' }, { baseUrl: BASE })).rejects.toMatchObject({
      status: 422,
      body: errorBody,
    })
  })

  it('onError callback is called with the error before it is thrown', async () => {
    const onError = vi.fn()

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () =>
        HttpResponse.json({ title: 'Not Found' }, { status: 404 })
      )
    )

    await expect(getTask('missing', { baseUrl: BASE, onError })).rejects.toBeInstanceOf(ApiError)

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
  })

  it('error is still thrown after onError runs', async () => {
    const onError = vi.fn()
    let thrownError: unknown

    server.use(http.get(`${BASE}/api/v1/tasks/:id`, () => new HttpResponse(null, { status: 500 })))

    try {
      await getTask('any', { baseUrl: BASE, onError })
    } catch (err) {
      thrownError = err
    }

    expect(onError).toHaveBeenCalledOnce()
    expect(thrownError).toBeInstanceOf(ApiError)
    expect((thrownError as ApiError).status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// uploadTaskAttachment
// ---------------------------------------------------------------------------

describe('uploadTaskAttachment', () => {
  it('calls POST /api/v1/tasks/upload', async () => {
    let capturedRequest: Request | undefined

    server.use(
      http.post(`${BASE}/api/v1/tasks/upload`, ({ request }) => {
        capturedRequest = request
        return HttpResponse.json(TASK)
      })
    )

    await uploadTaskAttachment(
      { file: new Blob(['data'], { type: 'text/plain' }) },
      { baseUrl: BASE }
    )

    expect(capturedRequest).toBeDefined()
    expect(capturedRequest!.method).toBe('POST')
    expect(new URL(capturedRequest!.url).pathname).toBe('/api/v1/tasks/upload')
  })

  it('sends multipart/form-data (no manual Content-Type — fetch sets boundary)', async () => {
    let capturedContentType: string | null = null

    server.use(
      http.post(`${BASE}/api/v1/tasks/upload`, ({ request }) => {
        capturedContentType = request.headers.get('content-type')
        return HttpResponse.json(TASK)
      })
    )

    await uploadTaskAttachment({ file: new Blob(['data']) }, { baseUrl: BASE })

    // fetch sets multipart/form-data with boundary automatically — never application/json
    expect(capturedContentType).toContain('multipart/form-data')
    expect(capturedContentType).not.toContain('application/json')
  })

  it('includes file and optional label fields in the form body', async () => {
    let capturedFormData: FormData | undefined

    server.use(
      http.post(`${BASE}/api/v1/tasks/upload`, async ({ request }) => {
        capturedFormData = await request.formData()
        return HttpResponse.json(TASK)
      })
    )

    const file = new Blob(['file-content'], { type: 'image/png' })
    await uploadTaskAttachment({ file, label: 'screenshot' }, { baseUrl: BASE })

    expect(capturedFormData).toBeDefined()
    expect(capturedFormData!.get('file')).toBeInstanceOf(Blob)
    expect(capturedFormData!.get('label')).toBe('screenshot')
  })

  it('omits label field when not provided', async () => {
    let capturedFormData: FormData | undefined

    server.use(
      http.post(`${BASE}/api/v1/tasks/upload`, async ({ request }) => {
        capturedFormData = await request.formData()
        return HttpResponse.json(TASK)
      })
    )

    await uploadTaskAttachment({ file: new Blob(['data']) }, { baseUrl: BASE })

    expect(capturedFormData!.has('label')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// configureClient — global state path
// ---------------------------------------------------------------------------

describe('configureClient (global state)', () => {
  afterEach(() => {
    // Reset global config after each test to avoid state leak
    configureClient({ baseUrl: '', credentials: 'same-origin' })
  })

  it('functions use globally configured baseUrl without per-call config', async () => {
    let capturedPathname: string | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedPathname = new URL(request.url).pathname
        return HttpResponse.json(TASK_PAGE)
      })
    )

    configureClient({ baseUrl: BASE })
    await listTasks() // no per-call config

    expect(capturedPathname).toBe('/api/v1/tasks')
  })

  it('functions use globally configured token without per-call config', async () => {
    let capturedAuth: string | null = null

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json(TASK_PAGE)
      })
    )

    configureClient({ baseUrl: BASE, token: 'global-token' })
    await listTasks() // no per-call config

    expect(capturedAuth).toBe('Bearer global-token')
  })

  it('per-call config overrides global config', async () => {
    let capturedAuth: string | null = null

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json(TASK_PAGE)
      })
    )

    configureClient({ baseUrl: BASE, token: 'global-token' })
    await listTasks(undefined, { token: 'per-call-token' }) // override

    expect(capturedAuth).toBe('Bearer per-call-token')
  })
})

// ---------------------------------------------------------------------------
// createServerClient
// ---------------------------------------------------------------------------

describe('createServerClient', () => {
  it('pre-applied config (baseUrl + token) is used for all methods', async () => {
    let capturedAuth: string | null = null

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedAuth = request.headers.get('authorization')
        return HttpResponse.json(TASK_PAGE)
      })
    )

    const api = createServerClient({ baseUrl: BASE, token: 'server-token' })
    await api.listTasks()

    expect(capturedAuth).toBe('Bearer server-token')
  })

  it('listTasks() works without passing config per-call', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks`, () => HttpResponse.json(TASK_PAGE)))

    const api = createServerClient({ baseUrl: BASE })
    const result = await api.listTasks()

    expect(result).toEqual(TASK_PAGE)
  })

  it('getTask(id) uses pre-applied baseUrl', async () => {
    let capturedPathname: string | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedPathname = new URL(request.url).pathname
        return HttpResponse.json(TASK)
      })
    )

    const api = createServerClient({ baseUrl: BASE })
    await api.getTask('task-42')

    expect(capturedPathname).toBe('/api/v1/tasks/task-42')
  })
})
