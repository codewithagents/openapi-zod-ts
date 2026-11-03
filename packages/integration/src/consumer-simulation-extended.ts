// Type-only consumer simulation for the opt-in hooks in generated-hooks-extended/
// (typed_errors, queries, optimistic_updates). Never called at runtime;
// tsc --noEmit exercises these patterns on every `pnpm lint` run in CI.

import type { ProblemDetail, ValidationProblem } from '../generated/models.js'
import type { ApiError } from '../generated/client.js'
import { useGetTask, useListTasks, useCreateTask } from '../generated-hooks-extended/hooks.js'

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

void _useGetTaskTypedError
void _useCreateTaskTypedError
void _useListTasksPlainError
