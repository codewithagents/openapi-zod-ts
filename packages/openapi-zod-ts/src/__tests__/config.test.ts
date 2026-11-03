// fallow-ignore-file code-duplication
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProjects } from '../config-core.js'
import {
  loadConfig,
  loadConfigs,
  validateConfigPath,
  validateOutputPath,
  validateInputPath,
  defineConfig,
  defineProjects,
} from '../config.js'

describe('loadConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openapi-zod-ts-config-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(content: unknown) {
    writeFileSync(join(tmpDir, 'openapi-zod-ts.config.json'), JSON.stringify(content))
  }

  it('loads a valid minimal config', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api' })
    const config = await loadConfig(tmpDir)
    expect(config.input_openapi).toBe('openapi.json')
    expect(config.output).toBe('src/api')
    expect(config.input_schema).toBeUndefined()
    expect(config.baseUrl).toBeUndefined()
  })

  it('loads a full config with all fields', async () => {
    writeConfig({
      input_openapi: 'api/openapi.json',
      input_schema: 'schemas.ts',
      output: 'src/generated',
      baseUrl: 'https://api.example.com',
    })
    const config = await loadConfig(tmpDir)
    expect(config.input_openapi).toBe('api/openapi.json')
    expect(config.input_schema).toBe('schemas.ts')
    expect(config.output).toBe('src/generated')
    expect(config.baseUrl).toBe('https://api.example.com')
  })

  it('throws when config file is missing', async () => {
    await expect(loadConfig(tmpDir)).rejects.toThrow('Config file not found')
  })

  it('throws when config is not valid JSON', async () => {
    writeFileSync(join(tmpDir, 'openapi-zod-ts.config.json'), 'not json {{{')
    await expect(loadConfig(tmpDir)).rejects.toThrow('not valid JSON')
  })

  it('throws when config is not an object', async () => {
    writeFileSync(join(tmpDir, 'openapi-zod-ts.config.json'), '"just a string"')
    await expect(loadConfig(tmpDir)).rejects.toThrow('JSON object')
  })

  it('throws when input_openapi is missing', async () => {
    writeConfig({ output: 'src/api' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('input_openapi')
  })

  it('throws when input_openapi is empty string', async () => {
    writeConfig({ input_openapi: '', output: 'src/api' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('input_openapi')
  })

  it('throws when output is missing', async () => {
    writeConfig({ input_openapi: 'openapi.json' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('output')
  })

  it('throws when input_schema is an empty string', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', input_schema: '' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('input_schema')
  })

  it('throws when server_client is not a boolean', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', server_client: 'yes' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('"server_client" must be a boolean')
  })

  it('loads split_by_tag and defaults it to undefined', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', split_by_tag: true })
    expect((await loadConfig(tmpDir)).split_by_tag).toBe(true)
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api' })
    expect((await loadConfig(tmpDir)).split_by_tag).toBeUndefined()
  })

  it('throws when split_by_tag is not a boolean', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', split_by_tag: 'yes' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('"split_by_tag" must be a boolean')
  })

  it('loads error_body_type field', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', error_body_type: 'laravel' })
    const config = await loadConfig(tmpDir)
    expect(config.error_body_type).toBe('laravel')
  })

  it('loads error_body_type with error_body_type_import', async () => {
    writeConfig({
      input_openapi: 'openapi.json',
      output: 'src/api',
      error_body_type: 'ApiErrorBody',
      error_body_type_import: './types/errors',
    })
    const config = await loadConfig(tmpDir)
    expect(config.error_body_type).toBe('ApiErrorBody')
    expect(config.error_body_type_import).toBe('./types/errors')
  })

  it('error_body_type and error_body_type_import are undefined when absent', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api' })
    const config = await loadConfig(tmpDir)
    expect(config.error_body_type).toBeUndefined()
    expect(config.error_body_type_import).toBeUndefined()
  })

  it('throws when error_body_type is an empty string', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', error_body_type: '' })
    await expect(loadConfig(tmpDir)).rejects.toThrow('"error_body_type" must be a non-empty string')
  })

  it('throws when error_body_type_import is an empty string', async () => {
    writeConfig({
      input_openapi: 'openapi.json',
      output: 'src/api',
      error_body_type: 'MyError',
      error_body_type_import: '',
    })
    await expect(loadConfig(tmpDir)).rejects.toThrow(
      '"error_body_type_import" must be a non-empty string'
    )
  })

  it('loads drift: error', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', drift: 'error' })
    const config = await loadConfig(tmpDir)
    expect(config.drift).toBe('error')
  })

  it('loads drift: warn', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', drift: 'warn' })
    const config = await loadConfig(tmpDir)
    expect(config.drift).toBe('warn')
  })

  it('drift is undefined when absent', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api' })
    const config = await loadConfig(tmpDir)
    expect(config.drift).toBeUndefined()
  })

  it('throws when drift is an invalid value', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', drift: 'throw' })
    await expect(loadConfig(tmpDir)).rejects.toThrow("\"drift\" must be 'error' or 'warn'")
  })

  it('throws when drift is a boolean', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', drift: true })
    await expect(loadConfig(tmpDir)).rejects.toThrow("\"drift\" must be 'error' or 'warn'")
  })

  it('ignores unknown config fields', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api', unknown_field: 'ignored' })
    const config = await loadConfig(tmpDir)
    expect(config.input_openapi).toBe('openapi.json')
  })

  it('accepts a config loaded via explicit configPath', async () => {
    const configFile = join(tmpDir, 'custom.config.json')
    writeFileSync(configFile, JSON.stringify({ input_openapi: 'openapi.json', output: 'src/api' }))
    const config = await loadConfig(tmpDir, configFile)
    expect(config.input_openapi).toBe('openapi.json')
    expect(config.output).toBe('src/api')
  })

  it('rejects explicit configPath that is not a supported extension', async () => {
    const configFile = join(tmpDir, 'config.ts')
    writeFileSync(configFile, JSON.stringify({ input_openapi: 'openapi.json', output: 'src/api' }))
    await expect(loadConfig(tmpDir, configFile)).rejects.toThrow('Config file must be a .json')
  })
})

describe('config security validation', () => {
  describe('validateConfigPath', () => {
    it('rejects non-supported config file extension (.ts)', () => {
      expect(() => validateConfigPath('/project/config.ts')).toThrow('Config file must be a .json')
    })

    it('rejects .yaml extension', () => {
      expect(() => validateConfigPath('/project/config.yaml')).toThrow(
        'Config file must be a .json'
      )
    })

    it('accepts .json extension', () => {
      expect(() => validateConfigPath('/project/config.json')).not.toThrow()
    })

    it('accepts nested .json path', () => {
      expect(() => validateConfigPath('/Users/someone/project/my-tool.config.json')).not.toThrow()
    })

    it('accepts .js extension', () => {
      expect(() => validateConfigPath('/project/openapi-zod-ts.config.js')).not.toThrow()
    })

    it('accepts .mjs extension', () => {
      expect(() => validateConfigPath('/project/openapi-zod-ts.config.mjs')).not.toThrow()
    })

    it('accepts .cjs extension', () => {
      expect(() => validateConfigPath('/project/openapi-zod-ts.config.cjs')).not.toThrow()
    })
  })

  describe('validateOutputPath', () => {
    it('rejects output path in /etc', () => {
      expect(() => validateOutputPath('/etc/generated')).toThrow('system directory')
    })

    it('rejects output path in /usr', () => {
      expect(() => validateOutputPath('/usr/local/generated')).toThrow('system directory')
    })

    it('rejects output path in /bin', () => {
      expect(() => validateOutputPath('/bin/generated')).toThrow('system directory')
    })

    it('rejects output path in /sys', () => {
      expect(() => validateOutputPath('/sys/something')).toThrow('system directory')
    })

    it('rejects output path in /proc', () => {
      expect(() => validateOutputPath('/proc/1/generated')).toThrow('system directory')
    })

    it('rejects output path in /dev', () => {
      expect(() => validateOutputPath('/dev/null')).toThrow('system directory')
    })

    it('rejects output path in /boot', () => {
      expect(() => validateOutputPath('/boot/generated')).toThrow('system directory')
    })

    it('rejects output path that is exactly /run', () => {
      expect(() => validateOutputPath('/run')).toThrow('system directory')
    })

    it('rejects output path under /run/', () => {
      expect(() => validateOutputPath('/run/lock/something')).toThrow('system directory')
    })

    it('does NOT reject /runner/_work/... (CI runner path)', () => {
      expect(() => validateOutputPath('/runner/_work/project/src/generated')).not.toThrow()
    })

    it('accepts normal project-relative resolved path', () => {
      expect(() => validateOutputPath('/Users/someone/project/generated')).not.toThrow()
    })

    it('accepts absolute path within home directory', () => {
      expect(() => validateOutputPath('/Users/someone/myproject/src/api')).not.toThrow()
    })

    it('accepts dist/api style path', () => {
      expect(() => validateOutputPath('/home/user/project/dist/api')).not.toThrow()
    })

    it('accepts GitHub Actions home runner output path', () => {
      expect(() =>
        validateOutputPath('/home/runner/work/my-repo/my-repo/src/generated')
      ).not.toThrow()
    })

    it('accepts GitLab runner build output path', () => {
      expect(() =>
        validateOutputPath('/var/lib/gitlab-runner/builds/project/src/generated')
      ).not.toThrow()
    })

    it('accepts common CI workspace output path', () => {
      expect(() => validateOutputPath('/workspace/project/src/generated')).not.toThrow()
    })
  })

  describe('validateInputPath', () => {
    it('rejects input spec from /proc', () => {
      expect(() => validateInputPath('/proc/1/fd/0')).toThrow('system directory')
    })

    it('rejects input spec from /etc', () => {
      expect(() => validateInputPath('/etc/passwd')).toThrow('system directory')
    })

    it('rejects input spec from /dev', () => {
      expect(() => validateInputPath('/dev/random')).toThrow('system directory')
    })

    it('rejects input spec from /usr', () => {
      expect(() => validateInputPath('/usr/share/openapi.json')).toThrow('system directory')
    })

    it('accepts input spec in home directory', () => {
      expect(() => validateInputPath('/Users/someone/project/openapi.json')).not.toThrow()
    })

    it('accepts input spec in /tmp', () => {
      expect(() => validateInputPath('/tmp/openapi.json')).not.toThrow()
    })

    it('accepts GitHub Actions home runner input path', () => {
      expect(() =>
        validateInputPath('/home/runner/work/my-repo/my-repo/spec/api.json')
      ).not.toThrow()
    })

    it('accepts common CI workspace input path', () => {
      expect(() => validateInputPath('/workspace/project/spec/openapi.json')).not.toThrow()
    })
  })
})

describe('defineConfig', () => {
  it('returns the same config object it receives', () => {
    const input = { input_openapi: './openapi.json', output: './src/api' }
    const result = defineConfig(input)
    expect(result).toBe(input)
  })

  it('preserves all config fields', () => {
    const input = {
      input_openapi: './openapi.json',
      output: './src/api',
      input_schema: './schemas.ts',
      baseUrl: 'https://api.example.com',
      server_client: true,
    }
    const result = defineConfig(input)
    expect(result).toEqual(input)
  })

  it('is a pure identity function', () => {
    const input = { input_openapi: 'spec.yaml', output: 'out' }
    expect(defineConfig(input)).toStrictEqual(input)
  })
})

describe('loadConfig JS files', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openapi-zod-ts-js-config-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads a .mjs config with default export', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.mjs')
    writeFileSync(
      configPath,
      `export default { input_openapi: 'openapi.json', output: 'src/api' }\n`
    )
    const config = await loadConfig(tmpDir, configPath)
    expect(config.input_openapi).toBe('openapi.json')
    expect(config.output).toBe('src/api')
  })

  it('loads a .js config with default export', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.js')
    writeFileSync(
      configPath,
      `export default { input_openapi: 'openapi.json', output: 'src/generated' }\n`
    )
    const config = await loadConfig(tmpDir, configPath)
    expect(config.input_openapi).toBe('openapi.json')
    expect(config.output).toBe('src/generated')
  })

  it('loads a .mjs config with all optional fields', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.mjs')
    writeFileSync(
      configPath,
      [
        'export default {',
        "  input_openapi: 'spec.yaml',",
        "  output: 'out',",
        "  input_schema: 'schemas.ts',",
        "  baseUrl: 'https://api.example.com',",
        '  server_client: true,',
        '}',
      ].join('\n')
    )
    const config = await loadConfig(tmpDir, configPath)
    expect(config.input_openapi).toBe('spec.yaml')
    expect(config.output).toBe('out')
    expect(config.input_schema).toBe('schemas.ts')
    expect(config.baseUrl).toBe('https://api.example.com')
    expect(config.server_client).toBe(true)
  })

  it('throws when JS config default export is missing required input_openapi', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.mjs')
    writeFileSync(configPath, `export default { output: 'src/api' }\n`)
    await expect(loadConfig(tmpDir, configPath)).rejects.toThrow('input_openapi')
  })

  it('throws when JS config default export is missing required output', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.mjs')
    writeFileSync(configPath, `export default { input_openapi: 'spec.json' }\n`)
    await expect(loadConfig(tmpDir, configPath)).rejects.toThrow('output')
  })

  it('throws when JS config file has a syntax error', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.mjs')
    writeFileSync(configPath, `export default { this is not valid JS }}\n`)
    await expect(loadConfig(tmpDir, configPath)).rejects.toThrow('Failed to load JS config file')
  })

  it('rejects .ts extension (TypeScript config not supported)', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.ts')
    writeFileSync(configPath, `export default { input_openapi: 'spec.json', output: 'out' }\n`)
    await expect(loadConfig(tmpDir, configPath)).rejects.toThrow('Config file must be a .json')
  })
})

describe('loadConfigs: projects array support', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openapi-zod-ts-multi-config-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeConfig(content: unknown) {
    writeFileSync(join(tmpDir, 'openapi-zod-ts.config.json'), JSON.stringify(content))
  }

  it('returns a one-element array for a single-spec config', async () => {
    writeConfig({ input_openapi: 'openapi.json', output: 'src/api' })
    const configs = await loadConfigs(tmpDir)
    expect(configs).toHaveLength(1)
    expect(configs[0]!.input_openapi).toBe('openapi.json')
    expect(configs[0]!.output).toBe('src/api')
  })

  it('returns N configs for a projects array with N entries', async () => {
    writeConfig({
      projects: [
        { input_openapi: 'services/users.json', output: 'src/users' },
        { input_openapi: 'services/orders.json', output: 'src/orders' },
      ],
    })
    const configs = await loadConfigs(tmpDir)
    expect(configs).toHaveLength(2)
    expect(configs[0]!.input_openapi).toBe('services/users.json')
    expect(configs[0]!.output).toBe('src/users')
    expect(configs[1]!.input_openapi).toBe('services/orders.json')
    expect(configs[1]!.output).toBe('src/orders')
  })

  it('parses optional fields in each project entry', async () => {
    writeConfig({
      projects: [
        {
          input_openapi: 'services/users.json',
          output: 'src/users',
          baseUrl: 'https://users.example.com',
          server_client: true,
        },
        { input_openapi: 'services/orders.json', output: 'src/orders' },
      ],
    })
    const configs = await loadConfigs(tmpDir)
    expect(configs[0]!.baseUrl).toBe('https://users.example.com')
    expect(configs[0]!.server_client).toBe(true)
    expect(configs[1]!.baseUrl).toBeUndefined()
  })

  it('parses drift field in each project entry', async () => {
    writeConfig({
      projects: [
        { input_openapi: 'services/users.json', output: 'src/users', drift: 'error' },
        { input_openapi: 'services/orders.json', output: 'src/orders', drift: 'warn' },
        { input_openapi: 'services/products.json', output: 'src/products' },
      ],
    })
    const configs = await loadConfigs(tmpDir)
    expect(configs[0]!.drift).toBe('error')
    expect(configs[1]!.drift).toBe('warn')
    expect(configs[2]!.drift).toBeUndefined()
  })

  it('throws when a project entry has an invalid drift value', async () => {
    writeConfig({
      projects: [{ input_openapi: 'services/users.json', output: 'src/users', drift: 'throw' }],
    })
    await expect(loadConfigs(tmpDir)).rejects.toThrow('projects[0]')
  })

  it('throws when both top-level input_openapi and projects are present', async () => {
    writeConfig({
      input_openapi: 'openapi.json',
      output: 'src/api',
      projects: [{ input_openapi: 'services/users.json', output: 'src/users' }],
    })
    await expect(loadConfigs(tmpDir)).rejects.toThrow(
      'Config cannot have both top-level "input_openapi"/"output" and a "projects" array'
    )
  })

  it('throws when projects is not an array', async () => {
    writeConfig({ projects: 'not-an-array' })
    await expect(loadConfigs(tmpDir)).rejects.toThrow('"projects" must be an array')
  })

  it('throws when projects array is empty', async () => {
    writeConfig({ projects: [] })
    await expect(loadConfigs(tmpDir)).rejects.toThrow(
      '"projects" array must contain at least one config entry'
    )
  })

  it('throws when a project entry is missing input_openapi', async () => {
    writeConfig({
      projects: [
        { input_openapi: 'services/users.json', output: 'src/users' },
        { output: 'src/orders' },
      ],
    })
    await expect(loadConfigs(tmpDir)).rejects.toThrow('projects[1]')
  })

  it('throws when a project entry is missing output', async () => {
    writeConfig({
      projects: [{ input_openapi: 'services/users.json' }],
    })
    await expect(loadConfigs(tmpDir)).rejects.toThrow('projects[0]')
  })

  it('throws when a project entry has an invalid optional field', async () => {
    writeConfig({
      projects: [
        {
          input_openapi: 'services/users.json',
          output: 'src/users',
          server_client: 'yes',
        },
      ],
    })
    await expect(loadConfigs(tmpDir)).rejects.toThrow('projects[0]')
  })

  it('works with a .mjs file exporting a projects array via defineProjects', async () => {
    const configPath = join(tmpDir, 'openapi-zod-ts.config.mjs')
    writeFileSync(
      configPath,
      [
        'export default {',
        '  projects: [',
        "    { input_openapi: 'services/alpha.json', output: 'src/alpha' },",
        "    { input_openapi: 'services/beta.json', output: 'src/beta' },",
        '  ],',
        '}',
      ].join('\n')
    )
    const configs = await loadConfigs(tmpDir, configPath)
    expect(configs).toHaveLength(2)
    expect(configs[0]!.input_openapi).toBe('services/alpha.json')
    expect(configs[1]!.input_openapi).toBe('services/beta.json')
  })
})

describe('defineProjects', () => {
  it('wraps configs in a projects key object', () => {
    const entries = [
      { input_openapi: './users.json', output: './src/users' },
      { input_openapi: './orders.json', output: './src/orders' },
    ]
    const result = defineProjects(entries)
    expect(result).toEqual({ projects: entries })
  })

  it('returns an object with projects referencing the same array', () => {
    const entries = [{ input_openapi: './spec.json', output: './out' }]
    const result = defineProjects(entries)
    expect(result.projects).toBe(entries)
  })
})

describe('runProjects', () => {
  it('calls generateOne without a label for a single-config array', async () => {
    const calls: Array<{ input: string; label: string | undefined }> = []
    const configs = [{ input_openapi: 'spec.json', output: 'out' }]
    await runProjects(configs, async (config, label) => {
      calls.push({ input: config.input_openapi, label })
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.label).toBeUndefined()
    expect(calls[0]!.input).toBe('spec.json')
  })

  it('calls generateOne with "[i/N]" labels for multi-config array in order', async () => {
    const calls: Array<{ input: string; label: string | undefined }> = []
    const configs = [
      { input_openapi: 'users.json', output: 'src/users' },
      { input_openapi: 'orders.json', output: 'src/orders' },
      { input_openapi: 'products.json', output: 'src/products' },
    ]
    await runProjects(configs, async (config, label) => {
      calls.push({ input: config.input_openapi, label })
    })
    expect(calls).toHaveLength(3)
    expect(calls[0]!.label).toBe('1/3')
    expect(calls[1]!.label).toBe('2/3')
    expect(calls[2]!.label).toBe('3/3')
    expect(calls.map((c) => c.input)).toEqual(['users.json', 'orders.json', 'products.json'])
  })

  it('fails fast with a labelled error when a project throws', async () => {
    const configs = [
      { input_openapi: 'users.json', output: 'src/users' },
      { input_openapi: 'orders.json', output: 'src/orders' },
      { input_openapi: 'products.json', output: 'src/products' },
    ]
    const completed: string[] = []
    await expect(
      runProjects(configs, async (config, label) => {
        if (config.input_openapi === 'orders.json') {
          throw new Error('parse error')
        }
        completed.push(config.input_openapi)
        void label
      })
    ).rejects.toThrow('[2/3] Project failed (orders.json): parse error')
    expect(completed).toEqual(['users.json'])
  })

  it('throws when configs array is empty', async () => {
    await expect(runProjects([], async () => {})).rejects.toThrow(
      'runProjects requires at least one config entry'
    )
  })
})
