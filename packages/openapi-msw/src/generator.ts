import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseSpec } from 'openapi-zod-ts'
import { runProjects } from 'openapi-zod-ts/config-core'
import { loadConfigs, type MswConfig } from './config.js'
import { generateHandlers } from './plugins/handlers.js'

async function formatTs(content: string, filePath: string): Promise<string> {
  const { format, resolveConfig } = await import('prettier')
  const config = await resolveConfig(filePath)
  return format(content, { ...config, parser: 'typescript' })
}

async function generateOne(cwd: string, config: MswConfig, label?: string): Promise<void> {
  const inputPath = resolve(cwd, config.input_openapi)
  const outputDir = resolve(cwd, config.output)
  const prefix = label !== undefined ? `[${label}] ` : ''

  console.log(`${prefix}Parsing spec: ${inputPath}`)
  const spec = await parseSpec(inputPath)

  const file = generateHandlers(spec, {
    seed: config.seed ?? 42,
    maxArrayItems: config.max_array_items ?? 3,
    depthCap: config.depth_cap ?? 30,
    baseUrl: config.base_url,
  })

  await mkdir(outputDir, { recursive: true })
  const filePath = join(outputDir, file.filename)
  await writeFile(filePath, await formatTs(file.content, filePath), 'utf-8')
  console.log(`${prefix}✓ ${file.filename}`)
}

export async function generate(cwd: string, configPath?: string): Promise<void> {
  const configs = await loadConfigs(cwd, configPath)
  await runProjects(configs, (config, label) => generateOne(cwd, config, label))
}
