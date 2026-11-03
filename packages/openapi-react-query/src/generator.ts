import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseSpec } from 'openapi-zod-ts'
import { runProjects } from 'openapi-zod-ts/config-core'
import { loadConfigs, type ReactQueryConfig } from './config.js'
import { generateHooks } from './plugins/hooks.js'
import { generateTestUtils } from './plugins/test-utils.js'

async function formatTs(content: string, filePath: string): Promise<string> {
  const { format, resolveConfig } = await import('prettier')
  const config = await resolveConfig(filePath)
  return format(content, { ...config, parser: 'typescript' })
}

/** Convert snake_case config overrides to the camelCase options expected by generateHooks. */
function buildOverrides(
  config: ReactQueryConfig,
  globalStaleTime: number,
  globalGcTime: number
): Record<string, { staleTime: number; gcTime: number }> | undefined {
  if (!config.overrides) return undefined
  const overrides: Record<string, { staleTime: number; gcTime: number }> = {}
  for (const [resource, timing] of Object.entries(config.overrides)) {
    overrides[resource] = {
      staleTime: timing.stale_time ?? globalStaleTime,
      gcTime: timing.gc_time ?? globalGcTime,
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined
}

async function generateOne(cwd: string, config: ReactQueryConfig, label?: string): Promise<void> {
  const inputPath = resolve(cwd, config.input_openapi)
  const outputDir = resolve(cwd, config.output)
  const prefix = label !== undefined ? `[${label}] ` : ''

  console.log(`${prefix}Parsing spec: ${inputPath}`)
  const spec = await parseSpec(inputPath)
  const globalStaleTime = config.stale_time ?? 0
  const globalGcTime = config.gc_time ?? 300_000
  const overrides = buildOverrides(config, globalStaleTime, globalGcTime)

  const files = [
    generateHooks(spec, {
      staleTime: globalStaleTime,
      gcTime: globalGcTime,
      suspense: config.suspense,
      overrides,
      autoInvalidate: config.auto_invalidate,
      infiniteQuery: config.infinite_query,
      typedErrors: config.typed_errors,
    }),
    generateTestUtils(spec),
  ]

  await mkdir(outputDir, { recursive: true })
  for (const file of files) {
    const filePath = join(outputDir, file.filename)
    await writeFile(filePath, await formatTs(file.content, filePath), 'utf-8')
    console.log(`${prefix}✓ ${file.filename}`)
  }
}

export async function generate(cwd: string, configPath?: string): Promise<void> {
  const configs = await loadConfigs(cwd, configPath)
  await runProjects(configs, (config, label) => generateOne(cwd, config, label))
}
