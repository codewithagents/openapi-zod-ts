import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import type { OpenAPIV3_1 } from 'openapi-types'
import { toJsLiteral } from '../plugins/faker-expr.js'
import { generateHandlers } from '../plugins/handlers.js'
import { generateFixtures } from '../plugins/fixtures.js'

// Spec-derived strings end up inside generated source. None of them may be able to
// terminate the literal they are placed in, or the surrounding code.
const HOSTILE = [
  "it's",
  'say "hi"',
  'back\\slash',
  'line\nbreak',
  'carriage\rreturn',
  'nul\u00001',
  'sep\u2028arator',
  'para\u2029graph',
  '</script><script>alert(1)</script>',
  "'); process.exit(1); ('",
]

function syntaxErrors(source: string): string[] {
  const out = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

function callsTo(source: string, callee: string): number {
  const file = ts.createSourceFile('out.ts', source, ts.ScriptTarget.ES2022, true)
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === callee) count++
    ts.forEachChild(node, visit)
  }
  visit(file)
  return count
}

const spec = {
  openapi: '3.1.0',
  info: { title: 'Hostile', version: '1.0.0' },
  paths: {
    "/it's/{id}": {
      get: {
        operationId: 'getHostile',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Hostile' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Hostile: {
        type: 'object',
        required: HOSTILE,
        properties: Object.fromEntries(
          HOSTILE.map((k) => [k, { type: 'string', enum: HOSTILE }])
        ),
      },
    },
  },
} as unknown as OpenAPIV3_1.Document

describe('toJsLiteral', () => {
  it.each(HOSTILE)('round-trips %j exactly', (value) => {
    const literal = toJsLiteral(value)
    expect(JSON.parse(literal)).toBe(value)
    expect(literal).not.toMatch(/[\n\r\u2028\u2029<>]/)
  })

  it('serialises non-string enum values', () => {
    expect(toJsLiteral(42)).toBe('42')
    expect(toJsLiteral(null)).toBe('null')
    expect(toJsLiteral(true)).toBe('true')
  })

  it('evaluates back to the original value in generated code', () => {
    for (const value of HOSTILE) {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      expect(new Function(`return ${toJsLiteral(value)}`)()).toBe(value)
    }
  })
})

describe('generated output stays syntactically valid for hostile spec strings', () => {
  it('handlers.ts', () => {
    const { content } = generateHandlers(spec, { seed: 1, maxArrayItems: 1, depthCap: 30 })
    expect(syntaxErrors(content)).toEqual([])
    // The hostile text may appear inside a string literal, but never as code.
    expect(callsTo(content, 'process.exit')).toBe(0)
  })

  it('fixtures.ts', () => {
    const { content } = generateFixtures(spec, {
      seed: 1,
      maxArrayItems: 1,
      depthCap: 30,
      modelsImport: './models.js',
    })
    expect(syntaxErrors(content)).toEqual([])
    // This spec has no reference cycle, so the recursion guard is not emitted (unused).
    expect(content).not.toContain('function cyclic')
  })
})
