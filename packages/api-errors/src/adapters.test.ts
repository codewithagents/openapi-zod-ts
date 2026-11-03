import { describe, expect, it, vi } from 'vitest'
import { mapApiErrorsToRecord, mapApiErrorsFormik, mapApiErrorsTanstack } from './index.js'

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

/** A recognized error body with two field errors. */
const twoFieldErrors = { errors: { email: ['must not be blank'], name: ['required'] } }

/** A recognized error body with one field error. */
const singleFieldError = { errors: { email: ['invalid'] } }

/** A body that no built-in parser recognizes. */
const unrecognizedBody = { foo: 'bar' }

// ---------------------------------------------------------------------------
// mapApiErrorsToRecord
// ---------------------------------------------------------------------------

describe('mapApiErrorsToRecord', () => {
  it('returns a record mapping field -> first message', () => {
    const result = mapApiErrorsToRecord(singleFieldError)
    expect(result).toEqual({ email: 'invalid' })
  })

  it('returns a record for multiple fields', () => {
    const result = mapApiErrorsToRecord(twoFieldErrors)
    expect(result).toEqual({ email: 'must not be blank', name: 'required' })
  })

  it('returns first message when a field has multiple messages', () => {
    const result = mapApiErrorsToRecord({
      errors: { email: ['first error', 'second error'] },
    })
    expect(result).toEqual({ email: 'first error' })
  })

  it('returns empty record for unrecognized body', () => {
    expect(mapApiErrorsToRecord(unrecognizedBody)).toEqual({})
  })

  it('returns empty record for null input', () => {
    expect(mapApiErrorsToRecord(null)).toEqual({})
  })

  it('respects fallbackField option', () => {
    const result = mapApiErrorsToRecord({ detail: 'Something failed' }, { fallbackField: 'root' })
    expect(result).toEqual({ root: 'Something failed' })
  })

  it('respects transformField option', () => {
    const result = mapApiErrorsToRecord(
      { errors: { emailAddress: ['invalid'] } },
      { transformField: (f) => f.replace(/([A-Z])/g, '.$1').toLowerCase() }
    )
    expect(result).toEqual({ 'email.address': 'invalid' })
  })

  it('works with Zod flatten shape', () => {
    const result = mapApiErrorsToRecord({
      fieldErrors: { email: ['bad'], name: ['required'] },
      formErrors: [],
    })
    expect(result).toEqual({ email: 'bad', name: 'required' })
  })

  it('works with GraphQL extensions shape', () => {
    const result = mapApiErrorsToRecord({
      errors: [
        { message: 'Invalid email', extensions: { field: 'email' } },
        { message: 'Required', extensions: { field: 'name' } },
      ],
    })
    expect(result).toEqual({ email: 'Invalid email', name: 'Required' })
  })
})

// ---------------------------------------------------------------------------
// mapApiErrorsFormik
// ---------------------------------------------------------------------------

describe('mapApiErrorsFormik', () => {
  it('calls setErrors with the record of field errors', () => {
    const setErrors = vi.fn()
    mapApiErrorsFormik(singleFieldError, setErrors)
    expect(setErrors).toHaveBeenCalledOnce()
    expect(setErrors).toHaveBeenCalledWith({ email: 'invalid' })
  })

  it('calls setErrors with all fields for multiple errors', () => {
    const setErrors = vi.fn()
    mapApiErrorsFormik(twoFieldErrors, setErrors)
    expect(setErrors).toHaveBeenCalledOnce()
    expect(setErrors).toHaveBeenCalledWith({ email: 'must not be blank', name: 'required' })
  })

  it('calls setErrors with empty record for unrecognized body', () => {
    const setErrors = vi.fn()
    mapApiErrorsFormik(unrecognizedBody, setErrors)
    expect(setErrors).toHaveBeenCalledOnce()
    expect(setErrors).toHaveBeenCalledWith({})
  })

  it('calls setErrors with empty record for null input', () => {
    const setErrors = vi.fn()
    mapApiErrorsFormik(null, setErrors)
    expect(setErrors).toHaveBeenCalledWith({})
  })

  it('respects fallbackField option', () => {
    const setErrors = vi.fn()
    mapApiErrorsFormik({ detail: 'failed' }, setErrors, { fallbackField: 'root' })
    expect(setErrors).toHaveBeenCalledWith({ root: 'failed' })
  })

  it('respects transformField option', () => {
    const setErrors = vi.fn()
    mapApiErrorsFormik({ errors: { emailAddress: ['invalid'] } }, setErrors, {
      transformField: (f) => f.replace(/([A-Z])/g, '.$1').toLowerCase(),
    })
    expect(setErrors).toHaveBeenCalledWith({ 'email.address': 'invalid' })
  })
})

// ---------------------------------------------------------------------------
// mapApiErrorsTanstack
// ---------------------------------------------------------------------------

describe('mapApiErrorsTanstack', () => {
  it('calls setFieldMeta for each field error', () => {
    const setFieldMeta = vi.fn()
    const form = { setFieldMeta }
    mapApiErrorsTanstack(singleFieldError, form)
    expect(setFieldMeta).toHaveBeenCalledOnce()
    expect(setFieldMeta).toHaveBeenCalledWith('email', expect.any(Function))
  })

  it('produces the correct meta update for a field', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack(singleFieldError, { setFieldMeta })

    const [, updater] = setFieldMeta.mock.calls[0]
    const prevMeta = { isTouched: true, isValid: true }
    const nextMeta = updater(prevMeta)

    expect(nextMeta).toEqual({
      isTouched: true,
      isValid: true,
      errors: ['invalid'],
      errorMap: { onChange: 'invalid' },
    })
  })

  it('calls setFieldMeta for each of multiple field errors', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack(twoFieldErrors, { setFieldMeta })
    expect(setFieldMeta).toHaveBeenCalledTimes(2)
    const calledFields = setFieldMeta.mock.calls.map(([field]) => field)
    expect(calledFields).toContain('email')
    expect(calledFields).toContain('name')
  })

  it('does not call setFieldMeta for unrecognized body', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack(unrecognizedBody, { setFieldMeta })
    expect(setFieldMeta).not.toHaveBeenCalled()
  })

  it('does not call setFieldMeta for null input', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack(null, { setFieldMeta })
    expect(setFieldMeta).not.toHaveBeenCalled()
  })

  it('respects fallbackField option', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack({ detail: 'failed' }, { setFieldMeta }, { fallbackField: 'root' })
    expect(setFieldMeta).toHaveBeenCalledWith('root', expect.any(Function))
  })

  it('respects transformField option', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack(
      { errors: { emailAddress: ['invalid'] } },
      { setFieldMeta },
      {
        transformField: (f) => f.replace(/([A-Z])/g, '.$1').toLowerCase(),
      }
    )
    expect(setFieldMeta).toHaveBeenCalledWith('email.address', expect.any(Function))
  })

  it('updater preserves existing meta properties', () => {
    const setFieldMeta = vi.fn()
    mapApiErrorsTanstack(singleFieldError, { setFieldMeta })
    const [, updater] = setFieldMeta.mock.calls[0]
    const prevMeta = { isTouched: false, isDirty: true, customProp: 'value' }
    const nextMeta = updater(prevMeta)
    expect(nextMeta.isTouched).toBe(false)
    expect(nextMeta.isDirty).toBe(true)
    expect(nextMeta.customProp).toBe('value')
    expect(nextMeta.errors).toEqual(['invalid'])
  })
})
