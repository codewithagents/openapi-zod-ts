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

describe('#195 useXxxQueries: queries option', () => {
  const multiSpec: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Multi', version: '1.0.0' },
    paths: {
      '/orgs/{org}/repos/{repo}': {
        get: {
          operationId: 'getRepo',
          parameters: [
            { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'repo', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'ref', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/health': { get: { operationId: 'health', responses: { '200': { description: 'ok' } } } },
      // Its own hook is useGetRepoQueries: the generated wrapper must not collide.
      '/repo-queries': {
        get: { operationId: 'getRepoQueries', responses: { '200': { description: 'ok' } } },
      },
    },
  }

  it('is off by default: no useQueries import, no *Queries hooks', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
    expect(content).not.toContain('useQueries')
    expect(content).not.toContain('UseQueryResult')
  })

  it('single-argument op: paramsList holds bare ids, mapped through the factory', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, queries: true })
    expect(content).toContain('useQueries, type UseQueryResult')
    const hook = block(content, 'export function useGetTaskQueries<')
    expect(hook).toContain(
      'TCombinedResult = UseQueryResult<Awaited<ReturnType<typeof getTask>>, ApiError>[]'
    )
    expect(hook).toContain('paramsList: ReadonlyArray<Parameters<typeof getTask>[0]>,')
    expect(hook).toContain(
      'combine?: (results: UseQueryResult<Awaited<ReturnType<typeof getTask>>, ApiError>[]) => TCombinedResult,'
    )
    expect(hook).toContain('queries: paramsList.map((id) => getTaskQueryOptions(id, options)),')
    expect(hook).toContain('    combine,')
  })

  it('list op with optional params: entries are the params object', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, queries: true })
    const hook = block(content, 'export function useListTasksQueries<')
    expect(hook).toContain('paramsList: ReadonlyArray<Parameters<typeof listTasks>[0]>,')
    expect(hook).toContain('paramsList.map((params) => listTasksQueryOptions(params, options))')
  })

  it('multi-argument op: entries are labeled tuples (required params not optional)', () => {
    const { content } = generateHooks(multiSpec, { staleTime: 0, gcTime: 0, queries: true })
    const hook = block(content, 'export function useGetRepoQueries_2<')
    expect(hook).toContain(
      'ReadonlyArray<readonly [org: Parameters<typeof getRepo>[0], repo: Parameters<typeof getRepo>[1], params: Parameters<typeof getRepo>[2]]>'
    )
    expect(hook).toContain(
      'paramsList.map(([org, repo, params]) => getRepoQueryOptions(org, repo, params, options))'
    )
  })

  it('optional query params are optional tuple members', () => {
    const optional = structuredClone(multiSpec)
    const params = optional.paths!['/orgs/{org}/repos/{repo}']!.get!.parameters!
    ;(params[2] as OpenAPIV3_1.ParameterObject).required = false
    const { content } = generateHooks(optional, { staleTime: 0, gcTime: 0, queries: true })
    expect(content).toContain('params?: Parameters<typeof getRepo>[2]]')
  })

  it('skips operations without parameters', () => {
    const { content } = generateHooks(multiSpec, { staleTime: 0, gcTime: 0, queries: true })
    expect(content).not.toContain('useHealthQueries')
  })

  it('uses the typed error alias when typedErrors is on, and keeps @deprecated', () => {
    const deprecated = structuredClone(errorSpec)
    deprecated.paths!['/api/v1/tasks/{id}']!.get!.deprecated = true
    const { content } = generateHooks(deprecated, {
      staleTime: 0,
      gcTime: 0,
      queries: true,
      typedErrors: true,
    })
    expect(content).toContain('/** @deprecated */\nexport function useGetTaskQueries<')
    expect(block(content, 'export function useGetTaskQueries<')).toContain(
      'UseQueryResult<Awaited<ReturnType<typeof getTask>>, GetTaskError>[]'
    )
  })
})
