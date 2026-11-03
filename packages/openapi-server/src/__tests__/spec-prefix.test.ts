/**
 * spec_prefix (#334): several specs share ONE schemas.ts whose exports are namespaced per
 * spec (`PublicApiCreateUserSchema`, `AdminApiCreateUserSchema`). With spec_prefix set, each
 * spec's router looks up `${spec_prefix}${Type}Schema` and imports it under the bare name.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenAPIV3_1 } from 'openapi-types'
import type { Hono } from 'hono'
import { generate } from '../generator.js'
import { generateRouter, generateExpressRouter, generateFastifyRouter } from '../plugins/router.js'
import { generateFastifyTypes } from '../plugins/fastify-service.js'
import {
  formatSchemaImportSpecifiers,
  resolvePrefixedSchemaNames,
} from '../plugins/schema-prefix.js'
import { cleanupRuntimeScratch, loadGeneratedModule } from './runtime-helpers.js'
import { assertNoTsDiagnostics, compileGeneratedFiles } from './ts-compile-helpers.js'

afterAll(() => cleanupRuntimeScratch())

/** Two fictional specs with the same operation/type names, so bare names would collide. */
function userSpec(title: string, bodyProps: Record<string, OpenAPIV3_1.SchemaObject>) {
  return {
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    paths: {
      '/users': {
        post: {
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } },
            },
          },
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        CreateUser: {
          type: 'object',
          required: Object.keys(bodyProps),
          properties: bodyProps,
        },
        User: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
  } as OpenAPIV3_1.Document
}

const publicSpec = userSpec('Public API', { name: { type: 'string' } })
const adminSpec = userSpec('Admin API', { role: { type: 'string' } })

const sharedSchemas = `import { z } from 'zod'

export const PublicApiCreateUserSchema = z.object({ name: z.string() })
export const PublicApiUserSchema = z.object({ id: z.string() })
export const AdminApiCreateUserSchema = z.object({ role: z.string() })
export const AdminApiUserSchema = z.object({ id: z.string() })
export const ErrorSchema = z.object({ message: z.string() })
`

const sharedExports = new Set([
  'PublicApiCreateUserSchema',
  'PublicApiUserSchema',
  'AdminApiCreateUserSchema',
  'AdminApiUserSchema',
  'ErrorSchema',
])

describe('resolvePrefixedSchemaNames', () => {
  it('without a prefix returns the exported names unchanged and no aliases', () => {
    const r = resolvePrefixedSchemaNames(sharedExports)
    expect(r.schemaNames).toEqual(sharedExports)
    expect(r.importAliases.size).toBe(0)
  })

  it('strips the prefix into bare lookup names and records aliases', () => {
    const r = resolvePrefixedSchemaNames(sharedExports, 'PublicApi')
    expect(r.schemaNames.has('CreateUserSchema')).toBe(true)
    expect(r.schemaNames.has('UserSchema')).toBe(true)
    expect(r.importAliases.get('CreateUserSchema')).toBe('PublicApiCreateUserSchema')
    // Other specs' prefixed exports never map onto this spec's bare names.
    expect(r.importAliases.get('UserSchema')).toBe('PublicApiUserSchema')
    // Unprefixed shared schemas stay available as a fallback, without an alias.
    expect(r.schemaNames.has('ErrorSchema')).toBe(true)
    expect(r.importAliases.has('ErrorSchema')).toBe(false)
  })

  it('a prefixed export wins over an unprefixed one with the same bare name', () => {
    for (const order of [
      ['UserSchema', 'PublicApiUserSchema'],
      ['PublicApiUserSchema', 'UserSchema'],
    ]) {
      const r = resolvePrefixedSchemaNames(new Set(order), 'PublicApi')
      expect([...r.schemaNames]).toEqual(['UserSchema'])
      expect(r.importAliases.get('UserSchema')).toBe('PublicApiUserSchema')
    }
  })

  it('only strips at a word boundary: an unprefixed export sharing the prefix letters is kept', () => {
    // spec_prefix "Admin" must not turn the unprefixed AdministratorSchema into istratorSchema.
    const r = resolvePrefixedSchemaNames(
      new Set(['AdministratorSchema', 'AdminUserSchema']),
      'Admin'
    )
    expect([...r.schemaNames].sort()).toEqual(['AdministratorSchema', 'UserSchema'])
    expect(r.importAliases.get('UserSchema')).toBe('AdminUserSchema')
    expect(r.importAliases.has('istratorSchema')).toBe(false)
    expect(r.importAliases.has('AdministratorSchema')).toBe(false)
  })

  it('does not strip when nothing but "Schema" would remain', () => {
    const r = resolvePrefixedSchemaNames(new Set(['PublicApiSchema']), 'PublicApi')
    expect([...r.schemaNames]).toEqual(['PublicApiSchema'])
    expect(r.importAliases.size).toBe(0)
  })

  it('formatSchemaImportSpecifiers aliases prefixed exports and sorts by bare name', () => {
    const r = resolvePrefixedSchemaNames(sharedExports, 'AdminApi')
    expect(formatSchemaImportSpecifiers(['UserSchema', 'CreateUserSchema'], r.importAliases)).toBe(
      'AdminApiCreateUserSchema as CreateUserSchema, AdminApiUserSchema as UserSchema'
    )
    expect(formatSchemaImportSpecifiers(['BSchema', 'ASchema'])).toBe('ASchema, BSchema')
  })
})

describe('emitters import prefixed schemas under the bare name', () => {
  const { schemaNames, importAliases } = resolvePrefixedSchemaNames(sharedExports, 'PublicApi')
  const opts = { schemaNames, schemaImportAliases: importAliases, schemaImportPath: './schemas.js' }

  it.each([
    ['Hono', generateRouter],
    ['Express', generateExpressRouter],
  ] as const)('%s router', (_, gen) => {
    const { content } = gen(publicSpec, opts)
    expect(content).toContain(
      "import { PublicApiCreateUserSchema as CreateUserSchema } from './schemas.js'"
    )
    expect(content).toContain('CreateUserSchema.safeParse(')
    expect(content).not.toContain('AdminApi')
  })

  it('Fastify router (body + response schemas)', () => {
    const { content } = generateFastifyRouter(publicSpec, { ...opts, zeroCast: true })
    expect(content).toContain(
      "import { PublicApiCreateUserSchema as CreateUserSchema, PublicApiUserSchema as UserSchema } from './schemas.js'"
    )
    expect(content).toContain('body: CreateUserSchema')
    expect(content).toContain('response: { 201: UserSchema }')
  })

  it('Fastify schema-types.ts', () => {
    const { content } = generateFastifyTypes(schemaNames, './schemas.js', importAliases)
    expect(content).toContain('PublicApiCreateUserSchema as CreateUserSchema')
    expect(content).toContain('export type CreateUser = z.infer<typeof CreateUserSchema>')
  })

  it('default (no aliases) output is unchanged', () => {
    const { content } = generateRouter(publicSpec, {
      schemaNames: new Set(['CreateUserSchema']),
      schemaImportPath: './schemas.js',
    })
    expect(content).toContain("import { CreateUserSchema } from './schemas.js'")
    expect(content).not.toContain(' as CreateUserSchema')
  })
})

describe('Hono runtime: each spec validates against its own prefixed schema', () => {
  async function app(prefix: string, spec: OpenAPIV3_1.Document): Promise<Hono> {
    const { schemaNames, importAliases } = resolvePrefixedSchemaNames(sharedExports, prefix)
    const router = generateRouter(spec, {
      schemaNames,
      schemaImportAliases: importAliases,
      schemaImportPath: './schemas.js',
    })
    const mod = await loadGeneratedModule<{ createRouter: (s: unknown) => Hono }>({
      'router.ts': router.content,
      'schemas.ts': sharedSchemas,
    })
    return mod.createRouter({ createUser: async () => ({ id: 'u1' }) })
  }

  const post = (a: Hono, body: unknown) =>
    a.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('PublicApi requires { name }', async () => {
    const a = await app('PublicApi', publicSpec)
    expect((await post(a, { name: 'Ada' })).status).toBe(201)
    expect((await post(a, { role: 'admin' })).status).toBe(422)
  })

  it('AdminApi requires { role }', async () => {
    const a = await app('AdminApi', adminSpec)
    expect((await post(a, { role: 'admin' })).status).toBe(201)
    expect((await post(a, { name: 'Ada' })).status).toBe(422)
  })
})

describe('generate(): two Fastify projects sharing one prefixed schemas.ts', () => {
  const scratchRoot = join(import.meta.dirname, '../../.typecheck-scratch')
  let dir: string

  beforeEach(() => {
    mkdirSync(scratchRoot, { recursive: true })
    dir = mkdtempSync(join(scratchRoot, 'prefix-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('emits aliased imports per project and the result typechecks', async () => {
    writeFileSync(join(dir, 'public.json'), JSON.stringify(publicSpec))
    writeFileSync(join(dir, 'admin.json'), JSON.stringify(adminSpec))
    writeFileSync(join(dir, 'schemas.ts'), sharedSchemas)
    writeFileSync(
      join(dir, 'openapi-server.config.json'),
      JSON.stringify({
        projects: [
          {
            input_openapi: 'public.json',
            output: 'gen/public',
            framework: 'fastify',
            input_schema: 'schemas.ts',
            spec_prefix: 'PublicApi',
          },
          {
            input_openapi: 'admin.json',
            output: 'gen/admin',
            framework: 'fastify',
            input_schema: 'schemas.ts',
            spec_prefix: 'AdminApi',
          },
        ],
      })
    )

    await generate(dir)

    const read = (p: string) => readFileSync(join(dir, p), 'utf-8')
    const files: Record<string, string> = { 'schemas.ts': sharedSchemas }
    for (const project of ['public', 'admin']) {
      for (const f of ['router.ts', 'service.ts', 'schema-types.ts']) {
        files[`gen/${project}/${f}`] = read(`gen/${project}/${f}`)
      }
    }
    files['gen/_shared/errors.ts'] = read('gen/_shared/errors.ts')

    expect(files['gen/public/router.ts']).toContain('PublicApiCreateUserSchema as CreateUserSchema')
    expect(files['gen/admin/router.ts']).toContain('AdminApiCreateUserSchema as CreateUserSchema')
    expect(files['gen/admin/schema-types.ts']).toContain('AdminApiUserSchema as UserSchema')
    expect(files['gen/public/router.ts']).not.toContain('AdminApi')

    assertNoTsDiagnostics(compileGeneratedFiles(files), 'spec_prefix shared schemas.ts')
  })
})
