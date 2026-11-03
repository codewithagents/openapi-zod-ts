import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { parseSpec } from 'openapi-zod-ts'
import { runProjects } from 'openapi-zod-ts/config-core'
import { loadConfigs, type ServerConfig } from './config.js'
import { generateService, type ServiceOptions } from './plugins/service.js'
import { generateFastifyTypes, generateFastifyTypedService } from './plugins/fastify-service.js'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from './plugins/router.js'
import {
  emitSharedErrorsFile,
  deriveSharedDir,
  sharedErrorsImportPath,
} from './plugins/errors-emitter.js'

async function formatTs(content: string, filePath: string): Promise<string> {
  const { format, resolveConfig } = await import('prettier')
  const config = await resolveConfig(filePath)
  return format(content, { ...config, parser: 'typescript' })
}

/** Shared base options accepted by all three router generators. */
interface BaseRouterOptions {
  schemaNames?: Set<string>
  schemaImportPath?: string
  contextType?: string
  /** Relative path from the generated router.ts to the shared _shared/errors.js module. */
  errorsImportPath?: string
}

/** Extended options for the Fastify zero-cast path. */
interface FastifyRouterOptions extends BaseRouterOptions {
  zeroCast?: boolean
  /** Forward emit_response_validation config opt-in to the Fastify emitter. */
  emitResponseValidation?: boolean
}

/** Pick the framework-specific router generator for a first or second pass. */
function buildRouterFile(
  spec: Awaited<ReturnType<typeof parseSpec>>,
  framework: 'hono' | 'express' | 'fastify',
  options?: FastifyRouterOptions
): ReturnType<typeof generateRouter> {
  if (framework === 'hono') return generateRouter(spec, options)
  if (framework === 'express') return generateExpressRouter(spec, options)
  return generateFastifyRouter(spec, options)
}

// fallow-ignore-next-line complexity
async function generateOne(
  cwd: string,
  config: ServerConfig,
  sharedDir: string,
  label?: string
): Promise<void> {
  const inputPath = resolve(cwd, config.input_openapi)
  const outputDir = resolve(cwd, config.output)
  const framework = config.framework ?? 'none'
  const prefix = label !== undefined ? `[${label}] ` : ''

  console.log(`${prefix}Parsing spec: ${inputPath}`)
  const spec = await parseSpec(inputPath)

  // Compute the relative path from this router's outputDir to the shared errors module.
  const errorsImportPath = sharedErrorsImportPath(outputDir, sharedDir)

  const serviceOptions: ServiceOptions | undefined =
    config.context_type !== undefined ? { contextType: config.context_type } : undefined
  const generatedFiles = [generateService(spec, serviceOptions)]

  if (framework !== 'none') {
    generatedFiles.push(
      buildRouterFile(spec, framework, {
        contextType: config.context_type,
        emitResponseValidation: config.emit_response_validation === true,
        errorsImportPath,
      })
    )
  }

  console.log(`${prefix}Writing output to: ${outputDir}`)
  await mkdir(outputDir, { recursive: true })

  for (const file of generatedFiles) {
    const filePath = join(outputDir, file.filename)
    await writeFile(filePath, await formatTs(file.content, filePath), 'utf-8')
    console.log(`${prefix}  ✓ ${file.filename}`)
  }

  // Second pass: if input_schema is configured and file exists, re-generate router with Zod validation
  if (framework !== 'none' && config.input_schema !== undefined) {
    await generateSchemaEnhancedRouter(cwd, config, spec, framework, outputDir, sharedDir, prefix)
  }

  console.log(`${prefix}Done! Generated ${generatedFiles.length} file(s).`)
}

async function generateSchemaEnhancedRouter(
  cwd: string,
  config: ServerConfig,
  spec: Awaited<ReturnType<typeof parseSpec>>,
  framework: 'hono' | 'express' | 'fastify',
  outputDir: string,
  sharedDir: string,
  prefix: string
): Promise<void> {
  const schemaPath = resolve(cwd, config.input_schema!)
  let schemaContent: string
  try {
    schemaContent = await readFile(schemaPath, 'utf-8')
  } catch {
    console.log(`${prefix}  input_schema not found at ${schemaPath}, skipping Zod validation`)
    return
  }

  // Extract exported schema names from the schema file
  const exportedSchemas = new Set<string>()
  for (const match of schemaContent.matchAll(/^export\s+const\s+(\w+Schema)\b/gm)) {
    exportedSchemas.add(match[1]!)
  }

  if (exportedSchemas.size === 0) return

  // Compute relative import path from outputDir to schemaPath
  const relPath = relative(outputDir, schemaPath).replace(/\\/g, '/')
  const schemaImportPath = relPath.startsWith('.') ? relPath : `./${relPath}`
  const schemaImportPathJs = schemaImportPath.replace(/\.ts$/, '.js')

  // Compute the relative path from this router's outputDir to the shared errors module.
  const errorsImportPath = sharedErrorsImportPath(outputDir, sharedDir)

  // For Fastify: emit schema-types.ts (z.infer aliases) and re-emit service.ts using those
  // aliases. This enables the zero-cast router path where req.body and service params align.
  if (framework === 'fastify') {
    const schemaTypesFile = generateFastifyTypes(exportedSchemas, schemaImportPathJs)
    const schemaTypesPath = join(outputDir, schemaTypesFile.filename)
    await writeFile(
      schemaTypesPath,
      await formatTs(schemaTypesFile.content, schemaTypesPath),
      'utf-8'
    )
    console.log(
      `${prefix}  ✓ schema-types.ts (z.infer aliases for ${exportedSchemas.size} schema(s))`
    )

    const fastifyServiceFile = generateFastifyTypedService(spec, {
      schemaNames: exportedSchemas,
      schemaImportPath: schemaImportPathJs,
      contextType: config.context_type,
    })
    const fastifyServicePath = join(outputDir, fastifyServiceFile.filename)
    await writeFile(
      fastifyServicePath,
      await formatTs(fastifyServiceFile.content, fastifyServicePath),
      'utf-8'
    )
    console.log(`${prefix}  ✓ service.ts (Fastify-typed, imports from schema-types.js)`)

    const routerFile = buildRouterFile(spec, framework, {
      schemaNames: exportedSchemas,
      schemaImportPath: schemaImportPathJs,
      zeroCast: true,
      contextType: config.context_type,
      emitResponseValidation: config.emit_response_validation === true,
      errorsImportPath,
    })
    const routerPath = join(outputDir, routerFile.filename)
    await writeFile(routerPath, await formatTs(routerFile.content, routerPath), 'utf-8')
    console.log(`${prefix}  ✓ router.ts (Fastify zero-cast, ${exportedSchemas.size} schema(s))`)
    return
  }

  const routerFile = buildRouterFile(spec, framework, {
    schemaNames: exportedSchemas,
    schemaImportPath: schemaImportPathJs,
    contextType: config.context_type,
    errorsImportPath,
  })
  const routerPath = join(outputDir, routerFile.filename)
  await writeFile(routerPath, await formatTs(routerFile.content, routerPath), 'utf-8')
  console.log(`${prefix}  ✓ router.ts (with Zod validation for ${exportedSchemas.size} schema(s))`)
}

export async function generate(cwd: string, configPath?: string): Promise<void> {
  console.log('Loading config...')
  const configs = await loadConfigs(cwd, configPath)

  // Derive the shared directory once for all projects in this run.
  const sharedDir = deriveSharedDir(cwd, configs)

  // Emit _shared/errors.ts once per generation run.
  const sharedFile = emitSharedErrorsFile()
  const sharedFilePath = join(sharedDir, 'errors.ts')
  await mkdir(sharedDir, { recursive: true })
  await writeFile(sharedFilePath, await formatTs(sharedFile.content, sharedFilePath), 'utf-8')
  console.log(`  ✓ _shared/errors.ts (shared HttpError class)`)

  await runProjects(configs, (config, label) => generateOne(cwd, config, sharedDir, label))
}
