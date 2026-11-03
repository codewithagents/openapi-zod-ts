// @vitest-environment jsdom
/**
 * Runtime tests for the opt-in hooks in generated-hooks-extended/ (#195):
 * typed_errors, queries (useXxxQueries) and optimistic_updates.
 *
 * Full stack: hook → React Query → generated client → MSW intercept.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import React from 'react'
import {
  useGetTask,
  useGetTaskQueries,
  useListTasksQueries,
  useUpdateTask,
  useDeleteTask,
  taskKeys,
} from '../../generated-hooks-extended/hooks.js'
import { configureClient } from '../../generated/client-config.js'
import { ApiError } from '../../generated/client.js'
import type { Task, TaskPage } from '../../generated/models.js'

const BASE = 'https://hooks-extended.test'

function task(id: string, title = `Task ${id}`): Task {
  return { id, title, status: 'pending', createdAt: '2026-01-01T00:00:00Z' }
}

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => configureClient({ baseUrl: BASE }))

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { wrapper, queryClient }
}

// ---------------------------------------------------------------------------
// typed_errors
// ---------------------------------------------------------------------------

describe('typed_errors: useGetTask', () => {
  it('surfaces the documented 404 as ApiError with the typed body', async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () =>
        HttpResponse.json({ title: 'Not Found', status: 404 }, { status: 404 })
      )
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTask('missing'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const error = result.current.error!
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(404)
    expect(error.body.title).toBe('Not Found')
  })
})

// ---------------------------------------------------------------------------
// queries: useXxxQueries
// ---------------------------------------------------------------------------

describe('queries: useGetTaskQueries', () => {
  it('runs one query per id, in order, under the canonical detail keys', async () => {
    const requested: string[] = []
    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, ({ params }) => {
        requested.push(String(params['id']))
        return HttpResponse.json(task(String(params['id'])))
      })
    )
    const { wrapper, queryClient } = makeWrapper()
    const { result } = renderHook(() => useGetTaskQueries(['a', 'b', 'c']), { wrapper })

    await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true))
    expect(result.current.map((r) => r.data?.id)).toEqual(['a', 'b', 'c'])
    expect(requested.sort()).toEqual(['a', 'b', 'c'])
    // Same cache entries as the single-query hook / queryOptions factory.
    expect(queryClient.getQueryData<Task>(taskKeys.detail('b'))?.id).toBe('b')
  })

  it('applies shared options to every query (enabled: false fetches nothing)', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, () => {
        calls++
        return HttpResponse.json(task('x'))
      })
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTaskQueries(['a', 'b'], { enabled: false }), {
      wrapper,
    })
    expect(result.current).toHaveLength(2)
    expect(result.current.every((r) => r.fetchStatus === 'idle')).toBe(true)
    expect(calls).toBe(0)
  })

  it('combine reduces the results', async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks/:id`, ({ params }) =>
        HttpResponse.json(task(String(params['id']), `T-${String(params['id'])}`))
      )
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () =>
        useGetTaskQueries(['1', '2'], undefined, (results) => ({
          pending: results.some((r) => r.isPending),
          titles: results.map((r) => r.data?.title),
        })),
      { wrapper }
    )
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.titles).toEqual(['T-1', 'T-2'])
  })

  it('an empty list yields no queries', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useGetTaskQueries([]), { wrapper })
    expect(result.current).toEqual([])
  })
})

describe('queries: useListTasksQueries', () => {
  it('runs one list query per params object', async () => {
    server.use(
      http.get(`${BASE}/api/v1/tasks`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        const body: TaskPage = { items: [task(`p${page}`)], total: 2, page, pageSize: 1 }
        return HttpResponse.json(body)
      })
    )
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useListTasksQueries([{ page: 1 }, { page: 2 }]), {
      wrapper,
    })
    await waitFor(() => expect(result.current.every((r) => r.isSuccess)).toBe(true))
    expect(result.current.map((r) => r.data?.page)).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// optimistic_updates
// ---------------------------------------------------------------------------

/** A PATCH handler that blocks until `release()` so the optimistic state is observable. */
function gatedPatch(respond: () => Response) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  server.use(
    http.patch(`${BASE}/api/v1/tasks/:id`, async () => {
      await gate
      return respond()
    })
  )
  return { release }
}

const renameOptimistically = {
  queryKey: (vars: { id: string }) => taskKeys.detail(vars.id),
  updater: (old: Task | undefined, vars: { body: { title?: string } }) =>
    old && { ...old, title: vars.body.title ?? old.title },
}

describe('optimistic_updates: useUpdateTask', () => {
  it('applies the update before the request resolves, then invalidates the key', async () => {
    const saved = task('a', 'Saved')
    const { release } = gatedPatch(() => HttpResponse.json(saved))
    const { wrapper, queryClient } = makeWrapper()
    queryClient.setQueryData(taskKeys.detail('a'), task('a', 'Old'))
    const cancel = vi.spyOn(queryClient, 'cancelQueries')

    const { result } = renderHook(() => useUpdateTask({ optimistic: renameOptimistically }), {
      wrapper,
    })
    act(() => result.current.mutate({ id: 'a', body: { title: 'Optimistic' } }))

    await waitFor(() =>
      expect(queryClient.getQueryData<Task>(taskKeys.detail('a'))?.title).toBe('Optimistic')
    )
    expect(cancel).toHaveBeenCalledWith({ queryKey: taskKeys.detail('a') })
    release()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(saved)
    expect(queryClient.getQueryState(taskKeys.detail('a'))?.isInvalidated).toBe(true)
  })

  it('rolls back to the snapshot on error', async () => {
    const { release } = gatedPatch(() =>
      HttpResponse.json({ errors: { title: ['too long'] } }, { status: 422 })
    )
    const { wrapper, queryClient } = makeWrapper()
    queryClient.setQueryData(taskKeys.detail('a'), task('a', 'Old'))

    const { result } = renderHook(() => useUpdateTask({ optimistic: renameOptimistically }), {
      wrapper,
    })
    act(() => result.current.mutate({ id: 'a', body: { title: 'Optimistic' } }))
    await waitFor(() =>
      expect(queryClient.getQueryData<Task>(taskKeys.detail('a'))?.title).toBe('Optimistic')
    )
    release()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.status).toBe(422)
    expect(queryClient.getQueryData<Task>(taskKeys.detail('a'))?.title).toBe('Old')
  })

  it('resets an entry that was not cached before the optimistic update', async () => {
    const { release } = gatedPatch(() => HttpResponse.json({ errors: {} }, { status: 422 }))
    const { wrapper, queryClient } = makeWrapper()

    const { result } = renderHook(
      () =>
        useUpdateTask({
          optimistic: {
            queryKey: taskKeys.detail('new'),
            updater: (_old: Task | undefined) => task('new', 'Created optimistically'),
          },
        }),
      { wrapper }
    )
    act(() => result.current.mutate({ id: 'new', body: {} }))
    await waitFor(() => expect(queryClient.getQueryData(taskKeys.detail('new'))).toBeDefined())
    release()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(queryClient.getQueryData(taskKeys.detail('new'))).toBeUndefined()
  })

  it("composes with the caller's onMutate / onSuccess / onSettled and passes their context", async () => {
    server.use(http.patch(`${BASE}/api/v1/tasks/:id`, () => HttpResponse.json(task('a'))))
    const { wrapper, queryClient } = makeWrapper()
    queryClient.setQueryData(taskKeys.detail('a'), task('a', 'Old'))
    const calls: string[] = []

    const { result } = renderHook(
      () =>
        useUpdateTask({
          optimistic: renameOptimistically,
          onMutate: (vars) => {
            // Runs after the optimistic write.
            const title = queryClient.getQueryData<Task>(taskKeys.detail(vars.id))?.title
            calls.push(`mutate:${title}`)
            return { token: 42 }
          },
          onSuccess: (_data, _vars, context) => calls.push(`success:${context.token}`),
          onSettled: (_data, _error, _vars, context) => calls.push(`settled:${context?.token}`),
        }),
      { wrapper }
    )
    await act(() => result.current.mutateAsync({ id: 'a', body: { title: 'New' } }))
    expect(calls).toEqual(['mutate:New', 'success:42', 'settled:42'])
  })

  it("passes the caller's context to onError after rolling back", async () => {
    server.use(
      http.patch(`${BASE}/api/v1/tasks/:id`, () =>
        HttpResponse.json({ errors: {} }, { status: 422 })
      )
    )
    const { wrapper, queryClient } = makeWrapper()
    queryClient.setQueryData(taskKeys.detail('a'), task('a', 'Old'))
    let seen: { title: string | undefined; token: string | undefined } | undefined

    const { result } = renderHook(
      () =>
        useUpdateTask({
          optimistic: renameOptimistically,
          onMutate: () => 'ctx',
          onError: (_error, vars, context) => {
            const title = queryClient.getQueryData<Task>(taskKeys.detail(vars.id))?.title
            seen = { title, token: context }
          },
        }),
      { wrapper }
    )
    act(() => result.current.mutate({ id: 'a', body: { title: 'New' } }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(seen).toEqual({ title: 'Old', token: 'ctx' })
  })

  it('without an optimistic option it behaves like a plain mutation', async () => {
    server.use(
      http.delete(`${BASE}/api/v1/tasks/:id`, () => new HttpResponse(null, { status: 204 }))
    )
    const { wrapper, queryClient } = makeWrapper()
    queryClient.setQueryData(taskKeys.detail('a'), task('a'))
    const onSettled = vi.fn()

    const { result } = renderHook(() => useDeleteTask({ onSettled }), { wrapper })
    await act(() => result.current.mutateAsync('a'))
    expect(onSettled).toHaveBeenCalledOnce()
    expect(onSettled.mock.calls[0]![3]).toBeUndefined()
    // Untouched by the optimistic machinery (auto_invalidate still marks it stale).
    expect(queryClient.getQueryData<Task>(taskKeys.detail('a'))?.id).toBe('a')
  })
})
