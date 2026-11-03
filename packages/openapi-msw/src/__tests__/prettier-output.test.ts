// fallow-ignore-file code-duplication
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { check } from 'prettier'
import { describe, it, expect, afterEach } from 'vitest'
import { generate } from '../generator.js'

const taskApiFixture = join(import.meta.dirname, '../__fixtures__/specs/task-api.json')

let tmpDir: string | undefined

afterEach(async () => {
  if (tmpDir) {
    const { rm } = await import('node:fs/promises')
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

async function runGenerator(extra: Record<string, unknown> = {}): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), 'openapi-msw-prettier-test-'))
  const configPath = join(tmpDir, 'openapi-msw.config.json')
  const outDir = join(tmpDir, 'generated')
  await writeFile(
    configPath,
    JSON.stringify({ input_openapi: taskApiFixture, output: outDir, ...extra }),
    'utf-8'
  )
  await generate(tmpDir, configPath)
  return outDir
}

describe('generated output is Prettier-clean (task-api)', () => {
  it('handlers.ts is Prettier-clean', async () => {
    const outDir = await runGenerator()
    const content = await readFile(join(outDir, 'handlers.ts'), 'utf-8')
    expect(await check(content, { parser: 'typescript' })).toBe(true)
  })

  it('fixtures.ts is written only when fixtures: true, and is Prettier-clean', async () => {
    const outDir = await runGenerator({ fixtures: true })
    const content = await readFile(join(outDir, 'fixtures.ts'), 'utf-8')
    expect(content).toContain('export function aTask(')
    expect(await check(content, { parser: 'typescript' })).toBe(true)
  })

  it('does not write fixtures.ts by default', async () => {
    const outDir = await runGenerator()
    await expect(readFile(join(outDir, 'fixtures.ts'), 'utf-8')).rejects.toThrow()
  })
})
