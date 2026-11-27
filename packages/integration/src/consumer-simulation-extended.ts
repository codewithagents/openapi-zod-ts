// fallow-ignore-file unused-file
// Type-only consumer simulation for the opt-in hooks in generated-hooks-extended/
// (suspense, auto_invalidate, typed_errors, queries, optimistic_updates). Never called at
// runtime; tsc --noEmit exercises these patterns on every `pnpm lint` run in CI.

import type {
  InfiniteData,
  QueryKey,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import type {
  ProblemDetail,
  Task,
  TaskPage,
  UpdateTaskRequest,
  ValidationProblem,
} from '../generated/models.js'
import {
  getTask,
  listTasks,
  listUserTasks,
  type ApiError,
  type GetTaskError,
  type ListTasksError,
  type ListUserTasksError,
} from '../generated/client.js'
import {
  getTaskQueryOptions,
  taskKeys,
  useGetTask,
  useGetTaskQueries,
  useListTasks,
  useListTasksInfinite,
  useListTasksQueries,
  useListUserTasksQueries,
  useCreateTask,
  useSuspenseGetTask,
  useSuspenseListTasks,
  useUpdateTask,
  useUploadTaskAttachment,
} from '../generated-hooks-extended/hooks.js'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | undefined {
  return undefined
}

// ── typed_errors (#195) ──────────────────────────────────────────────────────

// Pattern E1: a query hook's error is the per-operation alias; status narrows body.
function _useGetTaskTypedError() {
  const { error } = useGetTask('id')
  if (error) {
    assertType<Equal<typeof error.status, 404>>()
    assertType<Equal<typeof error.body, ProblemDetail>>()
  }
}

// Pattern E2: a mutation's onError receives the alias; `status === 422` narrows.
function _useCreateTaskTypedError() {
  return useCreateTask({
    onError: (error) => {
      if (error.status === 422) {
        assertType<Equal<typeof error.body, ValidationProblem>>()
      }
    },
  })
}

// Pattern E3: operations without documented error statuses keep bare ApiError.
function _useUploadTaskAttachmentPlainError() {
  return useUploadTaskAttachment({
    onError: (error) => {
      assertType<Equal<typeof error, ApiError>>()
    },
  })
}

// Pattern E4: every query hook kind of an operation with a documented status takes its alias,
// the infinite hook included.
function _useListTasksTypedError() {
  const { error } = useListTasks()
  assertType<Equal<typeof error, ListTasksError | null>>()
  const infinite = useListTasksInfinite()
  assertType<Equal<typeof infinite.error, ListTasksError | null>>()
  if (infinite.error) {
    assertType<Equal<typeof infinite.error.status, 400>>()
    assertType<Equal<typeof infinite.error.body, ProblemDetail>>()
  }
}

// ── queries (#195) ───────────────────────────────────────────────────────────

// Pattern Q1: one result per id, typed with the operation's data + error types.
function _useGetTaskQueriesResults(ids: string[]) {
  const results = useGetTaskQueries(ids, { staleTime: 1000 })
  const first = results[0]
  if (first) {
    assertType<Equal<typeof first.data, Task | undefined>>()
    if (first.error) assertType<Equal<typeof first.error.status, 404>>()
  }
  return results
}

// Pattern Q2: combine determines the return type.
function _useGetTaskQueriesCombine(ids: readonly string[]) {
  const titles = useGetTaskQueries(ids, undefined, (results) =>
    results.flatMap((r) => (r.data ? [r.data.title] : []))
  )
  assertType<Equal<typeof titles, string[]>>()
  return titles
}

// ── optimistic_updates (#195) ────────────────────────────────────────────────

// Pattern O1: updater params are typed from the variables; the caller's onMutate
// result flows to onSuccess / onError as their context.
function _useUpdateTaskOptimistic() {
  return useUpdateTask({
    optimistic: {
      queryKey: (vars) => taskKeys.detail(vars.id),
      updater: (old: Task | undefined, vars) => {
        assertType<Equal<typeof vars.body, UpdateTaskRequest>>()
        return old && { ...old, ...vars.body, description: old.description }
      },
    },
    onMutate: () => ({ startedAt: 0 }),
    onSuccess: (_data, _vars, context) => {
      assertType<Equal<typeof context, { startedAt: number }>>()
    },
    onError: (error, _vars, context) => {
      assertType<Equal<typeof context, { startedAt: number } | undefined>>()
      assertType<Equal<typeof error.status, 422>>()
    },
  })
}

// Pattern O2: existing (non-optimistic) call sites keep compiling unchanged.
function _useUpdateTaskPlain() {
  return useUpdateTask({ onSuccess: (data) => void data.id })
}

// ── ReturnType of generated functions (TData and TCombinedResult erasure) ────
// `ReturnType<typeof f>` reads a generic function with its type parameters erased to
// `unknown`; the non-generic default signature kept last is what it reads instead.

// Pattern R1: query hooks, suspense hooks and the infinite hook, with typed errors.
function _returnTypeOfQueryHooks() {
  assertType<Equal<ReturnType<typeof useGetTask>, UseQueryResult<Task, GetTaskError>>>()
  assertType<Equal<ReturnType<typeof useListTasks>, UseQueryResult<TaskPage, ListTasksError>>>()
  assertType<
    Equal<ReturnType<typeof useSuspenseGetTask>, UseSuspenseQueryResult<Task, GetTaskError>>
  >()
  assertType<
    Equal<ReturnType<typeof useSuspenseListTasks>, UseSuspenseQueryResult<TaskPage, ListTasksError>>
  >()
  assertType<
    Equal<
      ReturnType<typeof useListTasksInfinite>,
      UseInfiniteQueryResult<InfiniteData<TaskPage>, ListTasksError>
    >
  >()
}

// Pattern R2: the queryOptions factory, with the typed error alias.
function _returnTypeOfQueryOptionsFactory() {
  const preTDataGetTask = (id: string) =>
    queryOptions<Task, GetTaskError>({ queryKey: taskKeys.detail(id), queryFn: () => getTask(id) })
  assertType<Equal<ReturnType<typeof getTaskQueryOptions>, ReturnType<typeof preTDataGetTask>>>()
}

// Pattern R3: useXxxQueries returns the default combined result, not `unknown`.
function _returnTypeOfQueriesHooks() {
  assertType<Equal<ReturnType<typeof useGetTaskQueries>, UseQueryResult<Task, GetTaskError>[]>>()
  assertType<
    Equal<ReturnType<typeof useListTasksQueries>, UseQueryResult<TaskPage, ListTasksError>[]>
  >()
  const count = useGetTaskQueries(['a'], undefined, (results) => results.length)
  assertType<Equal<typeof count, number>>()
  // A hook over several arguments takes one tuple per query.
  assertType<
    Equal<
      ReturnType<typeof useListUserTasksQueries>,
      UseQueryResult<TaskPage, ListUserTasksError>[]
    >
  >()
  const tupleCount = useListUserTasksQueries(
    [['user', { status: 'done' }], ['other']],
    undefined,
    (results) => results.length
  )
  assertType<Equal<typeof tupleCount, number>>()
}

// Pattern R4: suspense select and explicit TData keep working.
function _suspenseSelect() {
  const title = useSuspenseGetTask('id', { select: (task) => task.title })
  assertType<Equal<typeof title.data, string>>()
  assertType<
    Equal<
      ReturnType<typeof useSuspenseGetTask<number>>,
      UseSuspenseQueryResult<number, GetTaskError>
    >
  >()
}

// Pattern R5: the opt-in mutation generics default to `unknown`, which is what ReturnType reads,
// and a call without options infers those same defaults: the two results must be one type.
function _returnTypeOfOptimisticMutation() {
  const mutation = useUpdateTask()
  assertType<Equal<ReturnType<typeof useUpdateTask>, typeof mutation>>()
}

// Pattern R6: Parameters<typeof f> is the whole pre-TData parameter list, options type
// included, for the query, suspense, infinite and queries hooks and the factory.
function _parametersOfGeneratedFunctions() {
  type ListParams = Parameters<typeof listTasks>[0]
  type UserTasksParams = Parameters<typeof listUserTasks>[1]
  type TaskOptions = Omit<UseQueryOptions<Task, GetTaskError>, 'queryKey' | 'queryFn'>
  type TaskPageOptions = Omit<UseQueryOptions<TaskPage, ListTasksError>, 'queryKey' | 'queryFn'>
  type UserTasksOptions = Omit<
    UseQueryOptions<TaskPage, ListUserTasksError>,
    'queryKey' | 'queryFn'
  >
  type SuspenseTaskOptions = Omit<
    UseSuspenseQueryOptions<Task, GetTaskError>,
    'queryKey' | 'queryFn'
  >
  type SuspenseTaskPageOptions = Omit<
    UseSuspenseQueryOptions<TaskPage, ListTasksError>,
    'queryKey' | 'queryFn'
  >
  type TaskPageInfiniteOptions = Omit<
    UseInfiniteQueryOptions<TaskPage, ListTasksError, InfiniteData<TaskPage>, QueryKey, unknown>,
    'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
  >
  assertType<
    Equal<Parameters<typeof useGetTask>, [id: string | null | undefined, options?: TaskOptions]>
  >()
  assertType<
    Equal<Parameters<typeof useListTasks>, [params?: ListParams, options?: TaskPageOptions]>
  >()
  assertType<
    Equal<Parameters<typeof useSuspenseGetTask>, [id: string, options?: SuspenseTaskOptions]>
  >()
  assertType<
    Equal<
      Parameters<typeof useSuspenseListTasks>,
      [params?: ListParams, options?: SuspenseTaskPageOptions]
    >
  >()
  assertType<
    Equal<
      Parameters<typeof useListTasksInfinite>,
      [params?: ListParams, options?: TaskPageInfiniteOptions]
    >
  >()
  assertType<
    Equal<
      Parameters<typeof useGetTaskQueries>,
      [
        paramsList: ReadonlyArray<string>,
        options?: TaskOptions,
        combine?: (
          results: UseQueryResult<Task, GetTaskError>[]
        ) => UseQueryResult<Task, GetTaskError>[],
      ]
    >
  >()
  assertType<
    Equal<
      Parameters<typeof useListTasksQueries>,
      [
        paramsList: ReadonlyArray<ListParams>,
        options?: TaskPageOptions,
        combine?: (
          results: UseQueryResult<TaskPage, ListTasksError>[]
        ) => UseQueryResult<TaskPage, ListTasksError>[],
      ]
    >
  >()
  assertType<
    Equal<
      Parameters<typeof useListUserTasksQueries>,
      [
        paramsList: ReadonlyArray<readonly [userId: string, params?: UserTasksParams]>,
        options?: UserTasksOptions,
        combine?: (
          results: UseQueryResult<TaskPage, ListUserTasksError>[]
        ) => UseQueryResult<TaskPage, ListUserTasksError>[],
      ]
    >
  >()
  assertType<Equal<Parameters<typeof getTaskQueryOptions>, [id: string, options?: TaskOptions]>>()
}

// Pattern R7: a result annotation that disagrees with the response type is an error for the
// suspense hook, the queries hook and the factory too (the generic signatures return
// `NoInfer<TData>` / `NoInfer<TCombinedResult>`), with the typed error alias. Each directive
// has an agreeing twin that compiles, so an unrelated error cannot satisfy it.
function _mismatchedAnnotationIsRejected() {
  const suspense: UseSuspenseQueryResult<Task, GetTaskError> = useSuspenseGetTask('id')
  // @ts-expect-error `data` is a Task, not a string
  const wrongSuspense: UseSuspenseQueryResult<string, GetTaskError> = useSuspenseGetTask('id')
  const queries: UseQueryResult<Task, GetTaskError>[] = useGetTaskQueries(['id'])
  // @ts-expect-error the results are Task queries, not a number
  const wrongQueries: number = useGetTaskQueries(['id'])
  const tupleQueries: UseQueryResult<TaskPage, ListUserTasksError>[] = useListUserTasksQueries([
    ['user'],
  ])
  // @ts-expect-error the results are TaskPage queries, not a number
  const wrongTupleQueries: number = useListUserTasksQueries([['user']])
  const factory: ReturnType<typeof getTaskQueryOptions> = getTaskQueryOptions('id')
  // @ts-expect-error the factory carries a Task, not a string
  const wrongFactory: ReturnType<typeof getTaskQueryOptions<string>> = getTaskQueryOptions('id')
  return [
    suspense,
    wrongSuspense,
    queries,
    wrongQueries,
    tupleQueries,
    wrongTupleQueries,
    factory,
    wrongFactory,
  ]
}

void _returnTypeOfQueryHooks
void _returnTypeOfQueryOptionsFactory
void _returnTypeOfQueriesHooks
void _suspenseSelect
void _parametersOfGeneratedFunctions
void _mismatchedAnnotationIsRejected
void _returnTypeOfOptimisticMutation
void _useUpdateTaskOptimistic
void _useUpdateTaskPlain
void _useGetTaskQueriesResults
void _useGetTaskQueriesCombine
void _useGetTaskTypedError
void _useCreateTaskTypedError
void _useUploadTaskAttachmentPlainError
void _useListTasksTypedError
