/**
 * Shared test helpers for openapi-zod-ts unit tests.
 *
 * Extracted to avoid duplicating boilerplate across test files.
 * Import with the .js extension as required by NodeNext module resolution:
 *   import { compileFiles, compileSingleFile, makeSpec } from './helpers.js'
 */
import { posix } from 'node:path'
import ts from 'typescript'
import type { OpenAPIV3_1 } from 'openapi-types'

// ---------------------------------------------------------------------------
// makeSpec
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid OpenAPI 3.1.0 document, optionally merged with
 * caller-supplied overrides. The merge is shallow at the top level and one
 * level deep for `paths` and `components`.
 *
 * Use this to keep per-test spec literals focused on the delta rather than
 * repeating the same boilerplate skeleton in every file.
 */
export function makeSpec(overrides: Partial<OpenAPIV3_1.Document> = {}): OpenAPIV3_1.Document {
  const base: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1' },
    paths: {},
    components: {},
  }

  return {
    ...base,
    ...overrides,
    paths: { ...base.paths, ...overrides.paths },
    components: { ...base.components, ...overrides.components },
  }
}

// ---------------------------------------------------------------------------
// compileFiles
// ---------------------------------------------------------------------------

/**
 * Compile multiple in-memory TypeScript files together using the TypeScript
 * compiler API. Files are keyed by bare names (e.g. 'models.ts') and stored
 * under /virtual/. Relative imports between virtual files are resolved via
 * resolveModuleNameLiterals.
 *
 * Returns only diagnostics that belong to the virtual files (i.e. errors in
 * lib.d.ts or node_modules are excluded).
 */
export function compileFiles(files: Record<string, string>): readonly ts.Diagnostic[] {
  // Map bare names to virtual absolute paths
  const virtualFiles: Record<string, string> = {}
  for (const [name, content] of Object.entries(files)) {
    virtualFiles[`/virtual/${name}`] = content
  }

  const { options } = ts.convertCompilerOptionsFromJson(
    {
      strict: true,
      target: 'ES2025',
      moduleResolution: 'Bundler',
      noEmit: true,
      skipLibCheck: true,
      lib: ['ES2025', 'DOM'],
    },
    '.'
  )

  const fileNames = Object.keys(virtualFiles)
  const defaultHost = ts.createCompilerHost(options)

  const customHost: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (name, lang) => {
      if (name in virtualFiles) return ts.createSourceFile(name, virtualFiles[name]!, lang, true)
      return defaultHost.getSourceFile(name, lang)
    },
    fileExists: (name) => name in virtualFiles || defaultHost.fileExists(name),
    readFile: (name) => virtualFiles[name] ?? defaultHost.readFile(name),
    getCurrentDirectory: () => '/virtual',
    resolveModuleNameLiterals: (
      moduleLiterals,
      containingFile,
      redirectedRef,
      compilerOpts,
      containingSf,
      reusedNames
    ) => {
      return moduleLiterals.map((lit) => {
        const specifier = lit.text
        // Resolve relative imports within the virtual filesystem.
        // Strip leading ./ and any .js extension so both './models' and
        // './models.js' resolve to the virtual 'models.ts' file.
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          // posix.join normalizes '../' so nested files (e.g. client/pets.ts importing
          // '../models.js' for a split_by_tag client) resolve too.
          const dir = containingFile.replace(/\/[^/]*$/, '')
          const base = posix.join(dir, specifier.replace(/\.js$/, ''))
          const candidates = [`${base}.ts`, `${base}/index.ts`]
          for (const cand of candidates) {
            if (cand in virtualFiles) {
              return {
                resolvedModule: {
                  resolvedFileName: cand,
                  isExternalLibraryImport: false,
                  extension: ts.Extension.Ts,
                },
              }
            }
          }
        }
        // Fall back to default resolution for external modules
        if (defaultHost.resolveModuleNameLiterals) {
          return defaultHost.resolveModuleNameLiterals(
            [lit],
            containingFile,
            redirectedRef,
            compilerOpts,
            containingSf,
            reusedNames
          )[0]!
        }
        return { resolvedModule: undefined }
      })
    },
  }

  const program = ts.createProgram(fileNames, options, customHost)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName !== undefined && d.file.fileName in virtualFiles)
}

// ---------------------------------------------------------------------------
// compileSingleFile
// ---------------------------------------------------------------------------

/**
 * Compile a single in-memory TypeScript source string. Use this for tests
 * that verify a standalone generated file (e.g. models.ts, client-config.ts)
 * without needing cross-file imports.
 *
 * The `lib` option defaults to ['ES2022']. Pass `{ lib: ['ES2022', 'DOM'] }`
 * when the generated file uses browser globals (e.g. RequestInit, fetch).
 */
export function compileSingleFile(
  filename: string,
  source: string,
  opts: { lib?: string[] } = {}
): readonly ts.Diagnostic[] {
  const { options } = ts.convertCompilerOptionsFromJson(
    {
      strict: true,
      target: 'ES2022',
      moduleResolution: 'Bundler',
      noEmit: true,
      skipLibCheck: true,
      lib: opts.lib ?? ['ES2022'],
    },
    '.'
  )

  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true)
  const defaultHost = ts.createCompilerHost(options)

  const customHost: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (name, lang) =>
      name === filename ? sourceFile : defaultHost.getSourceFile(name, lang),
    fileExists: (name) => name === filename || defaultHost.fileExists(name),
    readFile: (name) => (name === filename ? source : defaultHost.readFile(name)),
  }

  const program = ts.createProgram([filename], options, customHost)
  return ts.getPreEmitDiagnostics(program, sourceFile).filter((d) => d.file?.fileName === filename)
}

// ---------------------------------------------------------------------------
// assertNoTsDiagnostics
// ---------------------------------------------------------------------------

/**
 * Assert that a TypeScript compilation produced no diagnostics. Throws a
 * descriptive error listing all messages when diagnostics are present.
 *
 * @param diagnostics - result from compileFiles or compileSingleFile
 * @param context - short label for the error message, e.g. "generated models.ts"
 */
export function assertNoTsDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  context: string
): void {
  if (diagnostics.length > 0) {
    const messages = diagnostics
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n')
    throw new Error(`TypeScript errors in ${context}:\n${messages}`)
  }
}
