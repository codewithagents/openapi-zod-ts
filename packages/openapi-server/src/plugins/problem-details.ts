/**
 * Error-response emission for the generated routers, including the opt-in RFC 7807 / RFC 9457
 * `application/problem+json` format (`error_format: 'problem+json'`, #194).
 *
 * Every router-produced error (Zod validation failures, 400 invalid JSON, 415 unsupported media
 * type, HttpError mapping, response-validation failures) goes through the builders below, so the
 * default output stays byte-identical while problem+json swaps in a single helper call.
 *
 * Problem body shape: `{ type: 'about:blank', title, status, detail?, instance, errors? }`.
 * `title` is the HTTP reason phrase for `status` (as RFC 9457 recommends for `about:blank`),
 * `detail` carries the router's message (e.g. 'Invalid request body', or HttpError.message),
 * `instance` is the request path, and `errors` is an extension member holding the Zod issues
 * (Fastify: the type-provider's validation entries).
 */

export type ErrorFormat = 'default' | 'problem+json'

export function isProblemJson(format: ErrorFormat | undefined): boolean {
  return format === 'problem+json'
}

/** Reason phrases for the statuses the routers commonly produce; others fall back to 'Error'. */
const PROBLEM_TITLES_SOURCE = [
  'const _PROBLEM_TITLES: Record<number, string> = {',
  "  400: 'Bad Request',",
  "  401: 'Unauthorized',",
  "  403: 'Forbidden',",
  "  404: 'Not Found',",
  "  405: 'Method Not Allowed',",
  "  409: 'Conflict',",
  "  410: 'Gone',",
  "  413: 'Content Too Large',",
  "  415: 'Unsupported Media Type',",
  "  422: 'Unprocessable Content',",
  "  429: 'Too Many Requests',",
  "  500: 'Internal Server Error',",
  "  502: 'Bad Gateway',",
  "  503: 'Service Unavailable',",
  '}',
  '',
  '/** RFC 9457 (RFC 7807) problem details body. `errors` is an extension member. */',
  'function _problemBody(status: number, instance: string, detail?: string, errors?: unknown) {',
  '  return {',
  "    type: 'about:blank',",
  "    title: _PROBLEM_TITLES[status] ?? 'Error',",
  '    status,',
  '    ...(detail !== undefined ? { detail } : {}),',
  '    instance,',
  '    ...(errors !== undefined ? { errors } : {}),',
  '  }',
  '}',
  '',
]

/** Module-level helper source emitted once into a problem+json Hono router. */
export function honoProblemHelperLines(): string[] {
  return [
    ...PROBLEM_TITLES_SOURCE,
    'function _problem(instance: string, status: number, detail?: string, errors?: unknown): Response {',
    '  return new Response(JSON.stringify(_problemBody(status, instance, detail, errors)), {',
    '    status,',
    "    headers: { 'content-type': 'application/problem+json' },",
    '  })',
    '}',
    '',
  ]
}

/** Module-level helper source emitted once into a problem+json Express router. */
export function expressProblemHelperLines(): string[] {
  return [
    ...PROBLEM_TITLES_SOURCE,
    'function _problem(res: Response, instance: string, status: number, detail?: string, errors?: unknown): void {',
    '  res',
    '    .status(status)',
    "    .set('content-type', 'application/problem+json')",
    '    .send(JSON.stringify(_problemBody(status, instance, detail, errors)))',
    '}',
    '',
  ]
}

/** Module-level helper source emitted once into a problem+json Fastify router. */
export function fastifyProblemHelperLines(): string[] {
  return [
    ...PROBLEM_TITLES_SOURCE,
    'function _problem(reply: FastifyReply, instance: string, status: number, detail?: string, errors?: unknown) {',
    '  return reply',
    '    .status(status)',
    "    .type('application/problem+json')",
    '    .send(JSON.stringify(_problemBody(status, instance, detail, errors)))',
    '}',
    '',
  ]
}

const HONO_INSTANCE = 'c.req.path'
const EXPRESS_INSTANCE = 'req.baseUrl + req.path'
export const FASTIFY_INSTANCE = "req.url.split('?')[0]!"

/**
 * Hono `return ...` statement for a router-produced error with a literal message.
 * Default: `return c.json({ error, issues? }, status)`.
 */
export function honoErrorReturn(
  status: number,
  message: string,
  issuesExpr: string | undefined,
  format: ErrorFormat | undefined
): string {
  if (isProblemJson(format)) {
    const extra = issuesExpr !== undefined ? `, ${issuesExpr}` : ''
    return `return _problem(${HONO_INSTANCE}, ${status}, '${message}'${extra})`
  }
  const issues = issuesExpr !== undefined ? `, issues: ${issuesExpr}` : ''
  return `return c.json({ error: '${message}'${issues} }, ${status})`
}

/** Hono `return ...` statement mapping a caught HttpError (`err`) to its status. */
export function honoHttpErrorReturn(format: ErrorFormat | undefined): string {
  if (isProblemJson(format)) return `return _problem(${HONO_INSTANCE}, err.status, err.message)`
  return "return new Response(JSON.stringify({ error: err.message }), { status: err.status, headers: { 'content-type': 'application/json' } })"
}

/**
 * Express `return void ...` statement for a router-produced error with a literal message.
 * Default: `return void res.status(status).json({ error, issues? })`.
 */
export function expressErrorReturn(
  status: number,
  message: string,
  issuesExpr: string | undefined,
  format: ErrorFormat | undefined
): string {
  if (isProblemJson(format)) {
    const extra = issuesExpr !== undefined ? `, ${issuesExpr}` : ''
    return `return void _problem(res, ${EXPRESS_INSTANCE}, ${status}, '${message}'${extra})`
  }
  const issues = issuesExpr !== undefined ? `, issues: ${issuesExpr}` : ''
  return `return void res.status(${status}).json({ error: '${message}'${issues} })`
}

/** Express `return void ...` statement mapping a caught HttpError (`err`) to its status. */
export function expressHttpErrorReturn(format: ErrorFormat | undefined): string {
  if (isProblemJson(format)) {
    return `return void _problem(res, ${EXPRESS_INSTANCE}, err.status, err.message)`
  }
  return 'return void res.status(err.status).json({ error: err.message })'
}

/** Fastify in-handler `return ...` statement for a router-produced error (cookie 422, etc.). */
export function fastifyErrorReturn(
  status: number,
  message: string,
  issuesExpr: string | undefined,
  format: ErrorFormat | undefined
): string {
  if (isProblemJson(format)) {
    const extra = issuesExpr !== undefined ? `, ${issuesExpr}` : ''
    return `return _problem(reply, ${FASTIFY_INSTANCE}, ${status}, '${message}'${extra})`
  }
  const issues = issuesExpr !== undefined ? `, issues: ${issuesExpr}` : ''
  return `return reply.status(${status}).send({ error: '${message}'${issues} })`
}

/**
 * Body lines of the generated default Fastify `setErrorHandler` in problem+json mode
 * (indented for placement inside `app.setErrorHandler((err, req, reply) => { ... })`).
 *
 * - HttpError -> its status, detail = message.
 * - Fastify/type-provider validation errors (`err.validation` array) -> 400 with `errors`.
 * - Response serialization failures (`FST_ERR_RESPONSE_SERIALIZATION`) -> 500, no data leaked.
 * - Any other 4xx framework error (e.g. 415 FST_ERR_CTP_INVALID_MEDIA_TYPE) -> its status.
 * - Everything else is re-thrown to the app-level error handler, as in default mode.
 */
export function fastifyProblemErrorHandlerLines(indent: string): string[] {
  return [
    `${indent}const _instance = ${FASTIFY_INSTANCE}`,
    `${indent}if (err instanceof HttpError) return _problem(reply, _instance, err.status, err.message)`,
    `${indent}const _e = err as { validation?: unknown; validationContext?: string; statusCode?: number; code?: string; message?: string }`,
    `${indent}if (Array.isArray(_e.validation)) {`,
    `${indent}  return _problem(reply, _instance, 400, \`Invalid request \${_e.validationContext ?? 'input'}\`, _e.validation)`,
    `${indent}}`,
    `${indent}if (_e.code === 'FST_ERR_RESPONSE_SERIALIZATION') {`,
    `${indent}  return _problem(reply, _instance, 500, 'Response does not match the response schema')`,
    `${indent}}`,
    `${indent}if (typeof _e.statusCode === 'number' && _e.statusCode >= 400 && _e.statusCode < 500) {`,
    `${indent}  return _problem(reply, _instance, _e.statusCode, _e.message)`,
    `${indent}}`,
    `${indent}throw err`,
  ]
}
