// Type-only consumer simulation — never called at runtime.
// tsc --noEmit exercises all these patterns on every `pnpm lint` run in CI.

import type { InfiniteData, UseQueryResult } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import type { Task, TaskPage, CreateTaskRequest } from '../generated/models.js'
import type { ApiError } from '../generated/client.js'
import {
  useListTasks,
  useListTasksInfinite,
  useGetTask,
  useCreateTask,
  getTaskQueryOptions,
} from '../generated/hooks.js'
import { createServerClient } from '../generated/server.js'

// Pattern 1: useQuery with no params (list hook)
function _useListTasksNoParams() {
  return useListTasks()
}

// Pattern 2: useQuery with params object
function _useListTasksWithParams() {
  return useListTasks({ status: 'pending', page: 1 })
}

// Pattern 3: detail hook with nullish id — auto-disabled when null (Feature #61)
function _useGetTaskNullish(id: string | null) {
  return useGetTask(id ?? '', { enabled: id !== null })
}

// Pattern 4: useMutation with onSuccess — 4 params matching RQ v5 MutationObserverOptions
// (this would have caught Bug #70)
function _useCreateTaskOnSuccess() {
  return useCreateTask({
    onSuccess: (data, variables, _onMutateResult, _context) => {
      const _d: Task = data
      const _v: CreateTaskRequest = variables
      void _d
      void _v
    },
  })
}

// Pattern 5: useMutation with onError
function _useCreateTaskOnError() {
  return useCreateTask({
    onError: (error) => {
      void error
    },
  })
}

// Pattern 6: server client factory — methods must not be `never`
// (this would have caught Bug #69)
async function _serverClientUsage() {
  const api = createServerClient({ baseUrl: 'https://api.example.com' })
  const tasks = await api.listTasks()
  void tasks
  const task = await api.getTask('some-id')
  void task
  const created = await api.createTask({ title: 'My Task' })
  void created
  const updated = await api.updateTask('some-id', { title: 'Updated' })
  void updated
  await api.deleteTask('some-id')
}

// Pattern 7: useXxxInfinite — partial options object (only enabled); must not
// require getNextPageParam or initialPageParam at the call site (Fix #189-CR1).
function _useListTasksInfinitePartialOptions(enabled: boolean) {
  return useListTasksInfinite({ status: 'pending' }, { enabled })
}

// Pattern 8: useXxxInfinite — no options argument at all; must typecheck.
function _useListTasksInfiniteNoOptions() {
  return useListTasksInfinite()
}

// ── Typed select transforms (#195) ───────────────────────────────────────────
// Exact type equality: fails to compile when `data` widens or narrows unexpectedly.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | undefined {
  return undefined
}

// Pattern 9: select changes the data type — `data` is string, not Task.
function _useGetTaskSelect() {
  const result = useGetTask('id', { select: (task) => task.title })
  assertType<Equal<typeof result.data, string | undefined>>()
  return result
}

// Pattern 10: without select, data stays the raw response type (back-compat).
function _useGetTaskNoSelect() {
  const result = useGetTask('id')
  assertType<Equal<typeof result.data, Task | undefined>>()
  // Pre-#195 explicit annotations keep compiling.
  const annotated: UseQueryResult<Task, ApiError> = useGetTask('id')
  return [result, annotated]
}

// Pattern 11: list hook select over the page envelope.
function _useListTasksSelect() {
  const result = useListTasks({ page: 1 }, { select: (page: TaskPage) => page.items.length })
  assertType<Equal<typeof result.data, number | undefined>>()
  return result
}

// Pattern 12: queryOptions factory carries the select type into useQuery.
function _useQueryOptionsSelect() {
  const result = useQuery(getTaskQueryOptions('id', { select: (task) => task.id.length }))
  assertType<Equal<typeof result.data, number | undefined>>()
  return result
}

// Pattern 13: infinite hook select flattens pages; default stays InfiniteData<TaskPage>.
function _useListTasksInfiniteSelect() {
  const flat = useListTasksInfinite(undefined, {
    select: (data) => data.pages.flatMap((p) => p.items),
  })
  assertType<Equal<typeof flat.data, Task[] | undefined>>()
  const raw = useListTasksInfinite()
  assertType<Equal<typeof raw.data, InfiniteData<TaskPage> | undefined>>()
  return [flat, raw]
}

// Ensure all _-prefixed functions are referenced so TypeScript doesn't elide them
void _useListTasksNoParams
void _useListTasksWithParams
void _useGetTaskNullish
void _useCreateTaskOnSuccess
void _useCreateTaskOnError
void _serverClientUsage
void _useListTasksInfinitePartialOptions
void _useListTasksInfiniteNoOptions
void _useGetTaskSelect
void _useGetTaskNoSelect
void _useListTasksSelect
void _useQueryOptionsSelect
void _useListTasksInfiniteSelect
