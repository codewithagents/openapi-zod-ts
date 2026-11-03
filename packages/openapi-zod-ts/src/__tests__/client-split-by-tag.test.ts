/**
 * Opt-in tag-based client splitting (config `split_by_tag: true`, #196).
 *
 * Covers: tag -> module-name sanitization, the generated file set, operation placement
 * (first tag wins, untagged -> default), the client.ts barrel, import rebasing for the
 * client/ subdirectory, strict compilation of the whole split output, and the generate()
 * write / prune / --check-drift paths against a real temp directory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseSpec } from '../parser.js'
import { generateClient, generateClientFiles, tagToModuleName } from '../plugins/client.js'
import { generateClientConfig } from '../plugins/client-config.js'
import { generateTypes } from '../plugins/types.js'
import { generateIndexBarrel } from '../plugins/index-barrel.js'
import { generateServer } from '../plugins/server.js'
import { generate } from '../generator.js'
import { compareOutput } from '../drift-check.js'
import { assertNoTsDiagnostics, compileFiles } from './helpers.js'

const fixturePath = join(import.meta.dirname, '../__fixtures__/specs/tagged-api.json')
const spec = await parseSpec(fixturePath)

function filesByName(files: { filename: string; content: string }[]): Map<string, string> {
  return new Map(files.map((f) => [f.filename, f.content]))
}

describe('tagToModuleName', () => {
  it.each([
    [undefined, 'default'],
    ['pets', 'pets'],
    ['Pets', 'pets'],
    ['Store Orders', 'store-orders'],
    ['userAccounts', 'user-accounts'],
    ['user_accounts', 'user-accounts'],
    ['  --Weird!!Tag--  ', 'weird-tag'],
    ['v2 API', 'v2-api'],
    ['Default', 'default'],
    ['', 'default'],
    ['日本語', 'default'],
    ['../../etc', 'etc'],
    ['CON', 'con-tag'],
    ['lpt1', 'lpt1-tag'],
  ])('%j -> %s', (tag, expected) => {
    expect(tagToModuleName(tag)).toBe(expected)
  })

  it('never produces the reserved runtime module name or path separators', () => {
    for (const tag of ['_runtime', '/runtime', 'a/b\\c', '.hidden']) {
      const name = tagToModuleName(tag)
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(name.startsWith('_')).toBe(false)
    }
  })
})

describe('generateClientFiles: default (no split)', () => {
  it('returns exactly the single client.ts that generateClient produces', () => {
    const files = generateClientFiles(spec)
    expect(files).toHaveLength(1)
    expect(files[0]).toEqual(generateClient(spec))
  })

  it('splitByTag: false is the same as omitting it', () => {
    expect(generateClientFiles(spec, { splitByTag: false })).toEqual(generateClientFiles(spec))
  })
})

describe('generateClientFiles: splitByTag', () => {
  const files = filesByName(generateClientFiles(spec, { splitByTag: true }))

  it('emits the barrel, the shared runtime and one module per tag (+ default)', () => {
    expect([...files.keys()]).toEqual([
      'client.ts',
      'client/_runtime.ts',
      'client/default.ts',
      'client/pets.ts',
      'client/store-orders.ts',
      'client/user-accounts.ts',
    ])
  })

  it('places operations by first tag; untagged operations go to default', () => {
    const pets = files.get('client/pets.ts')!
    expect(pets).toContain('export async function listPets(')
    expect(pets).toContain('export async function createPet(')
    // getPet is tagged [pets, Store Orders]: the first tag wins.
    expect(pets).toContain('export async function getPet(')
    expect(pets).toContain('export async function deletePet(')
    expect(pets).toContain('export async function uploadPetPhoto(')

    const orders = files.get('client/store-orders.ts')!
    expect(orders).toContain('export async function listOrders(')
    expect(orders).toContain('export async function placeOrder(')
    expect(orders).not.toContain('getPet')

    expect(files.get('client/user-accounts.ts')).toContain('export async function getMyAccount(')
    expect(files.get('client/default.ts')).toContain('export async function getHealth(')
  })

  it('client.ts is a barrel re-exporting the runtime and every tag module', () => {
    const barrel = files.get('client.ts')!
    expect(barrel).toContain("export { ApiError } from './client/_runtime.js'")
    for (const mod of ['default', 'pets', 'store-orders', 'user-accounts']) {
      expect(barrel).toContain(`export * from './client/${mod}.js'`)
    }
    // No function bodies, and the private helpers are never re-exported.
    expect(barrel).not.toContain('function')
    expect(barrel).not.toContain('_request')
  })

  it('the runtime holds ApiError and exports the request helpers once', () => {
    const runtime = files.get('client/_runtime.ts')!
    expect(runtime).toContain('export class ApiError')
    expect(runtime).toContain('export async function _request(')
    expect(runtime).toContain('export async function _requestForm(')
    expect(runtime).toContain("import { getConfig, type ClientConfig } from '../client-config.js'")
    for (const [name, content] of files) {
      if (name === 'client/_runtime.ts') continue
      expect(content).not.toContain('class ApiError')
      expect(content).not.toContain('function _request')
    }
  })

  it('tag modules import only what they use, from rebased paths', () => {
    const pets = files.get('client/pets.ts')!
    // Error (the 422 body) is imported for the additive CreatePetError alias (#195).
    expect(pets).toContain("import type { Error, Pet, PetWritable } from '../models.js'")
    expect(pets).toContain("import type { ClientConfig } from '../client-config.js'")
    expect(pets).toContain("import { type ApiError, _request, _requestForm } from './_runtime.js'")

    const orders = files.get('client/store-orders.ts')!
    expect(orders).toContain("import type { Order } from '../models.js'")
    expect(orders).toContain("import { _request } from './_runtime.js'")
    expect(orders).not.toContain('Pet')

    // default.ts only returns text: no models import at all.
    expect(files.get('client/default.ts')).not.toContain('models.js')
  })

  it('split function bodies are identical to the single-file function bodies', () => {
    const single = generateClient(spec).content
    const start = single.indexOf('export async function listOrders(')
    const end = single.indexOf('\n}\n', start) + 2
    expect(files.get('client/store-orders.ts')).toContain(single.slice(start, end))
  })

  it('the full split output compiles under tsc --strict (with index.ts and server.ts)', () => {
    const diagnostics = compileFiles({
      'models.ts': generateTypes(spec).content,
      'client-config.ts': generateClientConfig({}).content,
      'index.ts': generateIndexBarrel().content,
      'server.ts': generateServer(spec).content,
      ...Object.fromEntries(files),
      'consumer.ts': [
        "import { listPets, getHealth, ApiError, configureClient } from './index.js'",
        "import { listOrders } from './client/store-orders.js'",
        "import type { Pet } from './models.js'",
        "configureClient({ baseUrl: 'https://api.example.test' })",
        'export async function run(): Promise<number> {',
        '  try {',
        '    const pets: Pet[] = await listPets({ limit: 1 })',
        '    const orders = await listOrders()',
        '    const health: string = await getHealth()',
        '    return pets.length + orders.length + health.length',
        '  } catch (err) {',
        '    if (err instanceof ApiError) return err.status',
        '    throw err',
        '  }',
        '}',
      ].join('\n'),
    })
    assertNoTsDiagnostics(diagnostics, 'split_by_tag output')
  }, 30_000)

  it('a spec with no operations emits just the barrel and a runtime without helpers', () => {
    const empty = filesByName(
      generateClientFiles(
        { openapi: '3.1.0', info: { title: 'Empty', version: '1' }, paths: {} },
        { splitByTag: true }
      )
    )
    expect([...empty.keys()]).toEqual(['client.ts', 'client/_runtime.ts'])
    expect(empty.get('client/_runtime.ts')).not.toContain('_request')
    expect(empty.get('client/_runtime.ts')).not.toContain('client-config')
    assertNoTsDiagnostics(compileFiles({ ...Object.fromEntries(empty) }), 'empty split output')
  }, 30_000)
})

describe('generateClientFiles: splitByTag import rebasing', () => {
  it('rebases a relative schemaImportPath for tag modules', () => {
    const files = filesByName(
      generateClientFiles(spec, {
        splitByTag: true,
        schemaNames: new Set(['PetSchema', 'OrderSchema']),
        schemaImportPath: './zod.js',
      })
    )
    const pets = files.get('client/pets.ts')!
    expect(pets).toContain("import { z } from 'zod'")
    expect(pets).toContain("import { PetSchema } from '../zod.js'")
    expect(pets).toContain('return z.array(PetSchema).parse(await res.json())')
    expect(files.get('client/store-orders.ts')).toContain("import { OrderSchema } from '../zod.js'")
    // listOrders parses an array response, so store-orders needs z as well.
    expect(files.get('client/store-orders.ts')).toContain("import { z } from 'zod'")
    // Modules that use no schema get no schema import.
    expect(files.get('client/user-accounts.ts')).not.toMatch(/from '(zod|\.\.\/zod\.js)'/)
  })

  it('rebases a ../ schemaImportPath one more level', () => {
    const files = filesByName(
      generateClientFiles(spec, {
        splitByTag: true,
        schemaNames: new Set(['OrderSchema']),
        schemaImportPath: '../schemas/zod.js',
      })
    )
    expect(files.get('client/store-orders.ts')).toContain(
      "import { OrderSchema } from '../../schemas/zod.js'"
    )
  })

  it('rebases a relative error_body_type_import in the runtime; keeps package specifiers', () => {
    const relative = filesByName(
      generateClientFiles(spec, {
        splitByTag: true,
        errorBodyType: 'MyError',
        errorBodyTypeImport: './errors.js',
      })
    )
    expect(relative.get('client/_runtime.ts')).toContain(
      "import type { MyError } from '../errors.js'"
    )

    const pkg = filesByName(
      generateClientFiles(spec, {
        splitByTag: true,
        errorBodyType: 'MyError',
        errorBodyTypeImport: '@acme/errors',
      })
    )
    expect(pkg.get('client/_runtime.ts')).toContain("import type { MyError } from '@acme/errors'")
  })

  it("error_body_type 'laravel' re-exports LaravelValidationError from the barrel", () => {
    const files = filesByName(
      generateClientFiles(spec, { splitByTag: true, errorBodyType: 'laravel' })
    )
    expect(files.get('client.ts')).toContain(
      "export { ApiError, type LaravelValidationError } from './client/_runtime.js'"
    )
    expect(files.get('client/_runtime.ts')).toContain('export type LaravelValidationError')
  })
})

describe('generate() with split_by_tag', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ozt-split-'))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await writeFile(
      join(dir, 'openapi-zod-ts.config.json'),
      JSON.stringify({ input_openapi: fixturePath, output: 'out', split_by_tag: true })
    )
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  it('writes every split file (prettier-formatted) and the drift check passes', async () => {
    await generate(dir)
    const out = join(dir, 'out')
    for (const f of ['client.ts', 'client/_runtime.ts', 'client/pets.ts', 'client/default.ts']) {
      await access(join(out, f))
    }
    // Every nested file went through prettier, like the top-level ones.
    const { check, resolveConfig } = await import('prettier')
    for (const f of ['client/pets.ts', 'client/_runtime.ts']) {
      const path = join(out, f)
      const config = await resolveConfig(path)
      const content = await readFile(path, 'utf-8')
      expect(await check(content, { ...config, parser: 'typescript' })).toBe(true)
    }

    await expect(generate(dir, { checkDrift: true })).resolves.toBeUndefined()
  }, 30_000)

  it('--check-drift reports a stale, missing or extra file inside client/', async () => {
    await generate(dir)
    const out = join(dir, 'out')

    await writeFile(join(out, 'client/pets.ts'), '// tampered\n')
    await expect(generate(dir, { checkDrift: true })).rejects.toThrow(/drift/i)
    await generate(dir)

    await rm(join(out, 'client/store-orders.ts'))
    await expect(generate(dir, { checkDrift: true })).rejects.toThrow(/drift/i)
    await generate(dir)

    await writeFile(join(out, 'client/old-tag.ts'), '// stray\n')
    await expect(generate(dir, { checkDrift: true })).rejects.toThrow(/drift/i)
  }, 30_000)

  it('regenerating prunes generated tag modules that are no longer produced, keeps user files', async () => {
    await generate(dir)
    const out = join(dir, 'out')
    await writeFile(
      join(out, 'client/removed-tag.ts'),
      '// This file is auto-generated by openapi-zod-ts — do not edit\nexport {}\n'
    )
    await writeFile(join(out, 'client/mine.ts'), 'export const mine = 1\n')

    await generate(dir)

    await expect(access(join(out, 'client/removed-tag.ts'))).rejects.toThrow()
    await expect(readFile(join(out, 'client/mine.ts'), 'utf-8')).resolves.toContain('mine')
  }, 30_000)

  it('without split_by_tag the output is a single client.ts with no client/ directory', async () => {
    await writeFile(
      join(dir, 'openapi-zod-ts.config.json'),
      JSON.stringify({ input_openapi: fixturePath, output: 'out' })
    )
    await generate(dir)
    await access(join(dir, 'out/client.ts'))
    await expect(access(join(dir, 'out/client'))).rejects.toThrow()
  }, 30_000)
})

describe('compareOutput with nested expected files', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ozt-drift-nested-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('only scans subdirectories that hold expected files', async () => {
    await mkdir(join(dir, 'client'))
    await mkdir(join(dir, '_shared'))
    await writeFile(join(dir, 'client.ts'), 'a\n')
    await writeFile(join(dir, 'client/pets.ts'), 'b\n')
    await writeFile(join(dir, '_shared/other.ts'), 'c\n')

    const report = await compareOutput(
      new Map([
        ['client.ts', 'a\n'],
        ['client/pets.ts', 'b\n'],
      ]),
      dir
    )
    expect(report.clean).toBe(true)
  })

  it('treats a missing expected subdirectory as missing files', async () => {
    await writeFile(join(dir, 'client.ts'), 'a\n')
    const report = await compareOutput(
      new Map([
        ['client.ts', 'a\n'],
        ['client/pets.ts', 'b\n'],
      ]),
      dir
    )
    expect(report.missing).toEqual([{ filename: 'client/pets.ts', reason: 'missing' }])
  })
})
