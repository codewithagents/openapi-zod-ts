import { describe, it, expect } from 'vitest'
import { normalizeQueryParamName } from '../plugins/client.js'

describe('normalizeQueryParamName', () => {
  // --- Regression: known transforms that must continue to work ---

  it.each([
    // Array marker stripping
    ['ids[]', 'ids'],
    ['project_ids[]', 'projectIds'],
    // Dot-separated names
    ['place.fields', 'placeFields'],
    // Underscore-separated names (common in REST APIs)
    ['current_weather', 'currentWeather'],
    ['temperature_unit', 'temperatureUnit'],
    // Dot+underscore mixed
    ['dm_event.fields', 'dmEventFields'],
    ['user.fields', 'userFields'],
    ['tweet.fields', 'tweetFields'],
    // Hyphen-separated
    ['max-results', 'maxResults'],
    // Apostrophes stripped
    ["it's", 'its'],
    ["don't_do", 'dontDo'],
    // Leading invalid identifier char gets prefixed with _
    ['123abc', '_23abc'],
    // Valid identifiers pass through unchanged
    ['id', 'id'],
    ['fooBar', 'fooBar'],
    // Leading underscore is treated as a separator run followed by a letter:
    // the underscore is discarded and the following letter is uppercased.
    ['_private', 'Private'],
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeQueryParamName(input)).toBe(expected)
  })

  it('strips trailing non-alphanumeric characters', () => {
    expect(normalizeQueryParamName('foo--')).toBe('foo')
    expect(normalizeQueryParamName('bar...')).toBe('bar')
  })

  it('returns empty string for all-separator input', () => {
    expect(normalizeQueryParamName('---')).toBe('')
    expect(normalizeQueryParamName('...')).toBe('')
  })

  it('handles empty string', () => {
    expect(normalizeQueryParamName('')).toBe('')
  })

  // --- Adversarial / pathological input: must complete near-instantly ---
  // A slow polynomial-backtracking implementation would hang or time out on these.

  it('handles a very long separator run followed by a letter in linear time', () => {
    const separators = '_'.repeat(50_000)
    const input = separators + 'x'
    const start = Date.now()
    const result = normalizeQueryParamName(input)
    const elapsed = Date.now() - start
    // Must finish well within 200 ms (linear pass over ~50k chars is < 1 ms in practice).
    expect(elapsed).toBeLessThan(200)
    // The separator run is followed by a letter, so it camelCases: result is 'X'.
    expect(result).toBe('X')
  })

  it('handles a very long separator run NOT followed by a letter in linear time', () => {
    const separators = '-'.repeat(50_000)
    const start = Date.now()
    const result = normalizeQueryParamName(separators)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
    // All separators, nothing left after trailing strip.
    expect(result).toBe('')
  })

  it('handles a long alternating pattern of separators and digits in linear time', () => {
    // Digit segments after separators are NOT letters, so the regex previously had to
    // backtrack repeatedly. With the linear scan, each character is visited at most twice.
    const input = '_1'.repeat(25_000) + 'z'
    const start = Date.now()
    const result = normalizeQueryParamName(input)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
    // The final 'z' is preceded by a digit, not a separator, so it is not uppercased.
    // The leading '_' separator run is one char, next is '1' (digit, not letter) -> kept.
    // Identifier start: '_' is valid -> stays.
    expect(result.length).toBeGreaterThan(0)
  })
})
