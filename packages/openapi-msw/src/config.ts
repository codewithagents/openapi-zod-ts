import {
  loadConfigFile,
  loadConfigsFile,
  validateConfigPath,
  validateInputPath,
  validateOutputPath,
} from 'openapi-zod-ts/config-core'

// fallow-ignore-next-line unused-export
export { validateConfigPath, validateInputPath, validateOutputPath }

export interface MswConfig {
  /** Path to OpenAPI 3.1 spec file (JSON or YAML) */
  input_openapi: string
  /** Directory to write generated files */
  output: string
  /** Seed value passed to faker.seed() for deterministic output (default: 42) */
  seed?: number
  /** Maximum array length in generated mock data (default: 3) */
  max_array_items?: number
  /** Maximum schema recursion depth before emitting null (default: 30) */
  depth_cap?: number
  /**
   * Origin (optionally with a base path) prefixed to every handler path, e.g.
   * "https://api.test". When omitted, handlers match any origin via MSW's "*" wildcard.
   */
  base_url?: string
}

function expectIntegerAtLeast(raw: Record<string, unknown>, key: string, min: number): void {
  const val = raw[key]
  if (val === undefined) return
  if (typeof val !== 'number' || !Number.isInteger(val)) {
    throw new Error(`"${key}" must be an integer`)
  }
  if (val < min) {
    throw new Error(`"${key}" must be >= ${min}`)
  }
}

function expectNonEmptyString(raw: Record<string, unknown>, key: string): void {
  const val = raw[key]
  if (val === undefined) return
  if (typeof val !== 'string' || val.trim() === '') {
    throw new Error(`"${key}" must be a non-empty string`)
  }
}

function validateMswFields(raw: Record<string, unknown>): void {
  expectIntegerAtLeast(raw, 'seed', 0)
  expectIntegerAtLeast(raw, 'max_array_items', 1)
  expectIntegerAtLeast(raw, 'depth_cap', 1)
  expectNonEmptyString(raw, 'base_url')
}

function parseMswConfig(
  raw: Record<string, unknown>,
  base: import('openapi-zod-ts/config-core').BaseConfig
): MswConfig {
  validateMswFields(raw)
  return {
    ...base,
    seed: raw['seed'] as number | undefined,
    max_array_items: raw['max_array_items'] as number | undefined,
    depth_cap: raw['depth_cap'] as number | undefined,
    base_url: raw['base_url'] as string | undefined,
  }
}

export async function loadConfig(cwd: string, configPath?: string): Promise<MswConfig> {
  return loadConfigFile<MswConfig>({
    cwd,
    configPath,
    defaultFileName: 'openapi-msw.config.json',
    parse: parseMswConfig,
  })
}

/**
 * Load a config file and return all configs as a normalized array.
 *
 * Single-spec config: returns a one-element array.
 * Multi-spec config with "projects" key: returns N-element array.
 */
export async function loadConfigs(cwd: string, configPath?: string): Promise<MswConfig[]> {
  return loadConfigsFile<MswConfig>({
    cwd,
    configPath,
    defaultFileName: 'openapi-msw.config.json',
    parse: parseMswConfig,
  })
}
