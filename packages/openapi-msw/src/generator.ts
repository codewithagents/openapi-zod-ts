import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { OpenAPIV3_1 } from 'openapi-types'
import { parseSpec } from 'openapi-zod-ts'
import { runProjects } from 'openapi-zod-ts/config-core'
import { loadConfigs, type MswConfig } from './config.js'
import { generateFixtures } from './plugins/fixtures.js'
import { generateHandlers, type GeneratedFile } from './plugins/handlers.js'

/** Build every file this config asks for: handlers.ts always, fixtures.ts when opted in. */
function buildFiles(spec: OpenAPIV3_1.Document, config: MswConfig): GeneratedFile[] {
  const shared = {
    seed: config.seed ?? 42,
    maxArrayItems: config.max_array_items ?? 3,
    depthCap: config.depth_cap ?? 30,
  }
  const handlers = generateHandlers(spec, { ...shared, baseUrl: config.base_url })
  if (config.fixtures !== true) return [handlers]
  const modelsImport = config.models_import ?? './models.js'
  return [handlers, generateFixtures(spec, { ...shared, modelsImport })]
}

/** Prettier-format a generated file with the project's own config, then write it. */
async function writeFormatted(outputDir: string, file: GeneratedFile): Promise<void> {
  const { format, resolveConfig } = await import('prettier')
  const filePath = join(outputDir, file.filename)
  const prettierConfig = await resolveConfig(filePath)
  const formatted = await format(file.content, { ...prettierConfig, parser: 'typescript' })
  await writeFile(filePath, formatted, 'utf-8')
}

async function generateOne(cwd: string, config: MswConfig, label?: string): Promise<void> {
  const log = (msg: string) => console.log(label === undefined ? msg : `[${label}] ${msg}`)
  const inputPath = resolve(cwd, config.input_openapi)
  log(`Parsing spec: ${inputPath}`)
  const files = buildFiles(await parseSpec(inputPath), config)

  const outputDir = resolve(cwd, config.output)
  await mkdir(outputDir, { recursive: true })
  for (const file of files) {
    await writeFormatted(outputDir, file)
    log(`✓ ${file.filename}`)
  }
}

export async function generate(cwd: string, configPath?: string): Promise<void> {
  await runProjects(await loadConfigs(cwd, configPath), (config, label) =>
    generateOne(cwd, config, label)
  )
}
