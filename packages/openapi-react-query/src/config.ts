import {
  loadConfigFile,
  loadConfigsFile,
  validateConfigPath,
  validateInputPath,
  validateOutputPath,
} from 'openapi-zod-ts/config-core'

export { validateConfigPath, validateInputPath, validateOutputPath }

export interface ReactQueryConfig {
  /** Path to OpenAPI 3.1 spec file (JSON or YAML) */
  input_openapi: string
  /** Directory to write generated files */
  output: string
  /** staleTime in ms for all useQuery hooks (default: 0) */
  stale_time?: number
  /** gcTime in ms for all useQuery hooks (default: 300000) */
  gc_time?: number
  /** When true, generates useSuspense* variants alongside each useQuery hook (default: false) */
  suspense?: boolean
  /** Per-resource cache timing overrides. Key is the resource name (e.g. "tasks", "platforms"). */
  overrides?: Record<string, { stale_time?: number; gc_time?: number }>
  /** When true, mutation hooks auto-invalidate related resource queries on success (default: false) */
  auto_invalidate?: boolean
  /**
   * Controls infinite query hook generation.
   * - 'auto' (default): emit useXxxInfinite when pagination params are detected.
   * - true: emit useXxxInfinite for all list GET ops regardless of param names.
   * - false: never emit useXxxInfinite hooks.
   */
  infinite_query?: boolean | 'auto'
  /**
   * When true, hooks type their error as the client's per-operation error alias
   * (e.g. `GetPetError`) so `error.status` narrows `error.body` (default: false).
   */
  typed_errors?: boolean
}

function validateTiming(resource: string, timing: unknown): void {
  if (typeof timing !== 'object' || timing === null) {
    throw new Error(`"overrides.${resource}" must be an object`)
  }
  const t = timing as Record<string, unknown>
  if (t['stale_time'] !== undefined && typeof t['stale_time'] !== 'number') {
    throw new Error(`"overrides.${resource}.stale_time" must be a number`)
  }
  if (t['gc_time'] !== undefined && typeof t['gc_time'] !== 'number') {
    throw new Error(`"overrides.${resource}.gc_time" must be a number`)
  }
}

function validateOverrides(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('"overrides" must be an object')
  }
  for (const [resource, timing] of Object.entries(value as Record<string, unknown>)) {
    validateTiming(resource, timing)
  }
}

function expectNumber(raw: Record<string, unknown>, key: string, message: string): void {
  if (raw[key] !== undefined && typeof raw[key] !== 'number') throw new Error(message)
}

function expectBoolean(raw: Record<string, unknown>, key: string, message: string): void {
  if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error(message)
}

function validateInfiniteQuery(value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean' && value !== 'auto') {
    throw new Error('"infinite_query" must be a boolean or "auto"')
  }
}

function validateReactQueryFields(raw: Record<string, unknown>): void {
  expectNumber(raw, 'stale_time', '"stale_time" must be a number (milliseconds)')
  expectNumber(raw, 'gc_time', '"gc_time" must be a number (milliseconds)')
  expectBoolean(raw, 'suspense', '"suspense" must be a boolean')
  expectBoolean(raw, 'auto_invalidate', '"auto_invalidate" must be a boolean')
  expectBoolean(raw, 'typed_errors', '"typed_errors" must be a boolean')
  validateInfiniteQuery(raw['infinite_query'])
  if (raw['overrides'] !== undefined) validateOverrides(raw['overrides'])
}

function parseReactQueryConfig(
  raw: Record<string, unknown>,
  base: import('openapi-zod-ts/config-core').BaseConfig
): ReactQueryConfig {
  validateReactQueryFields(raw)
  return {
    ...base,
    stale_time: raw['stale_time'] as number | undefined,
    gc_time: raw['gc_time'] as number | undefined,
    suspense: raw['suspense'] as boolean | undefined,
    overrides: raw['overrides'] as
      Record<string, { stale_time?: number; gc_time?: number }> | undefined,
    auto_invalidate: raw['auto_invalidate'] as boolean | undefined,
    infinite_query: raw['infinite_query'] as boolean | 'auto' | undefined,
    typed_errors: raw['typed_errors'] as boolean | undefined,
  }
}

export async function loadConfig(cwd: string, configPath?: string): Promise<ReactQueryConfig> {
  return loadConfigFile<ReactQueryConfig>({
    cwd,
    configPath,
    defaultFileName: 'openapi-react-query.config.json',
    parse: parseReactQueryConfig,
  })
}

/**
 * Load a config file and return all configs as a normalized array.
 *
 * Single-spec config: returns a one-element array.
 * Multi-spec config with "projects" key: returns N-element array.
 */
export async function loadConfigs(cwd: string, configPath?: string): Promise<ReactQueryConfig[]> {
  return loadConfigsFile<ReactQueryConfig>({
    cwd,
    configPath,
    defaultFileName: 'openapi-react-query.config.json',
    parse: parseReactQueryConfig,
  })
}
