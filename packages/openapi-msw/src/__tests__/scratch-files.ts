/**
 * Test-only helper: write generated files into a fresh scratch directory nested inside
 * this package (not os.tmpdir()), so that module resolution walking up from the scratch
 * directory finds this package's real node_modules (msw, @faker-js/faker, typescript).
 * `.typecheck-scratch/` is gitignored at the repo root.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
