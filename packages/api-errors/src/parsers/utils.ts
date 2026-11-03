import type { FieldError, ParsedErrors } from './types.js'

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/** Extract field + message from a single keyed-array item. Returns null when message is absent. */
function parseKeyedItem(
  item: Record<string, unknown>,
  fieldKey: string,
  messageKey: string
): { field: string | null; message: string } | null {
  const message = typeof item[messageKey] === 'string' ? (item[messageKey] as string) : null
  if (message === null) return null
  const field =
    typeof item[fieldKey] === 'string' && item[fieldKey] !== '' ? (item[fieldKey] as string) : null
  return { field, message }
}

/**
 * Parse an array of objects where each item carries a field key and a message key.
 * Items whose field value is absent or empty are treated as global (form-level) errors.
 * Items without a message value are silently skipped.
 */
export function parseKeyedArray(
  items: unknown[],
  fieldKey: string,
  messageKey: string
): ParsedErrors {
  const fieldErrors: FieldError[] = []
  const formErrors: string[] = []

  for (const item of items) {
    if (!isObject(item)) continue
    const parsed = parseKeyedItem(item, fieldKey, messageKey)
    if (parsed === null) continue
    if (parsed.field !== null) {
      fieldErrors.push({ field: parsed.field, message: parsed.message })
    } else {
      formErrors.push(parsed.message)
    }
  }

  return { fieldErrors, formErrors }
}

/**
 * Field-path segments that must never be forwarded to a path-aware setter.
 * A path-aware setter (e.g. React Hook Form's `setError`) splits the field name
 * on `.`/`[]` and walks/creates nested objects, so a malicious field like
 * `__proto__.polluted` from an untrusted error body would otherwise become a
 * prototype-pollution write in the consuming app.
 */
const FORBIDDEN_FIELD_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Upper bound on the number of field errors returned. A hostile body with a huge
 * `errors` map or array would otherwise produce an unbounded list (and an equal
 * number of `setError` calls / re-renders downstream).
 */
const MAX_FIELD_ERRORS = 1000

/** True if no path segment of `field` is a prototype-pollution gadget key. */
function isSafeFieldPath(field: string): boolean {
  for (const segment of field.split(/[.[\]]+/)) {
    if (FORBIDDEN_FIELD_SEGMENTS.has(segment)) return false
  }
  return true
}

/** Drop unsafe field paths and cap the result before it leaves the library. */
export function finalize(result: FieldError[]): FieldError[] {
  const safe = result.filter((e) => isSafeFieldPath(e.field))
  return safe.length > MAX_FIELD_ERRORS ? safe.slice(0, MAX_FIELD_ERRORS) : safe
}
