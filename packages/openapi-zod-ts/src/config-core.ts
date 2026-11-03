import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Minimal config fields required by every package. */
export interface BaseConfig {
  /** Path to the OpenAPI 3.1 spec file (JSON or YAML) */
  input_openapi: string
  /** Directory to write generated files */
  output: string
}

/**
 * String-prefix blocklist for common system directories.
 *
 * Threat model: interactive CLI misconfiguration (e.g. a typo in the output path).
 * This is NOT an exhaustive security control. It does not cover symlinks that point
 * into allowed dirs, relative traversal through an allowed directory, or Windows
 * short (8.3) names. Do not rely on it as a sandbox boundary.
 */
export const FORBIDDEN_OUTPUT_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/run',
  'C:\\Windows',
  'C:\\Program Files',
]

/**
 * Same constraint as FORBIDDEN_OUTPUT_PREFIXES, applied to the input spec path.
 * See that constant's JSDoc for threat-model limitations.
 */
export const FORBIDDEN_INPUT_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/sys',
  '/proc',
  '/dev',
  'C:\\Windows',
  'C:\\Program Files',
]

const JS_CONFIG_EXTENSIONS = ['.js', '.mjs', '.cjs']

/** Returns true when the path ends in a JS/ESM config extension. */
export function isJsConfigPath(configPath: string): boolean {
  return JS_CONFIG_EXTENSIONS.some((ext) => configPath.endsWith(ext))
}

export function validateConfigPath(configPath: string): void {
  const isJson = configPath.endsWith('.json')
  const isJs = isJsConfigPath(configPath)
  if (!isJson && !isJs) {
    throw new Error(`Config file must be a .json, .js, .mjs, or .cjs file, got: ${configPath}`)
  }
}

export function validateOutputPath(resolvedOutput: string): void {
  const normalized = resolvedOutput.replace(/\\/g, '/')
  for (const forbidden of FORBIDDEN_OUTPUT_PREFIXES) {
    const normalizedForbidden = forbidden.replace(/\\/g, '/')
    if (normalized === normalizedForbidden || normalized.startsWith(normalizedForbidden + '/')) {
      throw new Error(
        `Output path resolves to a system directory: "${resolvedOutput}". ` +
          `This looks like a misconfiguration. Please check your config file.`
      )
    }
  }
}

export function validateInputPath(resolvedInput: string): void {
  const normalized = resolvedInput.replace(/\\/g, '/')
  for (const forbidden of FORBIDDEN_INPUT_PREFIXES) {
    const normalizedForbidden = forbidden.replace(/\\/g, '/')
    if (normalized === normalizedForbidden || normalized.startsWith(normalizedForbidden + '/')) {
      throw new Error(
        `Input spec path resolves to a system directory: "${resolvedInput}". ` +
          `This looks like a misconfiguration. Please check your config file.`
      )
    }
  }
}

/** Options for loadConfigFile. */
export interface LoadConfigOptions<T> {
  /** Working directory used to resolve relative paths. */
  cwd: string
  /** Explicit config file path (optional). If omitted, defaultFileName is used. */
  configPath?: string
  /** Default config file name, resolved against cwd when configPath is not provided. */
  defaultFileName: string
  /**
   * Package-specific parse function. Receives the raw config record, the validated
   * base fields, and cwd. Must return the final typed config object.
   */
  parse: (raw: Record<string, unknown>, base: BaseConfig, cwd: string) => T
}

/** Load and validate a JS/MJS/CJS config file, returning its default export as a raw record. */
async function loadJsConfig(resolvedConfigPath: string): Promise<Record<string, unknown>> {
  let mod: unknown
  try {
    mod = await import(pathToFileURL(resolvedConfigPath).href)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to load JS config file: ${resolvedConfigPath}\n${message}`)
  }
  const exported = (mod as Record<string, unknown>)['default'] ?? mod
  if (typeof exported !== 'object' || exported === null) {
    throw new Error('Config must be a JSON object')
  }
  return exported as Record<string, unknown>
}

/** Load and validate a JSON config file, returning the parsed object as a raw record. */
async function loadJsonConfig(resolvedConfigPath: string): Promise<Record<string, unknown>> {
  let fileContents: string
  try {
    fileContents = await readFile(resolvedConfigPath, 'utf-8')
  } catch {
    throw new Error(`Config file not found: ${resolvedConfigPath}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fileContents)
  } catch {
    throw new Error(`Config file is not valid JSON: ${resolvedConfigPath}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Config must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

/**
 * Load and parse the raw config object from disk.
 * Shared between loadConfigFile and loadConfigsFile.
 */
async function loadRawConfig(resolvedConfigPath: string): Promise<Record<string, unknown>> {
  if (isJsConfigPath(resolvedConfigPath)) {
    return loadJsConfig(resolvedConfigPath)
  }
  return loadJsonConfig(resolvedConfigPath)
}

/** Parse and validate base fields (input_openapi, output) from a raw config record. */
function parseBaseConfig(raw: Record<string, unknown>, cwd: string): BaseConfig {
  if (typeof raw['input_openapi'] !== 'string' || !raw['input_openapi']) {
    throw new Error('Config missing required field: "input_openapi" (path to OpenAPI 3.1 spec)')
  }
  if (typeof raw['output'] !== 'string' || !raw['output']) {
    throw new Error('Config missing required field: "output" (output directory)')
  }

  const input_openapi = raw['input_openapi'] as string
  const output = raw['output'] as string

  validateInputPath(resolve(cwd, input_openapi))
  validateOutputPath(resolve(cwd, output))

  return { input_openapi, output }
}

/** Resolve the config path, optionally validate it, and load the raw object. */
async function prepareRaw(opts: {
  configPath?: string
  cwd: string
  defaultFileName: string
}): Promise<{ raw: Record<string, unknown> }> {
  const resolvedConfigPath = opts.configPath ?? join(opts.cwd, opts.defaultFileName)
  if (opts.configPath !== undefined) {
    validateConfigPath(opts.configPath)
  }
  return { raw: await loadRawConfig(resolvedConfigPath) }
}

// fallow-ignore-next-line complexity
export async function loadConfigFile<T>(opts: LoadConfigOptions<T>): Promise<T> {
  const { raw } = await prepareRaw(opts)
  const base = parseBaseConfig(raw, opts.cwd)
  return opts.parse(raw, base, opts.cwd)
}

/** Parse a single project entry from a projects array, wrapping errors with the entry index. */
function parseProjectEntry<T>(entry: unknown, index: number, opts: LoadConfigOptions<T>): T {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`projects[${index}]: entry must be a config object`)
  }
  const projectRaw = entry as Record<string, unknown>
  let base: BaseConfig
  try {
    base = parseBaseConfig(projectRaw, opts.cwd)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`projects[${index}]: ${message}`)
  }
  try {
    return opts.parse(projectRaw, base, opts.cwd)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`projects[${index}]: ${message}`)
  }
}

/**
 * Load a config file that may contain either a single-spec config or a
 * "projects" array of configs. Returns a normalized array of parsed configs.
 *
 * When the config root contains a "projects" key, each entry is parsed
 * independently. Having both "projects" and top-level single-spec keys
 * (input_openapi, output) in the same config is a validation error.
 *
 * Single-spec configs (no "projects" key) are returned as a one-element array,
 * making call sites uniform.
 */
export async function loadConfigsFile<T>(opts: LoadConfigOptions<T>): Promise<T[]> {
  const { raw } = await prepareRaw(opts)

  if ('projects' in raw) {
    return parseProjectsArray(raw, opts)
  }

  // Single-spec mode: parse as before, return as one-element array.
  const base = parseBaseConfig(raw, opts.cwd)
  return [opts.parse(raw, base, opts.cwd)]
}

function parseProjectsArray<T>(raw: Record<string, unknown>, opts: LoadConfigOptions<T>): T[] {
  const hasTopLevelInput = 'input_openapi' in raw && raw['input_openapi'] !== undefined
  const hasTopLevelOutput = 'output' in raw && raw['output'] !== undefined
  if (hasTopLevelInput || hasTopLevelOutput) {
    throw new Error(
      'Config cannot have both top-level "input_openapi"/"output" and a "projects" array. ' +
        'Use one form or the other.'
    )
  }

  const projects = raw['projects']
  if (!Array.isArray(projects)) {
    throw new Error('"projects" must be an array of config objects')
  }
  if (projects.length === 0) {
    throw new Error('"projects" array must contain at least one config entry')
  }

  return projects.map((entry: unknown, index: number) => parseProjectEntry(entry, index, opts))
}

/**
 * Run a per-project generation function over an array of configs sequentially.
 *
 * Single config: calls generateOne without a label (backward-compatible logging).
 * Multiple configs: calls generateOne with a "[i/N]" progress label for each,
 * logging per-project progress and failing fast with a clear error on any failure.
 *
 * This is the shared iteration kernel used by all generator packages to avoid
 * duplicating the sequential-loop, logging, and fail-fast error-wrapping logic.
 */
export async function runProjects<T extends BaseConfig>(
  configs: T[],
  generateOne: (config: T, label?: string) => Promise<void>
): Promise<void> {
  if (configs.length === 0) {
    throw new Error('runProjects requires at least one config entry')
  }

  if (configs.length === 1) {
    await generateOne(configs[0]!)
    return
  }

  for (let i = 0; i < configs.length; i++) {
    const label = `${i + 1}/${configs.length}`
    console.log(`\n[${label}] generating ${configs[i]!.input_openapi}...`)
    try {
      await generateOne(configs[i]!, label)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`[${label}] Project failed (${configs[i]!.input_openapi}): ${message}`)
    }
  }

  console.log(`\nAll ${configs.length} projects generated successfully.`)
}
