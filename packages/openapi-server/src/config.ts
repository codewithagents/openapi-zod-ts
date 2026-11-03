import {
  loadConfigFile,
  loadConfigsFile,
  validateConfigPath,
  validateInputPath,
  validateOutputPath,
} from 'openapi-zod-ts/config-core'

export { validateConfigPath, validateInputPath, validateOutputPath }

export interface ServerConfig {
  /** Path to the OpenAPI 3.1 spec file (JSON or YAML) */
  input_openapi: string
  /** Directory to write generated files */
  output: string
  /** Framework to generate a router for. Default: 'none' */
  framework?: 'hono' | 'express' | 'fastify' | 'none'
  /** Path to user-owned Zod schema file (same file as openapi-zod-ts's input_schema). Optional. */
  input_schema?: string
  /**
   * Optional TypeScript type name for a caller context threaded through every service method.
   * When set, the generated interface becomes `XService<Ctx = never>` and each method
   * receives a final `ctx: Ctx` argument. The generated router passes the framework's
   * native request/context object (Hono: c, Express: req, Fastify: req) as ctx.
   *
   * Example: `"context_type": "RequestContext"`
   */
  context_type?: string
  /**
   * Fastify only. When true, the generated router emits inline Zod response schema
   * expressions in schema.response for operations with flat inline response schemas.
   * Operations with $ref, allOf, oneOf, anyOf, or nested schemas fall back to z.unknown().
   *
   * Default: false. For best coverage, wire input_schema with your Zod schema file and let
   * the generator use the exact schemas you own.
   */
  emit_response_validation?: boolean
  /**
   * Override the directory where the shared runtime folder (`_shared/`) is written.
   * When omitted, the generator derives the shared location automatically:
   * for a single project the output dir itself is used, so shared = `<output>/_shared/`.
   * For multiple projects, the longest common parent directory of all output paths is used,
   * so shared = `<commonParent>/_shared/`.
   *
   * Use this override when your output dirs share no common parent or when you want
   * to consolidate the shared runtime at a specific location.
   */
  shared_output?: string
  /**
   * Namespace prefix for schema lookups in `input_schema`, for sharing ONE schemas file
   * across several specs (#334). When set, the router looks up `${spec_prefix}${Type}Schema`
   * (e.g. `PublicApiGetUserSchema`) instead of the bare `${Type}Schema`, and imports it
   * under the bare name. Unprefixed exports remain available as a fallback for schemas that
   * are genuinely shared between specs. Must be a valid identifier prefix (e.g. "PublicApi").
   * Has no effect without `input_schema`. Default: unset (bare names).
   */
  spec_prefix?: string
}

/** Validate that an optional config field is a non-empty string when present. */
function assertOptionalString(raw: Record<string, unknown>, key: string, label: string): void {
  if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !raw[key])) {
    throw new Error(`"${key}" must be a non-empty string ${label}`)
  }
}

function parseServerConfig(
  raw: Record<string, unknown>,
  base: import('openapi-zod-ts/config-core').BaseConfig
): ServerConfig {
  const framework = raw['framework']
  if (
    framework !== undefined &&
    framework !== 'hono' &&
    framework !== 'express' &&
    framework !== 'fastify' &&
    framework !== 'none'
  ) {
    throw new Error('"framework" must be one of: "hono", "express", "fastify", or "none"')
  }
  assertOptionalString(raw, 'input_schema', 'path to your Zod schema file')
  assertOptionalString(raw, 'context_type', 'TypeScript type name')
  assertOptionalString(raw, 'shared_output', 'path to the shared output directory')
  assertOptionalString(raw, 'spec_prefix', 'identifier prefix (e.g. "PublicApi")')
  if (
    raw['spec_prefix'] !== undefined &&
    !/^[A-Za-z_$][\w$]*$/.test(raw['spec_prefix'] as string)
  ) {
    throw new Error(
      '"spec_prefix" must be a valid TypeScript identifier prefix (letters, digits, _ or $; not starting with a digit)'
    )
  }
  if (
    raw['emit_response_validation'] !== undefined &&
    typeof raw['emit_response_validation'] !== 'boolean'
  ) {
    throw new Error('"emit_response_validation" must be a boolean (true or false)')
  }
  return {
    ...base,
    framework: framework as 'hono' | 'express' | 'fastify' | 'none' | undefined,
    input_schema: raw['input_schema'] as string | undefined,
    context_type: raw['context_type'] as string | undefined,
    emit_response_validation: raw['emit_response_validation'] as boolean | undefined,
    shared_output: raw['shared_output'] as string | undefined,
    spec_prefix: raw['spec_prefix'] as string | undefined,
  }
}

export async function loadConfig(cwd: string, configPath?: string): Promise<ServerConfig> {
  return loadConfigFile<ServerConfig>({
    cwd,
    configPath,
    defaultFileName: 'openapi-server.config.json',
    parse: parseServerConfig,
  })
}

/**
 * Load a config file and return all configs as a normalized array.
 *
 * Single-spec config: returns a one-element array.
 * Multi-spec config with "projects" key: returns N-element array.
 */
export async function loadConfigs(cwd: string, configPath?: string): Promise<ServerConfig[]> {
  return loadConfigsFile<ServerConfig>({
    cwd,
    configPath,
    defaultFileName: 'openapi-server.config.json',
    parse: parseServerConfig,
  })
}
