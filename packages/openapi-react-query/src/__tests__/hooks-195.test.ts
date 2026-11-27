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

/** The specifiers of the generated file's `@tanstack/react-query` import statement. */
function reactQueryImports(content: string): string[] {
  const match = /import\s*\{([^}]*)\}\s*from\s*'@tanstack\/react-query'/.exec(content)
  if (!match) throw new Error('missing @tanstack/react-query import')
  return (match[1] ?? '')
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier !== '')
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
    const factory = block(content, 'function _getTaskQueryOptions<')
    expect(factory).toContain('_getTaskQueryOptions<TData = Awaited<ReturnType<typeof getTask>>>(')
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

// `ReturnType<typeof useX>` reads a function's LAST overload with type parameters erased to
// `unknown`: the pre-TData signature must trail the generic one, or consumers lose the data type.
describe('#195 ReturnType of generated functions: non-generic signature last', () => {
  const dataType = 'Awaited<ReturnType<typeof getTask>>'

  /** Start index of every `export function <name>` declaration, in file order. */
  function declarations(content: string, name: string): string[] {
    const starts = [...content.matchAll(new RegExp(`export function ${name}\\b`, 'g'))].map(
      (m) => m.index
    )
    return starts.map((start, i) => content.slice(start, starts[i + 1] ?? content.length))
  }

  it('query hook: generic overload, default overload, then the generic implementation', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
    const [generic, defaulted, implementation] = declarations(content, 'useGetTask')
    expect(declarations(content, 'useGetTask')).toHaveLength(3)
    expect(generic).toContain(`export function useGetTask<TData = ${dataType}>(`)
    expect(generic).toContain(`): UseQueryResult<NoInfer<TData>, ApiError>\n`)
    expect(defaulted).toContain('export function useGetTask(\n')
    expect(defaulted).toContain(
      `UseQueryOptions<${dataType}, ApiError, ${dataType}>, 'queryKey' | 'queryFn'>`
    )
    expect(defaulted).toContain(`): UseQueryResult<${dataType}, ApiError>\n`)
    expect(implementation).toContain(`export function useGetTask<TData = ${dataType}>(`)
    expect(implementation).toContain('return useQuery<')
    expect(generic).not.toContain('return useQuery')
    expect(defaulted).not.toContain('return useQuery')
  })

  it('suspense hook trails with UseSuspenseQueryResult at the default type', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, suspense: true })
    const [generic, defaulted] = declarations(content, 'useSuspenseGetTask')
    expect(declarations(content, 'useSuspenseGetTask')).toHaveLength(3)
    expect(generic).toContain('): UseSuspenseQueryResult<NoInfer<TData>, ApiError>\n')
    expect(defaulted).toContain(`): UseSuspenseQueryResult<${dataType}, ApiError>\n`)
    expect(content).toContain('type UseSuspenseQueryResult')
  })

  it('infinite hook trails with UseInfiniteQueryResult<InfiniteData<response>>', () => {
    const { content } = generateHooks(paginatedSpec, { staleTime: 0, gcTime: 0 })
    const [generic, defaulted] = declarations(content, 'useListItemsInfinite')
    const data = 'Awaited<ReturnType<typeof listItems>>'
    expect(declarations(content, 'useListItemsInfinite')).toHaveLength(3)
    expect(generic).toContain('): UseInfiniteQueryResult<NoInfer<TData>, ApiError>\n')
    expect(defaulted).toContain(`ApiError, InfiniteData<${data}>, QueryKey, unknown>`)
    expect(defaulted).toContain(`): UseInfiniteQueryResult<InfiniteData<${data}>, ApiError>\n`)
    expect(content).toContain('type UseInfiniteQueryResult')
  })

  it('useXxxQueries trails with the default combined result', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, queries: true })
    const result = `UseQueryResult<${dataType}, ApiError>[]`
    const [generic, defaulted] = declarations(content, 'useGetTaskQueries')
    expect(declarations(content, 'useGetTaskQueries')).toHaveLength(3)
    expect(generic).toContain(`useGetTaskQueries<TCombinedResult = ${result}>(`)
    expect(generic).toContain('): NoInfer<TCombinedResult>\n')
    expect(defaulted).toContain(`combine?: (results: ${result}) => ${result},\n): ${result}\n`)
  })

  it('queryOptions factory: generic overload, default overload, then an implementation delegating to the private generic function', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
    expect(content).toContain(`\nfunction _getTaskQueryOptions<TData = ${dataType}>(`)
    const [generic, defaulted, implementation] = declarations(content, 'getTaskQueryOptions')
    expect(declarations(content, 'getTaskQueryOptions')).toHaveLength(3)
    expect(generic).toContain(`export function getTaskQueryOptions<TData = ${dataType}>(`)
    expect(generic).toContain('): ReturnType<typeof _getTaskQueryOptions<NoInfer<TData>>>\n')
    expect(defaulted).toContain('export function getTaskQueryOptions(\n')
    expect(defaulted).toContain(
      `UseQueryOptions<${dataType}, ApiError, ${dataType}>, 'queryKey' | 'queryFn'>`
    )
    expect(defaulted).toContain(`): ReturnType<typeof _getTaskQueryOptions<${dataType}>>\n`)
    expect(implementation).toContain(`export function getTaskQueryOptions<TData = ${dataType}>(`)
    expect(implementation).toContain('return _getTaskQueryOptions(id, options)')
    expect(content).not.toContain('export const getTaskQueryOptions')
  })

  // A result annotation is an inference site for the type parameter unless the generic signature
  // returns it under `NoInfer`: `const r: UseQueryResult<string, E> = useX()` would compile, with
  // `data` really being the response type. The options parameter keeps the bare type parameter,
  // which is what infers `TData` from `select`; the default signature is not generic.
  describe('NoInfer on the result of the generic signature only', () => {
    const cases: Array<{ name: string; hook: string; generated: () => string }> = [
      {
        name: 'query hook',
        hook: 'useGetTask',
        generated: () => generateHooks(spec, { staleTime: 0, gcTime: 0 }).content,
      },
      {
        name: 'suspense hook',
        hook: 'useSuspenseGetTask',
        generated: () => generateHooks(spec, { staleTime: 0, gcTime: 0, suspense: true }).content,
      },
      {
        name: 'infinite hook',
        hook: 'useListItemsInfinite',
        generated: () => generateHooks(paginatedSpec, { staleTime: 0, gcTime: 0 }).content,
      },
      {
        name: 'queries hook',
        hook: 'useGetTaskQueries',
        generated: () => generateHooks(spec, { staleTime: 0, gcTime: 0, queries: true }).content,
      },
      {
        name: 'queryOptions factory',
        hook: 'getTaskQueryOptions',
        generated: () => generateHooks(spec, { staleTime: 0, gcTime: 0 }).content,
      },
    ]

    it.each(cases)('$name', ({ hook, generated }) => {
      const [generic, defaulted, implementation] = declarations(generated(), hook)
      const [signature = '', result = ''] = generic!.split('\n): ')
      expect(result.split('\n')[0]).toMatch(/^(.+<)?NoInfer<T(Data|CombinedResult)>(>*|, \w+>)$/)
      expect(signature).not.toContain('NoInfer')
      expect(defaulted).not.toContain('NoInfer')
      expect(implementation!.split('\n}\n')[0]).not.toContain('NoInfer')
    })
  })

  it('typed errors flow into the trailing signatures', () => {
    const { content } = generateHooks(errorSpec, {
      staleTime: 0,
      gcTime: 0,
      suspense: true,
      typedErrors: true,
    })
    const [, defaulted] = declarations(content, 'useGetTask')
    expect(defaulted).toContain(`): UseQueryResult<${dataType}, GetTaskError>\n`)
    const [, suspenseDefaulted] = declarations(content, 'useSuspenseGetTask')
    expect(suspenseDefaulted).toContain(`): UseSuspenseQueryResult<${dataType}, GetTaskError>\n`)
  })

  // TypeScript reports a symbol as deprecated (at the import, at a bare reference) only when
  // EVERY declaration carries the tag, so the implementation signature needs it as well.
  describe('@deprecated on every declaration of a deprecated operation', () => {
    const deprecated = structuredClone(spec)
    deprecated.paths!['/api/v1/tasks/{id}']!.get!.deprecated = true
    const { content } = generateHooks(deprecated, {
      staleTime: 0,
      gcTime: 0,
      suspense: true,
      queries: true,
    })
    const deprecatedPaginated = structuredClone(paginatedSpec)
    deprecatedPaginated.paths!['/items']!.get!.deprecated = true
    const { content: paginated } = generateHooks(deprecatedPaginated, { staleTime: 0, gcTime: 0 })

    function tagged(source: string, name: string): number {
      const tag = new RegExp(`/\\*\\* @deprecated \\*/\nexport function ${name}\\b`, 'g')
      return source.match(tag)?.length ?? 0
    }

    it.each([
      ['useGetTask', content],
      ['useSuspenseGetTask', content],
      ['useGetTaskQueries', content],
      ['getTaskQueryOptions', content],
      ['useListItemsInfinite', paginated],
      ['listItemsQueryOptions', paginated],
    ])('%s: all three declarations carry the tag', (name, source) => {
      expect(declarations(source, name)).toHaveLength(3)
      expect(tagged(source, name)).toBe(3)
    })

    it('leaves operations that are not deprecated, and the private factory function, untagged', () => {
      expect(declarations(content, 'useListTasks')).toHaveLength(3)
      expect(tagged(content, 'useListTasks')).toBe(0)
      expect(tagged(content, 'getTaskQueryOptions')).toBe(3)
      expect(content).not.toContain('/** @deprecated */\nfunction _getTaskQueryOptions')
    })
  })

  it('mutation hooks keep a single declaration', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0 })
    expect(declarations(content, 'useCreateTask')).toHaveLength(1)
  })

  it('imports the result types only for the hook kinds that exist', () => {
    const { content: plain } = generateHooks(spec, {
      staleTime: 0,
      gcTime: 0,
      infiniteQuery: false,
    })
    expect(plain).toContain('type UseQueryResult')
    expect(plain).not.toContain('UseSuspenseQueryResult')
    expect(plain).not.toContain('UseInfiniteQueryResult')
    expect(plain.match(/type UseQueryResult/g)).toHaveLength(1)
    const { content: queries } = generateHooks(spec, { staleTime: 0, gcTime: 0, queries: true })
    expect(queries.match(/type UseQueryResult/g)).toHaveLength(1)
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
    expect(block(content, 'function _getTaskQueryOptions<')).toContain(
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
    expect(reactQueryImports(content)).not.toContain('useQueries')
    expect(content).not.toMatch(/export function use\w*Queries\b/)
  })

  it('single-argument op: paramsList holds bare ids, mapped through the factory', () => {
    const { content } = generateHooks(spec, { staleTime: 0, gcTime: 0, queries: true })
    expect(reactQueryImports(content)).toContain('useQueries')
    expect(reactQueryImports(content)).toContain('type UseQueryResult')
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
