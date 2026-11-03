import type { FieldError, ParsedErrors } from './types.js'
import { isObject } from './utils.js'

/**
 * GraphQL errors array shape:
 * { errors: [{ message: "...", extensions?: { field?: string, path?: string[] } }] }
 *
 * Field resolution (in order):
 *   1. `extensions.field` — plain string field name
 *   2. `extensions.path` — array of path segments joined with `.`
 *   3. Neither — treated as a form-level (global) error
 *
 * Guards (must NOT match):
 *   - Items with `source.pointer` or `detail` (JSON:API shape)
 *   - Items with `defaultMessage` (Spring Boot shape)
 *
 * Returns null if `body.errors` is not an array.
 */
export function tryParseGraphqlExtensions(body: Record<string, unknown>): ParsedErrors | null {
  const { errors } = body
  if (!Array.isArray(errors)) return null

  // Require at least one item that looks like a GraphQL error (has message, not JSON:API/Spring).
  if (!errors.some(isGraphqlErrorItem)) return null

  const fieldErrors: FieldError[] = []
  const formErrors: string[] = []

  for (const item of errors) {
    if (!isObject(item)) continue
    const message = typeof item['message'] === 'string' ? item['message'] : null
    if (message === null) continue

    const field = extractField(item)
    if (field !== null) {
      fieldErrors.push({ field, message })
    } else {
      formErrors.push(message)
    }
  }

  return { fieldErrors, formErrors }
}

/** True when an item looks like a GraphQL error object (not JSON:API, not Spring). */
function isGraphqlErrorItem(item: unknown): boolean {
  if (!isObject(item)) return false
  // Must have a string message.
  if (typeof item['message'] !== 'string') return false
  // Must NOT have JSON:API keys.
  if (isObject(item['source']) && 'pointer' in item['source']) return false
  if (typeof item['detail'] === 'string') return false
  // Must NOT have Spring Boot keys.
  if ('defaultMessage' in item) return false
  // Must NOT have a top-level `field` key (Spring uses `field` for the field name).
  // Real GraphQL errors carry the field name in `extensions.field`, not at the top level.
  if ('field' in item) return false
  return true
}

/** Extract a field name from a GraphQL error item's extensions. Returns null for form-level. */
function extractField(item: Record<string, unknown>): string | null {
  const extensions = item['extensions']
  if (!isObject(extensions)) return null

  // Prefer extensions.field (plain string).
  if (typeof extensions['field'] === 'string' && extensions['field'] !== '') {
    return extensions['field'] as string
  }

  // Fall back to extensions.path (array joined with `.`).
  const path = extensions['path']
  if (Array.isArray(path) && path.length > 0) {
    const segments = path.filter((s) => typeof s === 'string' || typeof s === 'number').map(String)
    if (segments.length > 0) return segments.join('.')
  }

  return null
}
