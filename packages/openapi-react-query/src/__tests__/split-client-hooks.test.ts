/**
 * Hooks generated against a split_by_tag client (openapi-zod-ts #196) must keep working
 * unchanged: hooks import from './client.js', which in split mode is a barrel that
 * re-exports ApiError and every per-tag module. This compiles the hooks together with the
 * full split client output under tsc --strict.
 */
import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateClientConfig, generateClientFiles, generateTypes } from 'openapi-zod-ts'
import { generateHooks } from '../plugins/hooks.js'

const spec: OpenAPIV3_1.Document = {
  openapi: '3.1.0',
  info: { title: 'Fictional Split Hooks API', version: '1' },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string', readOnly: true }, name: { type: 'string' } },
      },
      Order: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' }, quantity: { type: 'integer' } },
      },
    },
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        tags: ['pets'],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        tags: ['pets'],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        responses: {
          '201': {
            description: 'created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        tags: ['pets', 'Store Orders'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'deleted' } },
      },
    },
    '/store/orders': {
      get: {
        operationId: 'listOrders',
        tags: ['Store Orders'],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        responses: {
          '200': { description: 'ok', content: { 'text/plain': { schema: { type: 'string' } } } },
        },
      },
    },
  },
}

/**
 * Compile in-memory files under tsc --strict. Virtual files live inside this package's
 * directory so bare imports (@tanstack/react-query) resolve from its node_modules.
 */
function compile(files: Record<string, string>): string[] {
  const root = posix.join(import.meta.dirname.replace(/\\/g, '/'), '__virtual_split__')
  const virtual = new Map(Object.entries(files).map(([n, c]) => [posix.join(root, n), c]))
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  }
  const host = ts.createCompilerHost(options)
  const customHost: ts.CompilerHost = {
    ...host,
    getSourceFile: (name, lang) =>
      virtual.has(name)
        ? ts.createSourceFile(name, virtual.get(name)!, lang, true)
        : host.getSourceFile(name, lang),
    fileExists: (name) => virtual.has(name) || host.fileExists(name),
    readFile: (name) => virtual.get(name) ?? host.readFile(name),
    resolveModuleNameLiterals: (lits, containingFile, redirected, opts) =>
      lits.map((lit) => {
        if (lit.text.startsWith('.')) {
          const base = posix.join(posix.dirname(containingFile), lit.text.replace(/\.js$/, ''))
          const candidate = `${base}.ts`
          if (virtual.has(candidate)) {
            return {
              resolvedModule: {
                resolvedFileName: candidate,
                isExternalLibraryImport: false,
                extension: ts.Extension.Ts,
              },
            }
          }
        }
        return ts.resolveModuleName(lit.text, containingFile, opts, host, undefined, redirected)
      }),
  }
  const program = ts.createProgram([...virtual.keys()], options, customHost)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file !== undefined && virtual.has(d.file.fileName))
    .map((d) => `${d.file!.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
}

describe('hooks against a split_by_tag client', () => {
  const clientFiles = generateClientFiles(spec, { splitByTag: true })
  const hooks = generateHooks(spec, { staleTime: 0, gcTime: 300_000 })

  it('the client really is split and hooks still import from ./client.js', () => {
    expect(clientFiles.map((f) => f.filename)).toContain('client/pets.ts')
    expect(hooks.content).toContain("from './client.js'")
  })

  it('hooks + split client compile under tsc --strict', () => {
    const files: Record<string, string> = {
      'models.ts': generateTypes(spec).content,
      'client-config.ts': generateClientConfig({}).content,
      'index.ts':
        "export * from './models.js'\nexport * from './client-config.js'\nexport * from './client.js'\n",
      [hooks.filename]: hooks.content,
    }
    for (const f of clientFiles) files[f.filename] = f.content
    expect(compile(files)).toEqual([])

    // Sanity: the harness does catch a broken split (a tag module missing).
    delete files['client/pets.ts']
    expect(compile(files).length).toBeGreaterThan(0)
  }, 30_000)
})
