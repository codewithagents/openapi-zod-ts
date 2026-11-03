import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { loadConfig, loadConfigs, type Config } from './config.js'
import { runProjects } from './config-core.js'
import { compareOutput, reportDrift } from './drift-check.js'
import { parseSpec } from './parser.js'
import { generateTypes } from './plugins/types.js'
import { generateClientConfig } from './plugins/client-config.js'
import {
  generateClientFiles,
  hasCookieAuth,
  detectAuthSchemes,
  SPLIT_CLIENT_DIR,
} from './plugins/client.js'
import { generateZodSchemas } from './plugins/zod.js'
import { generateIndexBarrel } from './plugins/index-barrel.js'
import { generateServer } from './plugins/server.js'
import { buildWritableVariantMap } from './utils/writable-variants.js'

/** Options accepted by generate(). */
export interface GenerateOptions {
  /** Path to config file. */
  configPath?: string
  /** Overrides config.input_openapi. Resolved from shell CWD before this call. */
  inputOverride?: string
  /** Overrides config.output. Resolved from shell CWD before this call. */
  outputOverride?: string
  /**
   * When true, run in read-only check mode: no files are written and any schema
   * drift is treated as an error (regardless of config.drift). Exits non-zero on drift.
   * Incompatible with watch mode.
   */
  check?: boolean
  /**
   * When true, overwrite the input_schema file with a fresh bootstrap from the spec
   * (the re-bootstrap remedy for drift). Drift is not gated on this run since the file
   * is being regenerated. Destructive: customizations in the schema file are replaced.
   */
  resetSchema?: boolean
  /**
   * When true, regenerate all output files in memory, compare them against committed
   * files on disk, and exit non-zero if any file is stale, missing, or extra. Nothing
   * is written to disk. Incompatible with watch mode.
   */
  checkDrift?: boolean
}

async function formatTs(content: string, filePath: string): Promise<string> {
  const { format, resolveConfig } = await import('prettier')
  const config = await resolveConfig(filePath)
  return format(content, { ...config, parser: 'typescript' })
}

/** Apply --input/--output overrides to an already-loaded config. */
function applyOverrides(config: Config, opts: GenerateOptions): Config {
  const result = { ...config }
  if (opts.inputOverride !== undefined) {
    result.input_openapi = opts.inputOverride
  }
  if (opts.outputOverride !== undefined) {
    result.output = opts.outputOverride
  }
  return result
}

/** Parameters for buildFinalOutputMap. */
interface BuildFinalOutputMapParams {
  generatedFiles: Array<{ filename: string; content: string }>
  serverFile: { filename: string; content: string } | undefined
  outputDir: string
  config: Config
  spec: Awaited<ReturnType<typeof parseSpec>>
  writableVariantMap: ReturnType<typeof buildWritableVariantMap>
  driftPlan: SchemaDriftPlan | undefined
  resetSchema: boolean
  cwd: string
}

/**
 * Build a Map of filename -> formatted content representing everything that belongs in
 * the output directory. This is the single authoritative source used by both the write
 * path and the --check-drift path so the two can never diverge.
 *
 * Inclusion rules:
 * - All base generated files (models.ts, client.ts, client-config.ts, index.ts).
 * - The server file when config.server_client is true.
 * - When input_schema is configured, the schema file already exists, and resetSchema is
 *   false, models.ts and client.ts are replaced with their schema-enhanced versions.
 *
 * The user-owned schema file (zod.ts / input_schema) is intentionally excluded: it is
 * bootstrapped once on first run and never overwritten by subsequent regenerations, so
 * it must not appear in the expected output set.
 */
async function buildFinalOutputMap(
  params: BuildFinalOutputMapParams
): Promise<Map<string, string>> {
  const {
    generatedFiles,
    serverFile,
    outputDir,
    config,
    spec,
    writableVariantMap,
    driftPlan,
    resetSchema,
    cwd,
  } = params
  const map = new Map<string, string>()

  for (const file of generatedFiles) {
    const filePath = join(outputDir, file.filename)
    map.set(file.filename, await formatTs(file.content, filePath))
  }

  if (serverFile !== undefined) {
    const serverFilePath = join(outputDir, serverFile.filename)
    map.set(serverFile.filename, await formatTs(serverFile.content, serverFilePath))
  }

  // When input_schema is configured, the schema file already exists, and we are not
  // resetting: replace models.ts and client.ts with schema-enhanced versions. This is
  // the exact condition that writeZodIntegration previously used to overwrite those
  // files on the write path; encoding it here ensures the drift-check path uses the
  // same enhanced content without any duplication.
  if (
    config.input_schema !== undefined &&
    driftPlan !== undefined &&
    driftPlan.schemaExists &&
    !resetSchema
  ) {
    const schemaPath = resolve(cwd, config.input_schema)
    const relPath = relative(outputDir, schemaPath)
    const schemaImportPath = (relPath.startsWith('.') ? '' : './') + relPath.replace(/\.ts$/, '.js')

    const enhancedTypes = generateTypes(
      spec,
      { schemaNames: driftPlan.exportedSchemas, schemaImportPath },
      writableVariantMap
    )
    const enhancedClientFiles = generateClientFiles(
      spec,
      {
        schemaNames: driftPlan.exportedSchemas,
        schemaImportPath,
        errorBodyType: config.error_body_type,
        errorBodyTypeImport: config.error_body_type_import,
        splitByTag: config.split_by_tag === true,
      },
      writableVariantMap
    )
    map.set(
      enhancedTypes.filename,
      await formatTs(enhancedTypes.content, join(outputDir, enhancedTypes.filename))
    )
    for (const file of enhancedClientFiles) {
      map.set(file.filename, await formatTs(file.content, join(outputDir, file.filename)))
    }
  }

  return map
}

/**
 * Run generation for a single resolved config. Used internally by generate()
 * for both single-spec and each project in a multi-spec config.
 * The optional label prefix is shown in log output when running multiple projects.
 */
// fallow-ignore-next-line complexity
async function generateOne(
  cwd: string,
  config: Config,
  opts: GenerateOptions,
  label?: string
): Promise<void> {
  // When overrides supply absolute paths, resolve them directly; otherwise resolve from cwd.
  const inputPath =
    opts.inputOverride !== undefined ? opts.inputOverride : resolve(cwd, config.input_openapi)
  const outputDir =
    opts.outputOverride !== undefined ? opts.outputOverride : resolve(cwd, config.output)

  const prefix = label !== undefined ? `[${label}] ` : ''

  console.log(`${prefix}Parsing spec: ${inputPath}`)
  const spec = await parseSpec(inputPath)

  // Build the writable-variant map exactly once so types.ts and client.ts share
  // the same computation. Both generators fall back to building it internally when
  // the map is not supplied (backward-compatible for direct callers).
  const writableVariantMap = buildWritableVariantMap(spec)

  const generatedFiles = []

  // Phase 1: always generate types
  generatedFiles.push(generateTypes(spec, undefined, writableVariantMap))

  // Phase 2: always generate client config, fetch client, and barrel index
  const cookieAuth = hasCookieAuth(spec)
  const authSchemes = detectAuthSchemes(spec)
  generatedFiles.push(
    generateClientConfig(
      cookieAuth ? { defaultCredentials: 'include', authSchemes } : { authSchemes }
    )
  )
  generatedFiles.push(
    ...generateClientFiles(
      spec,
      {
        errorBodyType: config.error_body_type,
        errorBodyTypeImport: config.error_body_type_import,
        splitByTag: config.split_by_tag === true,
      },
      writableVariantMap
    )
  )
  generatedFiles.push(generateIndexBarrel())

  const check = opts.check === true
  const resetSchema = opts.resetSchema === true
  const checkDrift = opts.checkDrift === true

  // Drift detection is a read-only pass that runs BEFORE any writes. This keeps
  // generation atomic: when a drift gate fails, the output directory is left
  // untouched rather than half-written. It also gives a single gate site.
  // --reset-schema is the remedy for drift, so it never gates: the schema file is
  // about to be re-bootstrapped from the spec anyway.
  let driftPlan: SchemaDriftPlan | undefined
  if (config.input_schema !== undefined) {
    const schemaPath = resolve(cwd, config.input_schema)
    driftPlan = await detectSchemaDrift(config, spec, schemaPath, check)
    for (const msg of driftPlan.driftMessages) {
      console.warn(`${prefix}Drift: ${msg}`)
    }
    if (driftPlan.driftMessages.length > 0 && !resetSchema && (check || config.drift === 'error')) {
      throw new Error(
        `Schema drift detected:\n${driftPlan.driftMessages.map((m) => `  - ${m}`).join('\n')}`
      )
    }
  }

  // Check mode is read-only: reaching here means no gated drift, so nothing to write.
  if (check) {
    console.log(`${prefix}Check mode: no drift detected, no files written.`)
    return
  }

  // Phase 3 (pre-write): build the optional server file so it can be included in the
  // expected set for --check-drift. We generate it here (before any disk I/O) so that
  // the drift check and the write path share exactly the same conditional logic.
  const serverFile = config.server_client === true ? generateServer(spec) : undefined

  // Build the canonical output map: filename -> formatted content. This is the single
  // source of truth for what belongs in the output directory. Both the write path and
  // the drift-check path consume this map, ensuring they can never diverge.
  // zod.ts (the user-owned schema file) is intentionally excluded: the generator
  // never overwrites it after the first bootstrap, so it must not be in the expected set.
  const outputMap = await buildFinalOutputMap({
    generatedFiles,
    serverFile,
    outputDir,
    config,
    spec,
    writableVariantMap,
    driftPlan,
    resetSchema,
    cwd,
  })

  // Output drift check: regenerate in memory, compare against committed files on disk.
  // This runs BEFORE any mkdir/writeFile so the output directory is left untouched on
  // failure.
  if (checkDrift) {
    const report = await compareOutput(outputMap, outputDir)
    const isGithubActions = process.env['GITHUB_ACTIONS'] === 'true'
    const configDesc = opts.configPath !== undefined ? `--config ${opts.configPath}` : ''
    const fixCommand = ['openapi-zod-ts', configDesc].filter(Boolean).join(' ')
    const relativeOutputDir = relative(process.cwd(), outputDir)
    const { exitCode } = reportDrift(report, {
      github: isGithubActions,
      fixCommand,
      outputDir: relativeOutputDir,
    })
    if (exitCode !== 0) {
      throw new Error(
        `${prefix}Output drift detected: generated files do not match what is committed. ` +
          `Run '${fixCommand}' and commit the result.`
      )
    }
    return
  }

  console.log(`${prefix}Writing output to: ${outputDir}`)
  await mkdir(outputDir, { recursive: true })

  for (const [filename, content] of outputMap) {
    const filePath = join(outputDir, filename)
    // Split clients (split_by_tag) write into a client/ subdirectory.
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf-8')
    console.log(`${prefix}  ✓ ${filename}`)
  }

  if (config.split_by_tag === true) {
    await pruneStaleSplitModules(outputDir, outputMap, prefix)
  }

  // Phase 4: Zod integration (bootstrap on first run; schema-enhanced files are
  // already in outputMap and written above by the write loop).
  if (config.input_schema !== undefined && driftPlan !== undefined) {
    await writeZodIntegration(cwd, config, spec, prefix, driftPlan, resetSchema)
  }

  console.log(`${prefix}Done! Generated ${outputMap.size} file(s).`)
}

/**
 * Delete per-tag client modules left behind by a previous split_by_tag run (e.g. a tag
 * that was renamed or removed from the spec), so the barrel never re-exports stale code.
 * Only files that carry the generator's header are removed; anything a user put in the
 * client/ directory by hand is left alone.
 */
async function pruneStaleSplitModules(
  outputDir: string,
  outputMap: Map<string, string>,
  prefix: string
): Promise<void> {
  const splitDir = join(outputDir, SPLIT_CLIENT_DIR)
  const entries = await readdir(splitDir, { withFileTypes: true })
  for (const entry of entries) {
    const key = `${SPLIT_CLIENT_DIR}/${entry.name}`
    if (!entry.isFile() || !entry.name.endsWith('.ts') || outputMap.has(key)) continue
    const filePath = join(splitDir, entry.name)
    const content = await readFile(filePath, 'utf-8')
    if (!content.startsWith('// This file is auto-generated by openapi-zod-ts')) continue
    await unlink(filePath)
    console.log(`${prefix}  ✗ ${key} (removed: no longer produced)`)
  }
}

/** Result of the read-only drift detection pass. */
interface SchemaDriftPlan {
  /** Whether the user-owned input_schema file already exists on disk. */
  schemaExists: boolean
  /** Schema export names found in the input_schema file (empty when it does not exist). */
  exportedSchemas: Set<string>
  /** Human-readable drift signals (without prefix); empty when the contract is in sync. */
  driftMessages: string[]
}

/**
 * Read-only drift detection between the OpenAPI spec and the user-owned input_schema
 * file. Writes nothing. The two gated signals are a missing component schema and a
 * missing synthesized inline-response schema. Extra exports are intentionally allowed
 * (users add their own FE-only or BE-only refinements). A missing schema file is only
 * drift in check mode (otherwise it is a normal first-run bootstrap).
 */
// fallow-ignore-next-line complexity
async function detectSchemaDrift(
  config: Config,
  spec: Awaited<ReturnType<typeof parseSpec>>,
  schemaPath: string,
  check: boolean
): Promise<SchemaDriftPlan> {
  let schemaExists = false
  try {
    await access(schemaPath)
    schemaExists = true
  } catch {
    // file does not exist
  }

  const exportedSchemas = new Set<string>()
  const driftMessages: string[] = []

  if (!schemaExists) {
    if (check) {
      driftMessages.push(
        `input_schema file ${config.input_schema} does not exist; run generate to bootstrap it`
      )
    }
    return { schemaExists, exportedSchemas, driftMessages }
  }

  const content = await readFile(schemaPath, 'utf-8')
  for (const match of content.matchAll(/^export\s+const\s+(\w+Schema)\b/gm)) {
    exportedSchemas.add(match[1]!)
  }

  // The expected schema set is exactly what a fresh bootstrap would emit, so the
  // checker and the bootstrapper stay in lockstep: a file produced by --reset-schema
  // always passes --check. Deriving expectations from generateZodSchemas() (rather than
  // re-deriving them from spec.components plus synthesized names) avoids flagging schemas
  // the bootstrapper intentionally inlines (e.g. discriminated-union members) or does
  // not synthesize. Extra user exports remain allowed (FE-only or BE-only refinements).
  const bootstrapped = generateZodSchemas(spec).content
  for (const match of bootstrapped.matchAll(/^export\s+const\s+(\w+Schema)\b/gm)) {
    const schemaName = match[1]!
    if (!exportedSchemas.has(schemaName)) {
      driftMessages.push(
        `${schemaName} is in the OpenAPI contract but not found in ${config.input_schema}. Run with --reset-schema to re-bootstrap.`
      )
    }
  }

  return { schemaExists, exportedSchemas, driftMessages }
}

/**
 * Write the Zod integration schema file. Only called in non-check, non-drift-check mode
 * after the drift gate has passed. On first run it bootstraps the input_schema file
 * (write once, never overwritten thereafter). The schema-enhanced models.ts and client.ts
 * are handled by buildFinalOutputMap and written by the output map write loop above.
 */
async function writeZodIntegration(
  cwd: string,
  config: Config,
  spec: Awaited<ReturnType<typeof parseSpec>>,
  prefix: string,
  plan: SchemaDriftPlan,
  resetSchema: boolean
): Promise<void> {
  const schemaPath = resolve(cwd, config.input_schema!)

  if (!plan.schemaExists || resetSchema) {
    // First run bootstraps the schema file (write once). --reset-schema force-rewrites
    // an existing file from the spec, which is how a user clears reported drift. Either
    // way the schema-enhanced regeneration of models/client happens on the next run,
    // against the freshly written file.
    const zodFile = generateZodSchemas(spec)
    await writeFile(schemaPath, zodFile.content, 'utf-8')
    console.log(
      resetSchema && plan.schemaExists
        ? `${prefix}  ✓ ${config.input_schema} (reset: re-bootstrapped from the spec, customizations overwritten)`
        : `${prefix}  ✓ ${config.input_schema} (bootstrapped: edit freely, won't be overwritten)`
    )
    return
  }

  console.log(`${prefix}Skipping ${config.input_schema}: already exists (edit freely, it's yours).`)
}

// fallow-ignore-next-line complexity
export async function generate(cwd: string, opts?: GenerateOptions | string): Promise<void> {
  // Back-compat: accept a plain configPath string as second arg (old call sites).
  const options: GenerateOptions = typeof opts === 'string' ? { configPath: opts } : (opts ?? {})

  console.log('Loading config...')

  // When --input AND --output are both provided we can skip loading a config file entirely.
  const skipConfig =
    options.inputOverride !== undefined &&
    options.outputOverride !== undefined &&
    options.configPath === undefined

  if (skipConfig) {
    const config: Config = {
      input_openapi: options.inputOverride as string,
      output: options.outputOverride as string,
    }
    await generateOne(cwd, config, options)
    return
  }

  // Overrides are incompatible with multi-spec "projects" array configs. When overrides
  // are present we fall back to single-spec loading so overrides apply to a single config.
  const hasOverrides = options.inputOverride !== undefined || options.outputOverride !== undefined

  if (hasOverrides) {
    const config = applyOverrides(await loadConfig(cwd, options.configPath), options)
    await generateOne(cwd, config, options)
    return
  }

  // No overrides: use the normalized loadConfigs API to support both single-spec
  // and multi-spec ("projects" array) configs uniformly.
  const configs = await loadConfigs(cwd, options.configPath)
  await runProjects(configs, (config, label) => generateOne(cwd, config, options, label))
}
