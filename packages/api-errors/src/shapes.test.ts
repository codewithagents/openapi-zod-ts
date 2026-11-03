/**
 * Tests for the new shapes, hooks, and extractErrors API added in issue #187.
 *
 * Existing behavior is covered in index.test.ts. This file focuses on:
 *   1. violations[] shape
 *   2. invalid-params[] shape
 *   3. JSON:API errors[] shape (incl. pointer extraction)
 *   4. Laravel / DRF top-level field map
 *   5. extractErrors: matched/format signal
 *   6. extractErrors: formErrors / global-error channel
 *   7. resolveMessage / i18n hook
 *   8. Custom parser extension point
 *   9. JSON:API guard: must not silently match Spring-array path
 */
import { describe, expect, it, vi } from 'vitest'
import { extractErrors, extractFieldErrors } from './index.js'

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/** camelCase-to-dot-path transform used across several transformField tests. */
const camelToPath = (f: string) => f.replace(/([A-Z])/g, '.$1').toLowerCase()

/** Assert that a result contains exactly two named field errors. */
function assertTwoFieldErrors(
  result: { field: string; message: string }[],
  pairs: [string, string][]
) {
  expect(result).toHaveLength(pairs.length)
  for (const [field, message] of pairs) {
    expect(result).toContainEqual({ field, message })
  }
}

/** Assert that transformField converts emailAddress -> email.address. */
function assertEmailAddressTransformed(result: { field: string; message: string }[]) {
  expect(result).toEqual([{ field: 'email.address', message: 'invalid' }])
}

// ---------------------------------------------------------------------------
// violations[] shape
// ---------------------------------------------------------------------------

describe('violations[] shape', () => {
  it('maps violations with field to fieldErrors', () => {
    const result = extractFieldErrors({
      violations: [
        { field: 'email', message: 'must not be blank' },
        { field: 'name', message: 'too short' },
      ],
    })
    assertTwoFieldErrors(result, [
      ['email', 'must not be blank'],
      ['name', 'too short'],
    ])
  })

  it('falls back to fallbackField for violations without a field', () => {
    const result = extractFieldErrors(
      { violations: [{ message: 'General error' }] },
      { fallbackField: 'root' }
    )
    expect(result).toEqual([{ field: 'root', message: 'General error' }])
  })

  it('falls back to fallbackField for violations with an empty string field', () => {
    const result = extractFieldErrors(
      { violations: [{ field: '', message: 'General error' }] },
      { fallbackField: 'root' }
    )
    expect(result).toEqual([{ field: 'root', message: 'General error' }])
  })

  it('skips violations items without a message', () => {
    const result = extractFieldErrors({
      violations: [{ field: 'email' }, { field: 'name', message: 'required' }],
    })
    expect(result).toEqual([{ field: 'name', message: 'required' }])
  })

  it('applies transformField to violation field names', () => {
    const result = extractFieldErrors(
      { violations: [{ field: 'emailAddress', message: 'invalid' }] },
      { transformField: camelToPath }
    )
    assertEmailAddressTransformed(result)
  })

  it('returns [] for empty violations array', () => {
    expect(extractFieldErrors({ violations: [] })).toEqual([])
  })

  it('skips non-object items in violations array', () => {
    const result = extractFieldErrors({
      violations: [null, { field: 'email', message: 'invalid' }, 42],
    })
    expect(result).toEqual([{ field: 'email', message: 'invalid' }])
  })

  it('extractErrors reports format as violations', () => {
    const result = extractErrors({ violations: [{ field: 'email', message: 'bad' }] })
    expect(result.format).toBe('violations')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('extractErrors routes violations without a field to formErrors', () => {
    const result = extractErrors({
      violations: [{ field: 'email', message: 'invalid' }, { message: 'Global error' }],
    })
    expect(result.format).toBe('violations')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'invalid' }])
    expect(result.formErrors).toEqual(['Global error'])
  })
})

// ---------------------------------------------------------------------------
// invalid-params[] shape
// ---------------------------------------------------------------------------

describe('invalid-params[] shape', () => {
  it('maps invalid-params with name to fieldErrors', () => {
    const result = extractFieldErrors({
      'invalid-params': [
        { name: 'email', reason: 'must not be blank' },
        { name: 'age', reason: 'must be positive' },
      ],
    })
    assertTwoFieldErrors(result, [
      ['email', 'must not be blank'],
      ['age', 'must be positive'],
    ])
  })

  it('falls back to fallbackField when name is absent', () => {
    const result = extractFieldErrors(
      { 'invalid-params': [{ reason: 'Unprocessable' }] },
      { fallbackField: 'root' }
    )
    expect(result).toEqual([{ field: 'root', message: 'Unprocessable' }])
  })

  it('skips items without a reason', () => {
    const result = extractFieldErrors({
      'invalid-params': [{ name: 'email' }, { name: 'name', reason: 'required' }],
    })
    expect(result).toEqual([{ field: 'name', message: 'required' }])
  })

  it('applies transformField to field names', () => {
    const result = extractFieldErrors(
      { 'invalid-params': [{ name: 'emailAddress', reason: 'invalid' }] },
      { transformField: camelToPath }
    )
    assertEmailAddressTransformed(result)
  })

  it('returns [] for empty invalid-params array', () => {
    expect(extractFieldErrors({ 'invalid-params': [] })).toEqual([])
  })

  it('extractErrors reports format as invalid-params', () => {
    const result = extractErrors({ 'invalid-params': [{ name: 'email', reason: 'bad' }] })
    expect(result.format).toBe('invalid-params')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('extractErrors routes nameless entries to formErrors', () => {
    const result = extractErrors({
      'invalid-params': [{ name: 'email', reason: 'invalid' }, { reason: 'Overall problem' }],
    })
    expect(result.format).toBe('invalid-params')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'invalid' }])
    expect(result.formErrors).toEqual(['Overall problem'])
  })
})

// ---------------------------------------------------------------------------
// JSON:API shape
// ---------------------------------------------------------------------------

describe('JSON:API errors[] shape', () => {
  it.each([
    ['/data/attributes/email', 'email'],
    ['/data/attributes/address/city', 'address.city'],
    ['/data/relationships/author', 'author'],
    ['/email', 'email'],
  ])('maps pointer %s to field %s', (pointer, expectedField) => {
    const result = extractFieldErrors({
      errors: [{ source: { pointer }, detail: 'invalid' }],
    })
    expect(result).toEqual([{ field: expectedField, message: 'invalid' }])
  })

  it('maps multiple pointer fields', () => {
    const result = extractFieldErrors({
      errors: [
        { source: { pointer: '/data/attributes/email' }, detail: 'invalid' },
        { source: { pointer: '/data/attributes/name' }, detail: 'required' },
      ],
    })
    assertTwoFieldErrors(result, [
      ['email', 'invalid'],
      ['name', 'required'],
    ])
  })

  it('falls back to fallbackField for errors with pointer "/" (root pointer)', () => {
    const result = extractFieldErrors(
      { errors: [{ source: { pointer: '/' }, detail: 'Global error' }] },
      { fallbackField: 'root' }
    )
    expect(result).toEqual([{ field: 'root', message: 'Global error' }])
  })

  it('falls back to fallbackField for errors without a source pointer', () => {
    const result = extractFieldErrors(
      { errors: [{ detail: 'Non-field error' }] },
      { fallbackField: 'root' }
    )
    expect(result).toEqual([{ field: 'root', message: 'Non-field error' }])
  })

  it('applies transformField to JSON:API pointer-derived field names', () => {
    const result = extractFieldErrors(
      { errors: [{ source: { pointer: '/data/attributes/emailAddress' }, detail: 'invalid' }] },
      { transformField: camelToPath }
    )
    assertEmailAddressTransformed(result)
  })

  it('uses "Unknown error" when detail is absent', () => {
    const result = extractFieldErrors({
      errors: [{ source: { pointer: '/data/attributes/email' } }],
    })
    expect(result).toEqual([{ field: 'email', message: 'Unknown error' }])
  })

  it('extractErrors reports format as json-api', () => {
    const result = extractErrors({
      errors: [{ source: { pointer: '/data/attributes/email' }, detail: 'bad' }],
    })
    expect(result.format).toBe('json-api')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('extractErrors routes root-pointer and no-pointer errors to formErrors', () => {
    const result = extractErrors({
      errors: [
        { source: { pointer: '/data/attributes/email' }, detail: 'invalid' },
        { source: { pointer: '/' }, detail: 'Submission rejected' },
        { detail: 'Server-side error' },
      ],
    })
    expect(result.format).toBe('json-api')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'invalid' }])
    expect(result.formErrors).toContain('Submission rejected')
    expect(result.formErrors).toContain('Server-side error')
  })

  it('skips non-object items in JSON:API errors array', () => {
    const result = extractFieldErrors({
      errors: [null, { source: { pointer: '/data/attributes/email' }, detail: 'bad' }],
    })
    expect(result).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('JSON:API pointer unescapes ~0 and ~1 per RFC 6901', () => {
    // ~1 -> /, ~0 -> ~
    const result = extractFieldErrors({
      errors: [{ source: { pointer: '/data/attributes/field~1name' }, detail: 'bad' }],
    })
    expect(result).toEqual([{ field: 'field/name', message: 'bad' }])
  })
})

// ---------------------------------------------------------------------------
// JSON:API guard: must not silently match Spring-array path
// ---------------------------------------------------------------------------

describe('JSON:API guard: does not silently match Spring-array for standard Spring bodies', () => {
  it('Spring-array body is NOT recognized as JSON:API', () => {
    // A Spring body has `field` and `defaultMessage`, no `source` or `detail` at item level.
    // Must still be parsed by the Spring-array parser, not silently mis-parsed by JSON:API.
    const result = extractFieldErrors({
      errors: [{ field: 'email', defaultMessage: 'must not be blank' }],
    })
    expect(result).toEqual([{ field: 'email', message: 'must not be blank' }])
  })

  it('JSON:API body is NOT parsed via Spring-array path', () => {
    // Before the guard was added, this would produce [{ field: 'root', message: 'Unknown error' }]
    // because Spring-array uses item.field (absent) -> fallback and item.defaultMessage (absent) -> 'Unknown error'.
    // With the guard, JSON:API parser runs first and produces correct output.
    const result = extractErrors({
      errors: [{ source: { pointer: '/data/attributes/email' }, detail: 'must not be blank' }],
    })
    expect(result.format).toBe('json-api')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'must not be blank' }])
  })
})

// ---------------------------------------------------------------------------
// Laravel / DRF top-level field map
// ---------------------------------------------------------------------------

describe('Laravel / DRF top-level field map', () => {
  it('maps { field: ["msg1", "msg2"] } to fieldErrors', () => {
    const result = extractFieldErrors({
      email: ['must not be blank', 'invalid format'],
      name: ['required'],
    })
    expect(result).toHaveLength(3)
    expect(result).toContainEqual({ field: 'email', message: 'must not be blank' })
    expect(result).toContainEqual({ field: 'email', message: 'invalid format' })
    expect(result).toContainEqual({ field: 'name', message: 'required' })
  })

  it('maps mixed array + bare-string values when at least one is an array', () => {
    const result = extractFieldErrors({ email: ['must not be blank'], name: 'required' })
    expect(result).toContainEqual({ field: 'email', message: 'must not be blank' })
    expect(result).toContainEqual({ field: 'name', message: 'required' })
  })

  it('applies transformField to Laravel field names', () => {
    const result = extractFieldErrors(
      { emailAddress: ['invalid'] },
      { transformField: camelToPath }
    )
    assertEmailAddressTransformed(result)
  })

  it('returns [] for empty object (no fields)', () => {
    expect(extractFieldErrors({})).toEqual([])
  })

  it('does NOT match objects with reserved keys (errors, violations, detail, etc.)', () => {
    // These should be handled by other parsers, not Laravel/DRF
    expect(extractFieldErrors({ errors: { email: ['bad'] } })).toEqual([
      { field: 'email', message: 'bad' },
    ]) // rfc7807-map

    expect(extractFieldErrors({ detail: 'Something went wrong' })).toEqual([
      { field: 'root', message: 'Something went wrong' },
    ]) // rfc9457-detail
  })

  it('extractErrors reports format as laravel-drf', () => {
    const result = extractErrors({ email: ['must not be blank'] })
    expect(result.format).toBe('laravel-drf')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'must not be blank' }])
    expect(result.formErrors).toEqual([])
  })

  it('does NOT match objects with only non-string-array values (no arrays)', () => {
    // Without at least one string-array entry, Laravel/DRF does not match
    expect(extractFieldErrors({ foo: 'bar' })).toEqual([])
  })

  it('non-string-array values are skipped, array entries still match', () => {
    const result = extractFieldErrors({ email: ['bad'], count: 42 })
    expect(result).toEqual([{ field: 'email', message: 'bad' }])
  })
})

// ---------------------------------------------------------------------------
// extractErrors: format / matched signal
// ---------------------------------------------------------------------------

describe('extractErrors: format / matched signal', () => {
  it.each([
    [null, 'unrecognized object'],
    [undefined, 'undefined'],
    ['error', 'plain string'],
    [42, 'number'],
  ])('returns null format for %s (%s)', (input) => {
    expect(extractErrors(input).format).toBeNull()
  })

  it.each([
    ['null input', null],
    ['unrecognized object', { foo: 'bar' }],
  ])('returns empty ExtractResult for %s', (_label, input) => {
    expect(extractErrors(input)).toEqual({ fieldErrors: [], formErrors: [], format: null })
  })

  it('returns null format when statusCodes filter blocks', () => {
    const result = extractErrors(
      { status: 404, errors: { email: ['bad'] } },
      { statusCodes: [422] }
    )
    expect(result.format).toBeNull()
    expect(result.fieldErrors).toEqual([])
  })

  it.each([
    [{ errors: { email: ['bad'] } }, 'rfc7807-map'],
    [{ errors: [{ field: 'email', defaultMessage: 'bad' }] }, 'spring-array'],
    [{ violations: [{ field: 'email', message: 'bad' }] }, 'violations'],
    [{ 'invalid-params': [{ name: 'email', reason: 'bad' }] }, 'invalid-params'],
    [{ errors: [{ source: { pointer: '/data/attributes/email' }, detail: 'bad' }] }, 'json-api'],
    [{ email: ['bad'] }, 'laravel-drf'],
    [{ field: 'email', message: 'bad' }, 'flat-object'],
    [{ detail: 'Something went wrong' }, 'rfc9457-detail'],
  ])('returns correct format for recognized shape: %s -> %s', (input, expectedFormat) => {
    expect(extractErrors(input).format).toBe(expectedFormat)
  })

  it('returns flat-array format for array input', () => {
    expect(extractErrors([{ field: 'email', message: 'bad' }]).format).toBe('flat-array')
  })

  it('distinguishes unrecognized shape from recognized-but-empty violations', () => {
    expect(extractErrors({ foo: 'bar' }).format).toBeNull()
    // violations: [] is recognized (parser ran) even though arrays are empty
    const recognized = extractErrors({ violations: [] })
    expect(recognized.format).toBe('violations')
    expect(recognized.fieldErrors).toEqual([])
    expect(recognized.formErrors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// extractErrors: formErrors / global-error channel
// ---------------------------------------------------------------------------

describe('extractErrors: formErrors channel', () => {
  it('puts RFC 9457 top-level detail into formErrors, not fieldErrors', () => {
    const result = extractErrors({ title: 'Bad Request', detail: 'Email already taken' })
    expect(result.fieldErrors).toEqual([])
    expect(result.formErrors).toEqual(['Email already taken'])
    expect(result.format).toBe('rfc9457-detail')
  })

  it('puts JSON:API global errors into formErrors', () => {
    const result = extractErrors({
      errors: [
        { source: { pointer: '/data/attributes/email' }, detail: 'invalid' },
        { detail: 'Submission rejected globally' },
      ],
    })
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'invalid' }])
    expect(result.formErrors).toEqual(['Submission rejected globally'])
  })

  it('formErrors is always an array (empty for pure field-error shapes)', () => {
    const result = extractErrors({ errors: { email: ['bad'] } })
    expect(Array.isArray(result.formErrors)).toBe(true)
    expect(result.formErrors).toEqual([])
  })

  it('fieldErrors is always an array', () => {
    const result = extractErrors({ detail: 'error' })
    expect(Array.isArray(result.fieldErrors)).toBe(true)
    expect(result.fieldErrors).toEqual([])
  })

  it('both arrays may be non-empty for shapes with mixed errors', () => {
    const result = extractErrors({
      violations: [{ field: 'email', message: 'invalid' }, { message: 'Global problem' }],
    })
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'invalid' }])
    expect(result.formErrors).toEqual(['Global problem'])
  })

  it('extractErrors respects statusCodes filter and returns empty arrays', () => {
    const result = extractErrors({ status: 500, detail: 'Server Error' }, { statusCodes: [422] })
    expect(result.fieldErrors).toEqual([])
    expect(result.formErrors).toEqual([])
    expect(result.format).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveMessage / i18n hook
// ---------------------------------------------------------------------------

describe('resolveMessage hook', () => {
  it('applies resolveMessage to field errors in extractErrors', () => {
    const resolveMessage = vi.fn((msg: string) => `[translated] ${msg}`)
    const result = extractErrors({ errors: { email: ['must not be blank'] } }, { resolveMessage })
    expect(result.fieldErrors).toEqual([
      { field: 'email', message: '[translated] must not be blank' },
    ])
    expect(resolveMessage).toHaveBeenCalledWith('must not be blank', 'email')
  })

  it('applies resolveMessage to formErrors in extractErrors', () => {
    const resolveMessage = vi.fn((msg: string) => `[i18n] ${msg}`)
    const result = extractErrors({ detail: 'Generic error' }, { resolveMessage })
    expect(result.formErrors).toEqual(['[i18n] Generic error'])
    expect(resolveMessage).toHaveBeenCalledWith('Generic error', null)
  })

  it('passes null as the field argument for form-level errors', () => {
    const calls: Array<[string, string | null]> = []
    extractErrors(
      { violations: [{ field: 'email', message: 'invalid' }, { message: 'Global' }] },
      {
        resolveMessage: (msg, field) => {
          calls.push([msg, field])
          return msg
        },
      }
    )
    expect(calls).toContainEqual(['invalid', 'email'])
    expect(calls).toContainEqual(['Global', null])
  })

  it.each([
    ['violations', { violations: [{ field: 'email', message: 'bad' }] }],
    ['invalid-params', { 'invalid-params': [{ name: 'email', reason: 'bad' }] }],
    ['json-api', { errors: [{ source: { pointer: '/data/attributes/email' }, detail: 'bad' }] }],
    ['laravel-drf', { email: ['bad'] }],
  ])('resolveMessage works for %s shape', (_label, input) => {
    const result = extractErrors(input, { resolveMessage: (msg) => msg.toUpperCase() })
    expect(result.fieldErrors[0]?.message).toBe('BAD')
  })

  it('resolveMessage works for flat-array shape', () => {
    const result = extractErrors([{ field: 'email', message: 'bad' }], {
      resolveMessage: (msg) => `[x] ${msg}`,
    })
    expect(result.fieldErrors).toEqual([{ field: 'email', message: '[x] bad' }])
  })

  it('resolveMessage is NOT applied in extractFieldErrors (legacy API)', () => {
    // extractFieldErrors passes options through but resolveMessage is only used in extractErrors
    const result = extractFieldErrors(
      { errors: { email: ['bad'] } },
      { resolveMessage: (msg: string) => `[translated] ${msg}` }
    )
    expect(result).toEqual([{ field: 'email', message: 'bad' }])
  })
})

// ---------------------------------------------------------------------------
// Custom parser extension point
// ---------------------------------------------------------------------------

describe('custom parser extension point', () => {
  it('calls custom parser with the unwrapped body', () => {
    const customParser = vi.fn().mockReturnValue(null)
    extractErrors({ foo: 'bar' }, { parsers: [customParser] })
    expect(customParser).toHaveBeenCalledWith({ foo: 'bar' })
  })

  it('uses custom parser result with fieldErrors', () => {
    const customParser = vi.fn().mockReturnValue({
      fieldErrors: [{ field: 'custom', message: 'from custom parser' }],
      formErrors: [],
    })
    const result = extractErrors({ foo: 'bar' }, { parsers: [customParser] })
    expect(result.format).toBe('custom')
    expect(result.fieldErrors).toEqual([{ field: 'custom', message: 'from custom parser' }])
  })

  it('uses custom parser result with formErrors', () => {
    const customParser = vi.fn().mockReturnValue({
      fieldErrors: [],
      formErrors: ['Custom global error'],
    })
    const result = extractErrors({ foo: 'bar' }, { parsers: [customParser] })
    expect(result.format).toBe('custom')
    expect(result.formErrors).toEqual(['Custom global error'])
  })

  it('falls through to built-in parsers when custom parser returns null', () => {
    const customParser = vi.fn().mockReturnValue(null)
    const result = extractErrors({ errors: { email: ['bad'] } }, { parsers: [customParser] })
    expect(result.format).toBe('rfc7807-map')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('tries custom parsers in order and uses first non-null', () => {
    const parserA = vi.fn().mockReturnValue(null)
    const parserB = vi.fn().mockReturnValue({
      fieldErrors: [{ field: 'b', message: 'from B' }],
      formErrors: [],
    })
    const parserC = vi.fn().mockReturnValue({
      fieldErrors: [{ field: 'c', message: 'from C' }],
      formErrors: [],
    })
    const result = extractErrors({ foo: 'bar' }, { parsers: [parserA, parserB, parserC] })
    expect(result.format).toBe('custom')
    expect(result.fieldErrors).toEqual([{ field: 'b', message: 'from B' }])
    expect(parserC).not.toHaveBeenCalled()
  })

  it('custom parser receives already-unwrapped body (after ApiError unwrap)', () => {
    const customParser = vi.fn().mockReturnValue(null)
    extractErrors({ status: 422, body: { foo: 'bar' } }, { parsers: [customParser] })
    expect(customParser).toHaveBeenCalledWith({ foo: 'bar' })
  })

  it('custom parser result respects safety (prototype pollution is still filtered)', () => {
    const customParser = vi.fn().mockReturnValue({
      fieldErrors: [
        { field: '__proto__.polluted', message: 'bad' },
        { field: 'email', message: 'good' },
      ],
      formErrors: [],
    })
    const result = extractErrors({ foo: 'bar' }, { parsers: [customParser] })
    expect(result.fieldErrors).not.toContainEqual({ field: '__proto__.polluted', message: 'bad' })
    expect(result.fieldErrors).toContainEqual({ field: 'email', message: 'good' })
  })

  it('custom parser result works with resolveMessage', () => {
    const customParser = vi.fn().mockReturnValue({
      fieldErrors: [{ field: 'email', message: 'bad' }],
      formErrors: ['Global'],
    })
    const result = extractErrors(
      { foo: 'bar' },
      { parsers: [customParser], resolveMessage: (msg) => `[resolved] ${msg}` }
    )
    expect(result.fieldErrors).toEqual([{ field: 'email', message: '[resolved] bad' }])
    expect(result.formErrors).toEqual(['[resolved] Global'])
  })

  it('custom parser can handle array body', () => {
    const customParser = vi.fn().mockReturnValue({
      fieldErrors: [{ field: 'x', message: 'y' }],
      formErrors: [],
    })
    const result = extractErrors([1, 2, 3], { parsers: [customParser] })
    expect(result.format).toBe('custom')
    expect(customParser).toHaveBeenCalledWith([1, 2, 3])
  })

  it('never throws when custom parser throws', () => {
    const customParser = vi.fn().mockImplementation(() => {
      throw new Error('custom parser exploded')
    })
    expect(() => extractErrors({ foo: 'bar' }, { parsers: [customParser] })).not.toThrow()
    expect(extractErrors({ foo: 'bar' }, { parsers: [customParser] })).toEqual({
      fieldErrors: [],
      formErrors: [],
      format: null,
    })
  })
})

// ---------------------------------------------------------------------------
// extractErrors: body unwrapping behaves same as extractFieldErrors
// ---------------------------------------------------------------------------

describe('extractErrors: body unwrapping', () => {
  it('unwraps ApiError { status, body } wrapper', () => {
    const result = extractErrors({ status: 422, body: { errors: { email: ['bad'] } } })
    expect(result.format).toBe('rfc7807-map')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('unwraps Axios response.data wrapper', () => {
    const result = extractErrors({ response: { data: { errors: { email: ['bad'] } } } })
    expect(result.format).toBe('rfc7807-map')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('applies statusCodes filter before unwrapping', () => {
    const result = extractErrors(
      { status: 404, body: { errors: { email: ['bad'] } } },
      { statusCodes: [422] }
    )
    expect(result.format).toBeNull()
    expect(result.fieldErrors).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Backward compatibility: extractFieldErrors still works after refactor
// ---------------------------------------------------------------------------

describe('backward compatibility after adding new shapes', () => {
  it.each([
    [{ errors: { email: ['bad'] } }, [{ field: 'email', message: 'bad' }]],
    [{ errors: [{ field: 'email', defaultMessage: 'bad' }] }, [{ field: 'email', message: 'bad' }]],
    [{ field: 'email', message: 'bad' }, [{ field: 'email', message: 'bad' }]],
    [[{ field: 'email', message: 'bad' }], [{ field: 'email', message: 'bad' }]],
    [{ detail: 'Something went wrong' }, [{ field: 'root', message: 'Something went wrong' }]],
  ])('extractFieldErrors handles %s', (input, expected) => {
    expect(extractFieldErrors(input)).toEqual(expected)
  })
})

// ---------------------------------------------------------------------------
// Zod flatten shape
// ---------------------------------------------------------------------------

describe('zod-flatten shape', () => {
  it('maps fieldErrors keys to field errors', () => {
    const result = extractErrors({
      fieldErrors: { email: ['must not be blank'], name: ['required'] },
      formErrors: [],
    })
    expect(result.format).toBe('zod-flatten')
    expect(result.fieldErrors).toContainEqual({ field: 'email', message: 'must not be blank' })
    expect(result.fieldErrors).toContainEqual({ field: 'name', message: 'required' })
    expect(result.formErrors).toEqual([])
  })

  it('maps formErrors to formErrors channel', () => {
    const result = extractErrors({
      fieldErrors: {},
      formErrors: ['Global error', 'Another global'],
    })
    expect(result.format).toBe('zod-flatten')
    expect(result.fieldErrors).toEqual([])
    expect(result.formErrors).toEqual(['Global error', 'Another global'])
  })

  it('handles fieldErrors only (no formErrors key)', () => {
    const result = extractErrors({ fieldErrors: { email: ['invalid'] } })
    expect(result.format).toBe('zod-flatten')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'invalid' }])
    expect(result.formErrors).toEqual([])
  })

  it('handles formErrors only (no fieldErrors key)', () => {
    const result = extractErrors({ formErrors: ['Something went wrong'] })
    expect(result.format).toBe('zod-flatten')
    expect(result.fieldErrors).toEqual([])
    expect(result.formErrors).toEqual(['Something went wrong'])
  })

  it('handles both fieldErrors and formErrors mixed', () => {
    const result = extractErrors({
      fieldErrors: { email: ['bad email'], name: ['required'] },
      formErrors: ['Submission failed'],
    })
    expect(result.format).toBe('zod-flatten')
    expect(result.fieldErrors).toHaveLength(2)
    expect(result.formErrors).toEqual(['Submission failed'])
  })

  it('expands multiple messages per field into separate FieldErrors', () => {
    const result = extractErrors({
      fieldErrors: { email: ['must not be blank', 'invalid format'] },
      formErrors: [],
    })
    expect(result.fieldErrors).toEqual([
      { field: 'email', message: 'must not be blank' },
      { field: 'email', message: 'invalid format' },
    ])
  })

  it('applies transformField to field names', () => {
    const result = extractErrors(
      { fieldErrors: { emailAddress: ['invalid'] }, formErrors: [] },
      { transformField: camelToPath }
    )
    expect(result.fieldErrors).toEqual([{ field: 'email.address', message: 'invalid' }])
  })

  it('returns format zod-flatten for empty fieldErrors and formErrors', () => {
    const result = extractErrors({ fieldErrors: {}, formErrors: [] })
    expect(result.format).toBe('zod-flatten')
    expect(result.fieldErrors).toEqual([])
    expect(result.formErrors).toEqual([])
  })

  it('returns null format when neither fieldErrors nor formErrors key is present', () => {
    expect(extractErrors({ foo: 'bar' }).format).toBeNull()
  })

  it('does not match when fieldErrors is not a plain object (array instead)', () => {
    // fieldErrors: [] is wrong type — should not match zod-flatten
    expect(extractErrors({ fieldErrors: ['bad'], formErrors: [] }).format).not.toBe('zod-flatten')
  })

  it('does not match when formErrors is not a string array', () => {
    // formErrors: "string" is wrong type
    expect(extractErrors({ fieldErrors: {}, formErrors: 'oops' }).format).not.toBe('zod-flatten')
  })

  it('skips fieldErrors entries whose value is not a string array', () => {
    const result = extractErrors({
      fieldErrors: { email: ['valid'], count: 42 as unknown as string[] },
      formErrors: [],
    })
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'valid' }])
  })
})

// ---------------------------------------------------------------------------
// GraphQL extensions shape
// ---------------------------------------------------------------------------

describe('graphql-extensions shape', () => {
  it('maps extensions.field to fieldErrors', () => {
    const result = extractErrors({
      errors: [{ message: 'Invalid email', extensions: { field: 'email' } }],
    })
    expect(result.format).toBe('graphql-extensions')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'Invalid email' }])
    expect(result.formErrors).toEqual([])
  })

  it('maps extensions.path array to fieldErrors using dot-joined path', () => {
    const result = extractErrors({
      errors: [{ message: 'Required', extensions: { path: ['address', 'city'] } }],
    })
    expect(result.format).toBe('graphql-extensions')
    expect(result.fieldErrors).toEqual([{ field: 'address.city', message: 'Required' }])
  })

  it('prefers extensions.field over extensions.path when both are present', () => {
    const result = extractErrors({
      errors: [
        {
          message: 'Invalid',
          extensions: { field: 'email', path: ['user', 'email'] },
        },
      ],
    })
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'Invalid' }])
  })

  it('routes items without extensions to formErrors', () => {
    const result = extractErrors({
      errors: [{ message: 'Unauthenticated' }],
    })
    expect(result.format).toBe('graphql-extensions')
    expect(result.fieldErrors).toEqual([])
    expect(result.formErrors).toEqual(['Unauthenticated'])
  })

  it('routes items with empty extensions to formErrors', () => {
    const result = extractErrors({
      errors: [{ message: 'Forbidden', extensions: {} }],
    })
    expect(result.format).toBe('graphql-extensions')
    expect(result.formErrors).toEqual(['Forbidden'])
  })

  it('handles mixed field and form-level errors', () => {
    const result = extractErrors({
      errors: [
        { message: 'Invalid email', extensions: { field: 'email' } },
        { message: 'Not authorized' },
      ],
    })
    expect(result.format).toBe('graphql-extensions')
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'Invalid email' }])
    expect(result.formErrors).toEqual(['Not authorized'])
  })

  it('applies transformField to field names', () => {
    const result = extractErrors(
      { errors: [{ message: 'invalid', extensions: { field: 'emailAddress' } }] },
      { transformField: camelToPath }
    )
    expect(result.fieldErrors).toEqual([{ field: 'email.address', message: 'invalid' }])
  })

  it('does NOT match JSON:API shape (source.pointer present)', () => {
    const result = extractErrors({
      errors: [{ source: { pointer: '/data/attributes/email' }, detail: 'bad' }],
    })
    expect(result.format).toBe('json-api')
    expect(result.format).not.toBe('graphql-extensions')
  })

  it('does NOT match Spring Boot array shape (defaultMessage present)', () => {
    const result = extractErrors({
      errors: [{ field: 'email', defaultMessage: 'must not be blank' }],
    })
    expect(result.format).toBe('spring-array')
    expect(result.format).not.toBe('graphql-extensions')
  })

  it('returns null format when body.errors is not an array', () => {
    expect(extractErrors({ errors: 'not an array' }).format).toBeNull()
  })

  it('skips non-object items in errors array', () => {
    const result = extractErrors({
      errors: [null, { message: 'bad', extensions: { field: 'email' } }],
    })
    expect(result.fieldErrors).toEqual([{ field: 'email', message: 'bad' }])
  })

  it('skips items without a message', () => {
    const result = extractErrors({
      errors: [
        { extensions: { field: 'email' } },
        { message: 'valid', extensions: { field: 'name' } },
      ],
    })
    expect(result.fieldErrors).toEqual([{ field: 'name', message: 'valid' }])
  })

  it('extractErrors reports format as graphql-extensions', () => {
    const result = extractErrors({
      errors: [{ message: 'bad', extensions: { field: 'email' } }],
    })
    expect(result.format).toBe('graphql-extensions')
  })
})
