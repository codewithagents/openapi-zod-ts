// @vitest-environment jsdom
/**
 * Runtime integration tests for the generated React Query hooks.
 *
 * Full stack: useXxx() → React Query → fetch function → MSW intercept → data assertion.
 * Uses renderHook + QueryClientProvider so each test exercises real React Query state.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import React from 'react'
import {
  useListTasks,
  useGetTask,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
} from '../../generated/hooks.js'
import { configureClient } from '../../generated/client-config.js'
import { ApiError } from '../../generated/client.js'
import type { Task, TaskPage } from '../../generated/models.js'

// ---------------------------------------------------------------------------
// Constants & fixtures
// ---------------------------------------------------------------------------

const BASE = 'https://hooks.test'

const TASK: Task = {
  id: 'task-1',
  title: 'Buy milk',
  status: 'pending',
  createdAt: '2026-01-01T00:00:00Z',
}

const TASK_2: Task = {
  id: 'task-2',
  title: 'Write tests',
  status: 'in_progress',
  createdAt: '2026-01-02T00:00:00Z',
}

const TASK_PAGE: TaskPage = {
  items: [TASK, TASK_2],
  total: 2,
  page: 1,
  pageSize: 20,
}

// ---------------------------------------------------------------------------
// MSW server — shared across all describe blocks
// ---------------------------------------------------------------------------

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ---------------------------------------------------------------------------
// QueryClient + wrapper factory
//
// A FRESH QueryClient is created per test to prevent stale-cache cross-test
// contamination. The wrapper is a React component that provides the client.
// ---------------------------------------------------------------------------

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Disable retries so errors surface immediately in tests
        retry: false,
        // staleTime: 0 ensures queries re-fetch when invalidated
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)

  return { wrapper, queryClient }
}

// ---------------------------------------------------------------------------
// Configure client before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  configureClient({ baseUrl: BASE })
})

// ---------------------------------------------------------------------------
// useListTasks
// ---------------------------------------------------------------------------

describe('useListTasks', () => {
  it('fetches and returns a task array', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks`, () => HttpResponse.json(TASK_PAGE)))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useListTasks(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(TASK_PAGE)
    expect(result.current.data?.items).toHaveLength(2)
    expect(result.current.data?.items[0]).toEqual(TASK)
  })

  it('passes query params to the request', async () => {
    let capturedUrl: URL | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        capturedUrl = new URL(request.url)
        return HttpResponse.json({ ...TASK_PAGE, items: [TASK] })
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useListTasks({ status: 'pending', page: 2, pageSize: 5 }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedUrl).toBeDefined()
    expect(capturedUrl!.searchParams.get('status')).toBe('pending')
    expect(capturedUrl!.searchParams.get('page')).toBe('2')
    expect(capturedUrl!.searchParams.get('pageSize')).toBe('5')
  })

  it('starts in loading state then transitions to success', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks`, () => HttpResponse.json(TASK_PAGE)))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useListTasks(), { wrapper })

    // Initially pending
    expect(result.current.isPending).toBe(true)
    expect(result.current.data).toBeUndefined()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.isPending).toBe(false)
    expect(result.current.data).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// useGetTask
// ---------------------------------------------------------------------------

describe('useGetTask', () => {
  it('fetches a single task by id', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(TASK)))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTask('task-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(TASK)
    expect(result.current.data?.id).toBe('task-1')
    expect(result.current.data?.title).toBe('Buy milk')
  })

  it('sends the correct path with the task id', async () => {
    let capturedPathname: string | undefined

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedPathname = new URL(request.url).pathname
        return HttpResponse.json(TASK_2)
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTask('task-2'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedPathname).toBe('/api/v1/tasks/task-2')
  })

  it('does not fetch when enabled: false (simulating null/disabled id)', async () => {
    let fetchCount = 0

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () => {
        fetchCount++
        return HttpResponse.json(TASK)
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTask('task-1', { enabled: false }), { wrapper })

    // Give a short moment for any erroneous fetch to occur
    await new Promise((r) => setTimeout(r, 50))

    expect(fetchCount).toBe(0)
    expect(result.current.isPending).toBe(true)
    expect(result.current.data).toBeUndefined()
    expect(result.current.isFetching).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// useCreateTask
// ---------------------------------------------------------------------------

describe('useCreateTask', () => {
  it('sends POST and resolves with created task on success', async () => {
    const newTask: Task = {
      id: 'task-3',
      title: 'New Task',
      status: 'pending',
      createdAt: '2026-01-03T00:00:00Z',
    }

    server.use(http.post(`${BASE}/api/v1/tasks`, () => HttpResponse.json(newTask, { status: 201 })))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCreateTask(), { wrapper })

    expect(result.current.isIdle).toBe(true)

    await act(async () => {
      result.current.mutate({ title: 'New Task' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(newTask)
    expect(result.current.data?.id).toBe('task-3')
    expect(result.current.data?.title).toBe('New Task')
  })

  it('sends correct JSON body in POST request', async () => {
    let parsedBody: unknown

    server.use(
      http.post(`${BASE}/api/v1/tasks`, async ({ request }) => {
        parsedBody = await request.json()
        return HttpResponse.json(TASK, { status: 201 })
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCreateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ title: 'Buy milk', priority: 2 })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(parsedBody).toEqual({ title: 'Buy milk', priority: 2 })
  })

  it('mutateAsync returns the created task', async () => {
    server.use(http.post(`${BASE}/api/v1/tasks`, () => HttpResponse.json(TASK, { status: 201 })))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCreateTask(), { wrapper })

    let createdTask: Task | undefined

    await act(async () => {
      createdTask = await result.current.mutateAsync({ title: 'Buy milk' })
    })

    expect(createdTask).toEqual(TASK)
  })
})

// ---------------------------------------------------------------------------
// useUpdateTask
// ---------------------------------------------------------------------------

describe('useUpdateTask', () => {
  it('sends PATCH and returns updated task', async () => {
    const updated: Task = { ...TASK, title: 'Buy oat milk', status: 'in_progress' }

    server.use(http.patch(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(updated)))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({
        id: 'task-1',
        body: { title: 'Buy oat milk', status: 'in_progress' },
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(updated)
    expect(result.current.data?.title).toBe('Buy oat milk')
  })

  it('sends correct JSON body and path for PATCH', async () => {
    let capturedPathname: string | undefined
    let parsedBody: unknown

    server.use(
      http.patch(`${BASE}/api/v1/tasks/:id`, async ({ request }) => {
        capturedPathname = new URL(request.url).pathname
        parsedBody = await request.json()
        return HttpResponse.json({ ...TASK, status: 'done' })
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'task-1', body: { status: 'done' } })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedPathname).toBe('/api/v1/tasks/task-1')
    expect(parsedBody).toEqual({ status: 'done' })
  })
})

// ---------------------------------------------------------------------------
// useDeleteTask
// ---------------------------------------------------------------------------

describe('useDeleteTask', () => {
  it('sends DELETE and resolves on 204', async () => {
    let capturedMethod: string | undefined

    server.use(
      http.delete(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedMethod = request.method
        return new HttpResponse(null, { status: 204 })
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteTask(), { wrapper })

    await act(async () => {
      result.current.mutate('task-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedMethod).toBe('DELETE')
    expect(result.current.data).toBeUndefined()
  })

  it('deletes the correct task id from the path', async () => {
    let capturedPathname: string | undefined

    server.use(
      http.delete(`${BASE}/api/v1/tasks/:id`, ({ request }) => {
        capturedPathname = new URL(request.url).pathname
        return new HttpResponse(null, { status: 204 })
      })
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useDeleteTask(), { wrapper })

    await act(async () => {
      result.current.mutate('task-99')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedPathname).toBe('/api/v1/tasks/task-99')
  })
})

// ---------------------------------------------------------------------------
// Error states
// ---------------------------------------------------------------------------

describe('error states', () => {
  it('useListTasks sets isError to true and error to ApiError on 500', async () => {
    server.use(http.get(`${BASE}/api/v1/tasks`, () => new HttpResponse(null, { status: 500 })))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useListTasks(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).status).toBe(500)
  })

  it('useGetTask sets isError on 404 with parsed body', async () => {
    const errorBody = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Task not found',
    }

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(errorBody, { status: 404 }))
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTask('missing'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(ApiError)
    const err = result.current.error as ApiError
    expect(err.status).toBe(404)
    expect(err.body).toEqual(errorBody)
  })

  it('useCreateTask mutation sets isError on 422', async () => {
    const errorBody = {
      title: 'Unprocessable Entity',
      status: 422,
      errors: { title: ['must not be blank'] },
    }

    server.use(
      http.post(`${BASE}/api/v1/tasks`, () => HttpResponse.json(errorBody, { status: 422 }))
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCreateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ title: '' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(ApiError)
    const err = result.current.error as ApiError
    expect(err.status).toBe(422)
    expect(err.body).toEqual(errorBody)
  })

  it('useUpdateTask mutation sets isError on 404', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/tasks/:id`, () =>
        HttpResponse.json({ title: 'Not Found', status: 404 }, { status: 404 })
      )
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpdateTask(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'missing', body: { title: 'x' } })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Query key invalidation
// ---------------------------------------------------------------------------

describe('query key invalidation', () => {
  it('invalidating tasks list causes useListTasks to re-fetch', async () => {
    let fetchCount = 0

    server.use(
      http.get(`${BASE}/api/v1/tasks`, () => {
        fetchCount++
        return HttpResponse.json(TASK_PAGE)
      })
    )

    const { wrapper, queryClient } = makeWrapper()
    const { result } = renderHook(() => useListTasks(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchCount).toBe(1)

    // Manually invalidate and verify re-fetch
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] })
    })

    await waitFor(() => expect(fetchCount).toBe(2))
    expect(result.current.data).toEqual(TASK_PAGE)
  })

  it('invalidating a specific task detail causes useGetTask to re-fetch', async () => {
    let fetchCount = 0

    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () => {
        fetchCount++
        return HttpResponse.json(TASK)
      })
    )

    const { wrapper, queryClient } = makeWrapper()
    const { result } = renderHook(() => useGetTask('task-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchCount).toBe(1)

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', 'task-1'] })
    })

    await waitFor(() => expect(fetchCount).toBe(2))
    expect(result.current.data).toEqual(TASK)
  })
})
