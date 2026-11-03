// Type-only consumer simulation for the opt-in hooks in generated-hooks-extended/
// (typed_errors, queries, optimistic_updates). Never called at runtime;
// tsc --noEmit exercises these patterns on every `pnpm lint` run in CI.

import type { ProblemDetail, Task, ValidationProblem } from '../generated/models.js'
import type { ApiError } from '../generated/client.js'
import {
  useGetTask,
  useGetTaskQueries,
  useListTasks,
  useCreateTask,
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

void _useGetTaskQueriesResults
void _useGetTaskQueriesCombine
void _useGetTaskTypedError
void _useCreateTaskTypedError
void _useListTasksPlainError
