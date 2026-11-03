/**
 * Runtime helper for tests that need to EXECUTE generated router output (real Hono
 * app.request(), real Express over HTTP, real Fastify inject()), not just assert on
 * substrings.
 *
 * Each generated .ts file is transpiled with the TypeScript compiler (types erased, so
 * type-only imports such as './service.js' / './models.js' disappear) and written as .js
 * into a temp directory nested inside this package, so Node's module resolution walking
 * up from it finds this package's real node_modules (hono, express, fastify, zod,
 * fastify-type-provider-zod). The entry module is then dynamically imported.
 *
 * Import with the .js extension as required by NodeNext module resolution:
 *   import { loadGeneratedModule, cleanupRuntimeScratch } from './runtime-helpers.js'
 */
import ts from 'typescript'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { emitSharedErrorsFile } from '../plugins/errors-emitter.js'

const scratchRoot = join(import.meta.dirname, '../../.typecheck-scratch')
const createdDirs: string[] = []

/**
 * Transpile and write `files` (keyed by relative .ts path, e.g. 'router.ts') plus the shared
 * `_shared/errors.ts`, then import `entry` (default 'router.ts') and return its exports.
 */
export async function loadGeneratedModule<T = Record<string, unknown>>(
  files: Record<string, string>,
  entry = 'router.ts'
): Promise<T> {
  mkdirSync(scratchRoot, { recursive: true })
  const dir = mkdtempSync(join(scratchRoot, 'rt-'))
  createdDirs.push(dir)
  const all: Record<string, string> = {
    '_shared/errors.ts': emitSharedErrorsFile().content,
    ...files,
  }
  for (const [name, content] of Object.entries(all)) {
    const { outputText } = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: false,
      },
    })
    const outPath = join(dir, name.replace(/\.ts$/, '.js'))
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, outputText, 'utf-8')
  }
  // A package.json marking the scratch dir as ESM so Node loads the .js files as modules.
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}', 'utf-8')
  const entryUrl = pathToFileURL(join(dir, entry.replace(/\.ts$/, '.js'))).href
  return (await import(/* @vite-ignore */ entryUrl)) as T
}

/** Remove every scratch directory created by loadGeneratedModule. Call from afterAll. */
export function cleanupRuntimeScratch(): void {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}
