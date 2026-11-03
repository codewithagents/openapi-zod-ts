import type { OpenAPIV3_1 } from 'openapi-types'
import {
  isRef,
  quote,
  schemaToFaker,
  type FakerExprContext,
  type SchemaOrRef,
} from './faker-expr.js'

export interface HandlerGenOptions {
  /** Seed for faker.seed(), default 42 */
  seed: number
  /** Max array length in generated mock data, default 3 */
  maxArrayItems: number
  /**
   * Max schema recursion depth before emitting null. Counts $ref hops and
   * allOf/anyOf/oneOf resolution steps. Default: 30.
   */
  depthCap: number
  /**
   * Origin (optionally with a base path) prefixed to every handler path, e.g.
   * `https://api.test` -> `https://api.test/api/v1/tasks`. When omitted, handlers are
   * prefixed with MSW's `*` wildcard origin, which matches any origin in both the browser
   * (`setupWorker`) and Node (`setupServer`).
   */
  baseUrl?: string
}

export interface GeneratedFile {
  filename: string
  content: string
}

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type SupportedMethod = (typeof SUPPORTED_METHODS)[number]

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert OpenAPI {param} path params to MSW :param colon style */
function toMswPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ':$1')
}

/**
 * Build the full MSW request matcher for an OpenAPI path. A relative path such as
 * `/api/v1/tasks` only matches same-origin requests in the browser and never matches the
 * absolute URLs Node's fetch requires, so the path is always anchored to an origin: the
 * configured base URL, or the `*` wildcard origin when none is set.
 */
function toMswUrl(openApiPath: string, baseUrl: string | undefined): string {
  let origin = baseUrl ?? '*'
  while (origin.endsWith('/')) origin = origin.slice(0, -1)
  const path = toMswPath(openApiPath)
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`
}

// ── Response extraction ────────────────────────────────────────────────────────

interface ResponseBody {
  schema: SchemaOrRef
  statusCode: number
}

/** Extract JSON schema from a single response object, or null if none present. */
function extractResponseSchema(
  resp: OpenAPIV3_1.ResponseObject | OpenAPIV3_1.ReferenceObject | undefined,
  code: string
): ResponseBody | null {
  if (resp === undefined || isRef(resp)) return null
  const schema = resp.content?.['application/json']?.schema
  if (schema === undefined) return null
  return { schema, statusCode: Number(code) }
}

/** True when the response has content but no application/json body (e.g. text/plain, octet-stream). */
function hasNonJsonBody(
  resp: OpenAPIV3_1.ResponseObject | OpenAPIV3_1.ReferenceObject | undefined
): boolean {
  if (resp === undefined || isRef(resp)) return false
  const content = resp.content
  if (content === undefined || Object.keys(content).length === 0) return false
  return content['application/json'] === undefined
}

/** Try preferred 2xx status codes (200, 201) first. */
function findPreferredResponse(responses: OpenAPIV3_1.ResponsesObject): ResponseBody | null {
  for (const code of ['200', '201']) {
    const result = extractResponseSchema(responses[code], code)
    if (result !== null) return result
  }
  return null
}

/** Scan all responses for any 2xx with a JSON body. */
function findAny2xxResponse(responses: OpenAPIV3_1.ResponsesObject): ResponseBody | null {
  for (const [code, resp] of Object.entries(responses)) {
    const num = Number(code)
    if (num < 200 || num >= 300) continue
    const result = extractResponseSchema(resp, code)
    if (result !== null) return result
  }
  return null
}

function find2xxResponse(responses: OpenAPIV3_1.ResponsesObject): ResponseBody | null {
  return findPreferredResponse(responses) ?? findAny2xxResponse(responses)
}

/** Find the status code of the first 2xx response, with or without a body. */
function noBodyStatus(responses: OpenAPIV3_1.ResponsesObject): number {
  for (const code of Object.keys(responses)) {
    const num = Number(code)
    if (num >= 200 && num < 300) return num
  }
  return 204
}

/** True when no 2xx response has a JSON body but at least one has non-JSON content. */
function is2xxNonJsonBody(responses: OpenAPIV3_1.ResponsesObject): boolean {
  for (const [code, resp] of Object.entries(responses)) {
    const num = Number(code)
    if (num < 200 || num >= 300) continue
    if (hasNonJsonBody(resp)) return true
  }
  return false
}

// ── Handler emission ───────────────────────────────────────────────────────────

function buildHandlerLine(
  method: SupportedMethod,
  path: string,
  responses: OpenAPIV3_1.ResponsesObject,
  ctx: FakerExprContext,
  opts: HandlerGenOptions
): string {
  const mswPath = quote(toMswUrl(path, opts.baseUrl))
  const responseBody = find2xxResponse(responses)

  if (responseBody === null) {
    const status = noBodyStatus(responses)
    // Use new HttpResponse() for non-JSON content types to avoid claiming application/json
    if (is2xxNonJsonBody(responses)) {
      return `http.${method}(${mswPath}, () => new HttpResponse(null, { status: ${status} }))`
    }
    return `http.${method}(${mswPath}, () => HttpResponse.json(null, { status: ${status} }))`
  }

  const bodyExpr = schemaToFaker(responseBody.schema, ctx)
  const needsStatus = responseBody.statusCode !== 200
  if (needsStatus) {
    return `http.${method}(${mswPath}, () => HttpResponse.json(${bodyExpr}, { status: ${responseBody.statusCode} }))`
  }
  return `http.${method}(${mswPath}, () => HttpResponse.json(${bodyExpr}))`
}

/** Collect handler lines for all operations in a single path item. */
function buildPathHandlerLines(
  path: string,
  pathItem: OpenAPIV3_1.PathItemObject,
  ctx: FakerExprContext,
  opts: HandlerGenOptions
): string[] {
  const lines: string[] = []
  for (const method of SUPPORTED_METHODS) {
    const operation = (pathItem as Record<string, unknown>)[method] as
      OpenAPIV3_1.OperationObject | undefined
    if (operation === undefined) continue
    const responses = operation.responses
    if (responses === undefined) continue
    lines.push(buildHandlerLine(method, path, responses, ctx, opts))
  }
  return lines
}

// ── Entry point ────────────────────────────────────────────────────────────────

export function generateHandlers(
  spec: OpenAPIV3_1.Document,
  opts: HandlerGenOptions
): GeneratedFile {
  const ctx: FakerExprContext = {
    schemas: (spec.components?.schemas ?? {}) as Record<string, SchemaOrRef>,
    maxItems: opts.maxArrayItems,
    depthCap: opts.depthCap,
  }
  const paths = spec.paths ?? {}
  const lines: string[] = []

  for (const [path, pathItem] of Object.entries(paths)) {
    if (pathItem === undefined) continue
    lines.push(...buildPathHandlerLines(path, pathItem, ctx, opts))
  }

  const content = [
    `// This file is auto-generated by @codewithagents/openapi-msw, do not edit`,
    `import { http, HttpResponse } from 'msw'`,
    `import { faker } from '@faker-js/faker'`,
    ``,
    `faker.seed(${opts.seed})`,
    ``,
    `export const handlers = [`,
    ...lines.map((l) => `  ${l},`),
    `]`,
  ].join('\n')

  return { filename: 'handlers.ts', content }
}
