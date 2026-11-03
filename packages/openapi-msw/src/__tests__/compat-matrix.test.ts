// fallow-ignore-file code-duplication
import { describe, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSpec } from 'openapi-zod-ts'
import { generateHandlers } from '../plugins/handlers.js'

const configsDir = resolve(import.meta.dirname, '../../../../examples/configs')

const cases = readdirSync(configsDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => {
    const config = JSON.parse(readFileSync(resolve(configsDir, f), 'utf-8')) as {
      input_openapi: string
    }
    const specPath = resolve(configsDir, config.input_openapi)
    return { name: f.replace('.json', ''), specPath }
  })

const DEFAULT_OPTS = { seed: 42, maxArrayItems: 3, depthCap: 30 }

describe.each(cases)(
  'compat: $name',
  ({ specPath }) => {
    it('generates handlers without throwing', async () => {
      const spec = await parseSpec(specPath)
      generateHandlers(spec, DEFAULT_OPTS)
    })
  },
  120_000
)
