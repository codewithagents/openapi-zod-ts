// fallow-ignore-file code-duplication
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, afterEach } from 'vitest'
import { loadConfig, loadConfigs } from '../config.js'

let tmpDir: string | undefined

afterEach(async () => {
  if (tmpDir) {
    const { rm } = await import('node:fs/promises')
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

async function writeConfig(
  obj: Record<string, unknown>
): Promise<{ cwd: string; configPath: string }> {
  tmpDir = await mkdtemp(join(tmpdir(), 'openapi-msw-config-test-'))
  const configPath = join(tmpDir, 'openapi-msw.config.json')
  await writeFile(configPath, JSON.stringify(obj), 'utf-8')
  return { cwd: tmpDir, configPath }
}

describe('loadConfig: valid config', () => {
  it('loads required fields with defaults', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
    })
    const config = await loadConfig(cwd, configPath)
    expect(config.input_openapi).toBe('spec.json')
    expect(config.output).toBe('generated')
    expect(config.seed).toBeUndefined()
    expect(config.max_array_items).toBeUndefined()
    expect(config.depth_cap).toBeUndefined()
  })

  it('loads optional fields when provided', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      seed: 0,
      max_array_items: 5,
      depth_cap: 10,
    })
    const config = await loadConfig(cwd, configPath)
    expect(config.seed).toBe(0)
    expect(config.max_array_items).toBe(5)
    expect(config.depth_cap).toBe(10)
  })
})

describe('loadConfig: invalid field values', () => {
  it('rejects non-integer seed', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      seed: 1.5,
    })
    await expect(loadConfig(cwd, configPath)).rejects.toThrow('"seed" must be an integer')
  })

  it('rejects negative seed', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      seed: -1,
    })
    await expect(loadConfig(cwd, configPath)).rejects.toThrow('"seed" must be >= 0')
  })

  it('rejects zero max_array_items', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      max_array_items: 0,
    })
    await expect(loadConfig(cwd, configPath)).rejects.toThrow('"max_array_items" must be >= 1')
  })

  it('rejects non-integer max_array_items', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      max_array_items: 2.5,
    })
    await expect(loadConfig(cwd, configPath)).rejects.toThrow(
      '"max_array_items" must be an integer'
    )
  })

  it('rejects zero depth_cap', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      depth_cap: 0,
    })
    await expect(loadConfig(cwd, configPath)).rejects.toThrow('"depth_cap" must be >= 1')
  })

  it('rejects non-integer depth_cap', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      depth_cap: 3.7,
    })
    await expect(loadConfig(cwd, configPath)).rejects.toThrow('"depth_cap" must be an integer')
  })
})

describe('loadConfigs: projects array support', () => {
  it('returns a one-element array for a single-spec config', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
    })
    const configs = await loadConfigs(cwd, configPath)
    expect(configs).toHaveLength(1)
    expect(configs[0]!.input_openapi).toBe('spec.json')
    expect(configs[0]!.output).toBe('generated')
  })

  it('returns N configs for a projects array with N entries', async () => {
    const { cwd, configPath } = await writeConfig({
      projects: [
        { input_openapi: 'services/users.json', output: 'mocks/users', seed: 1 },
        { input_openapi: 'services/orders.json', output: 'mocks/orders', seed: 2 },
      ],
    })
    const configs = await loadConfigs(cwd, configPath)
    expect(configs).toHaveLength(2)
    expect(configs[0]!.input_openapi).toBe('services/users.json')
    expect(configs[0]!.seed).toBe(1)
    expect(configs[1]!.input_openapi).toBe('services/orders.json')
    expect(configs[1]!.seed).toBe(2)
  })

  it('throws when both top-level input_openapi and projects are present', async () => {
    const { cwd, configPath } = await writeConfig({
      input_openapi: 'spec.json',
      output: 'generated',
      projects: [{ input_openapi: 'services/users.json', output: 'mocks/users' }],
    })
    await expect(loadConfigs(cwd, configPath)).rejects.toThrow(
      'Config cannot have both top-level "input_openapi"/"output" and a "projects" array'
    )
  })

  it('throws when projects is not an array', async () => {
    const { cwd, configPath } = await writeConfig({ projects: 'not-an-array' })
    await expect(loadConfigs(cwd, configPath)).rejects.toThrow('"projects" must be an array')
  })

  it('throws when projects is empty', async () => {
    const { cwd, configPath } = await writeConfig({ projects: [] })
    await expect(loadConfigs(cwd, configPath)).rejects.toThrow(
      '"projects" array must contain at least one config entry'
    )
  })

  it('throws with project index when a project entry is invalid', async () => {
    const { cwd, configPath } = await writeConfig({
      projects: [
        { input_openapi: 'services/users.json', output: 'mocks/users' },
        { input_openapi: 'services/orders.json', output: 'mocks/orders', seed: 1.5 },
      ],
    })
    await expect(loadConfigs(cwd, configPath)).rejects.toThrow('projects[1]')
  })
})
