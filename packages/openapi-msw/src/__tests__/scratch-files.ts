/**
 * Test-only helpers: write generated files into a fresh scratch directory nested inside
 * this package (not os.tmpdir()), so that module resolution walking up from the scratch
 * directory finds this package's real node_modules (msw, @faker-js/faker, typescript).
 * `.typecheck-scratch/` is gitignored at the repo root.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const scratchRoot = join(import.meta.dirname, '../../.typecheck-scratch')

/** Write `files` (keyed by file name) into a new scratch dir and return its absolute path. */
export function writeScratchFiles(files: Record<string, string>): string {
  mkdirSync(scratchRoot, { recursive: true })
  const dir = mkdtempSync(join(scratchRoot, 'run-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf-8')
  }
  return dir
}

export function removeScratchDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Typecheck `files` with the real TypeScript compiler (strict, bundler resolution) in a
 * scratch dir, returning formatted diagnostics for those files only (empty when clean).
 */
export function compileFiles(files: Record<string, string>): string[] {
  const dir = writeScratchFiles(files)
  try {
    const fileNames = Object.keys(files).map((name) => join(dir, name))
    const program = ts.createProgram(fileNames, {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    })
    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file !== undefined && fileNames.includes(d.file.fileName))
      .map((d) => {
        const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0)
        const name = d.file!.fileName.slice(dir.length + 1)
        return `${name}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
      })
  } finally {
    removeScratchDir(dir)
  }
}
