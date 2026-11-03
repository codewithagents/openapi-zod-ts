import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateHooks } from '../plugins/hooks.js'

// Issue #195: typed select, typed errors, useXxxQueries, optimistic updates.

const spec = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../__fixtures__/specs/task-hooks.json'), 'utf-8')
) as OpenAPIV3_1.Document

function block(content: string, signature: string): string {
  const start = content.indexOf(signature)
  expect(start, `missing ${signature}`).toBeGreaterThan(-1)
  return content.slice(start, content.indexOf('\n}', start) + 2)
}

const paginatedSpec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Paged', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
}

describe('#195 typed select transforms: TData generic', () => {
  const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, suspense: true })

  it('query hook declares TData defaulting to the response type and threads it to useQuery', () => {
    const hook = block(content, 'export function useGetTask<')
    expect(hook).toContain(
      'export function useGetTask<TData = Awaited<ReturnType<typeof getTask>>>('
    )
    expect(hook).toContain(
      'options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof getTask>>, ApiError, TData>'
    )
    expect(hook).toContain(
      'return useQuery<Awaited<ReturnType<typeof getTask>>, ApiError, TData>({'
    )
  })

  it('queryOptions factory declares TData and threads it to queryOptions', () => {
    const factory = block(content, 'export function getTaskQueryOptions<')
    expect(factory).toContain('getTaskQueryOptions<TData = Awaited<ReturnType<typeof getTask>>>(')
    expect(factory).toContain(
      'return queryOptions<Awaited<ReturnType<typeof getTask>>, ApiError, TData>({'
    )
  })

  it('suspense hook declares TData and threads it to useSuspenseQuery', () => {
    const hook = block(content, 'export function useSuspenseGetTask<')
    expect(hook).toContain(
      'UseSuspenseQueryOptions<Awaited<ReturnType<typeof getTask>>, ApiError, TData>'
    )
    expect(hook).toContain(
      'return useSuspenseQuery<Awaited<ReturnType<typeof getTask>>, ApiError, TData>({'
    )
  })

  it('infinite hook declares TData defaulting to InfiniteData<response>', () => {
    const { content: paged } = generateHooks(paginatedSpec, { staleTime: 0, gcTime: 0 })
    const hook = block(paged, 'export function useListItemsInfinite<')
    expect(hook).toContain(
      'useListItemsInfinite<TData = InfiniteData<Awaited<ReturnType<typeof listItems>>>>('
    )
    expect(hook).toContain(
      'return useInfiniteQuery<Awaited<ReturnType<typeof listItems>>, ApiError, TData, QueryKey, unknown>({'
    )
  })

  it('mutation hooks are unchanged (no TData generic)', () => {
    expect(content).toContain('export function useCreateTask(')
  })
})

// task-hooks fixture plus documented error responses on getTask / createTask.
const errorSpec = structuredClone(spec)
errorSpec.paths!['/api/v1/tasks/{id}']!.get!.responses!['404'] = { description: 'missing' }
errorSpec.paths!['/api/v1/tasks']!.post!.responses!['422'] = { description: 'invalid' }

describe('#195 typed per-status errors: typedErrors option', () => {
  it('default (typedErrors off) keeps bare ApiError everywhere', () => {
    const { content } = generateHooks(errorSpec, { staleTime: 0, gcTime: 0 })
    expect(content).not.toMatch(/\bGetTaskError\b/)
    expect(content).toContain(', type ApiError } from')
  })

  it('types query, factory and mutation hooks with the per-operation alias', () => {
    const { content } = generateHooks(errorSpec, {
      staleTime: 0,
      gcTime: 0,
      suspense: true,
      typedErrors: true,
    })
    expect(content).toMatch(/type ApiError, type CreateTaskError, type GetTaskError/)
    expect(block(content, 'export function useGetTask<')).toContain(
      'return useQuery<Awaited<ReturnType<typeof getTask>>, GetTaskError, TData>({'
    )
    expect(block(content, 'export function getTaskQueryOptions<')).toContain(
      'queryOptions<Awaited<ReturnType<typeof getTask>>, GetTaskError, TData>'
    )
    expect(block(content, 'export function useSuspenseGetTask<')).toContain(
      'useSuspenseQuery<Awaited<ReturnType<typeof getTask>>, GetTaskError, TData>'
    )
    expect(block(content, 'export function useCreateTask(')).toContain(
      'useMutation<Awaited<ReturnType<typeof createTask>>, CreateTaskError,'
    )
  })

  it('operations without documented error statuses keep ApiError', () => {
    const { content } = generateHooks(errorSpec, { staleTime: 0, gcTime: 0, typedErrors: true })
    expect(block(content, 'export function useListTasks<')).toContain(
      'useQuery<Awaited<ReturnType<typeof listTasks>>, ApiError, TData>'
    )
  })

  it('infinite hooks use the alias too', () => {
    const errSpec = structuredClone(paginatedSpec)
    errSpec.paths!['/items']!.get!.responses = {
      '200': { description: 'ok' },
      '429': { description: 'slow down' },
    }
    const { content } = generateHooks(errSpec, { staleTime: 0, gcTime: 0, typedErrors: true })
    expect(block(content, 'export function useListItemsInfinite<')).toContain(
      'useInfiniteQuery<Awaited<ReturnType<typeof listItems>>, ListItemsError, TData, QueryKey, unknown>'
    )
  })
})
