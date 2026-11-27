// fallow-ignore-file unused-file
// Type-only consumer simulation for the opt-in hooks in generated-hooks-extended/
// (typed_errors, queries, optimistic_updates). Never called at runtime;
// tsc --noEmit exercises these patterns on every `pnpm lint` run in CI.

import type {
  InfiniteData,
  UseInfiniteQueryResult,
  UseQueryResult,
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
import { getTask, type ApiError, type GetTaskError } from '../generated/client.js'
import {
  getTaskQueryOptions,
  taskKeys,
  useGetTask,
  useGetTaskQueries,
  useListTasks,
  useListTasksInfinite,
  useListTasksQueries,
  useCreateTask,
  useSuspenseGetTask,
  useSuspenseListTasks,
  useUpdateTask,
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
function _useListTasksPlainError() {
  const { error } = useListTasks()
  assertType<Equal<typeof error, ApiError | null>>()
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
  assertType<Equal<ReturnType<typeof useListTasks>, UseQueryResult<TaskPage, ApiError>>>()
  assertType<
    Equal<ReturnType<typeof useSuspenseGetTask>, UseSuspenseQueryResult<Task, GetTaskError>>
  >()
  assertType<
    Equal<ReturnType<typeof useSuspenseListTasks>, UseSuspenseQueryResult<TaskPage, ApiError>>
  >()
  assertType<
    Equal<
      ReturnType<typeof useListTasksInfinite>,
      UseInfiniteQueryResult<InfiniteData<TaskPage>, ApiError>
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
  assertType<Equal<ReturnType<typeof useListTasksQueries>, UseQueryResult<TaskPage, ApiError>[]>>()
  const count = useGetTaskQueries(['a'], undefined, (results) => results.length)
  assertType<Equal<typeof count, number>>()
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

// Pattern R5: opt-in mutation generics default to `unknown`, which is what ReturnType reads.
function _returnTypeOfOptimisticMutation() {
  assertType<
    Equal<ReturnType<typeof useUpdateTask>, ReturnType<typeof useUpdateTask<unknown, unknown>>>
  >()
}

void _returnTypeOfQueryHooks
void _returnTypeOfQueryOptionsFactory
void _returnTypeOfQueriesHooks
void _suspenseSelect
void _returnTypeOfOptimisticMutation
void _useUpdateTaskOptimistic
void _useUpdateTaskPlain
void _useGetTaskQueriesResults
void _useGetTaskQueriesCombine
void _useGetTaskTypedError
void _useCreateTaskTypedError
void _useListTasksPlainError
