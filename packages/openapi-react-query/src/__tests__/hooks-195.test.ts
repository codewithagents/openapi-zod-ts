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

describe('#195 optimistic update scaffolding: optimisticUpdates option', () => {
  it('is off by default: no helpers, mutation hooks unchanged', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
    expect(content).not.toContain('OptimisticUpdate')
    expect(content).not.toContain('_withOptimisticUpdate')
    expect(content).not.toContain('useQueryClient')
  })

  it('emits the helpers once and imports QueryClient / QueryKey / useQueryClient', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, optimisticUpdates: true })
    expect(content.match(/export interface OptimisticUpdate</g)).toHaveLength(1)
    expect(content).toContain('export interface OptimisticContext<TContext>')
    expect(content.match(/function _withOptimisticUpdate</g)).toHaveLength(1)
    expect(content).toContain('useQueryClient, type QueryClient')
    // QueryKey is already imported for the paginated list's infinite hook.
    expect(content.match(/type QueryKey\b/g)).toHaveLength(1)
  })

  it('imports QueryKey for the helpers when no infinite hook needs it', () => {
    const { content } = generateHooks(spec, {
      staleTime: 0,
      gcTime: 0,
      optimisticUpdates: true,
      infiniteQuery: false,
    })
    expect(content).toContain('useQueryClient, type QueryClient, type QueryKey }')
  })

  it('helper follows cancel → snapshot → set, rollback on error, invalidate on settle', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, optimisticUpdates: true })
    const helper = block(content, 'function _withOptimisticUpdate<')
    const order = [
      'await queryClient.cancelQueries({ queryKey: key })',
      'previous = queryClient.getQueryData(key)',
      'queryClient.setQueryData<TQueryData>(key, (old) => optimistic.updater(old, variables))',
      'const context = await onMutate?.(variables, ...args)',
    ].map((snippet) => helper.indexOf(snippet))
    expect(order.every((i) => i > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(helper).toContain('queryClient.setQueryData(result.queryKey, result.previous)')
    expect(helper).toContain('queryClient.resetQueries({ queryKey: result.queryKey, exact: true })')
    expect(helper).toContain('return onError?.(error, variables, result?.context, ...args)')
    expect(helper).toContain('void queryClient.invalidateQueries({ queryKey: result.queryKey })')
    expect(helper).toContain('return onSettled?.(data, error, variables, result?.context, ...args)')
  })

  it('mutation hooks take TContext / TQueryData and route options through the helper', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, optimisticUpdates: true })
    const hook = block(content, 'export function useUpdateTask<')
    expect(hook).toContain(
      'export function useUpdateTask<TContext = unknown, TQueryData = unknown>('
    )
    expect(hook).toContain(
      'ApiError, { id: Parameters<typeof updateTask>[0]; body: Parameters<typeof updateTask>[1] }, TContext>'
    )
    expect(hook).toContain(
      '& { optimistic?: OptimisticUpdate<{ id: Parameters<typeof updateTask>[0]; body: Parameters<typeof updateTask>[1] }, TQueryData> },'
    )
    expect(hook).toContain('const mutationOptions = _withOptimisticUpdate(queryClient, options)')
    expect(hook).toContain('OptimisticContext<TContext>>({')
    expect(hook).toContain('    ...mutationOptions,')
    expect(hook).not.toContain('...options,')
  })

  it('composes with auto-invalidation: onSuccess calls the wrapped onSuccess', () => {
    const { content } = generateHooks(spec, {
      staleTime: 0,
      gcTime: 0,
      optimisticUpdates: true,
      autoInvalidate: true,
    })
    const hook = block(content, 'export function useUpdateTask<')
    expect(hook.match(/const queryClient = useQueryClient\(\)/g)).toHaveLength(1)
    expect(hook).toContain(
      'queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.id) })'
    )
    expect(hook).toContain('mutationOptions.onSuccess?.(...args)')
  })

  it('does not double-import QueryKey when infinite hooks already need it', () => {
    const withMutation = structuredClone(paginatedSpec)
    withMutation.paths!['/items']!.post = {
      operationId: 'createItem',
      responses: { '201': { description: 'ok' } },
    }
    const { content } = generateHooks(withMutation, {
      staleTime: 0,
      gcTime: 0,
      optimisticUpdates: true,
    })
    expect(content.match(/type QueryKey\b/g)).toHaveLength(1)
  })

  it('no mutations: no helpers emitted', () => {
    const { content } = generateHooks(paginatedSpec, {
      staleTime: 0,
      gcTime: 0,
      optimisticUpdates: true,
    })
    expect(content).not.toContain('_withOptimisticUpdate')
    expect(content).not.toContain('QueryClient')
  })
})
