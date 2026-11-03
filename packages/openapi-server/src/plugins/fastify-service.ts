/**
 * Fastify-specific service and schema-types generators for openapi-server.
 *
 * When framework=fastify and input_schema is configured, these generators replace
 * the generic service.ts and emit an additional schema-types.ts file that derives
 * TypeScript types from z.infer of the user-owned Zod schemas. Both service.ts and
 * router.ts then use these z.infer aliases, eliminating all body/response casts.
 */
import type { OpenAPIV3_1 } from 'openapi-types'
import type { GeneratedFile } from 'openapi-zod-ts'
import { toTypeName } from 'openapi-zod-ts'
import {
  SUPPORTED_METHODS,
  type SupportedMethod,
  isRef,
  refToName,
  extractPathParamsFromPath,
  resolveParam,
  deriveServiceName,
  deriveMethodName,
  type QueryParam,
  getQueryParams,
  type BodyInfo,
  getBodyInfo,
  objectPathItemEntries,
} from './shared.js'
import { escapeJsDocString, deriveEffectiveSecurity } from './security-meta.js'

// ── Simple header/cookie param descriptors (service-interface generation only) ─

/** Minimal shape needed to emit service method headers arg. */
export interface ServiceHeaderParam {
  /** Raw header name as it appears in the spec (original casing). */
  rawName: string
  required: boolean
}

/** Minimal shape needed to emit service method cookies arg. */
export interface ServiceCookieParam {
  rawName: string
  required: boolean
}

/** Collect resolved parameters of a specific `in` kind from an operation. */
function getServiceInParams(
  operation: OpenAPIV3_1.OperationObject,
  spec: OpenAPIV3_1.Document,
  inKind: 'header' | 'cookie'
): { rawName: string; required: boolean }[] {
  const parameters = operation.parameters as
    (OpenAPIV3_1.ParameterObject | OpenAPIV3_1.ReferenceObject)[] | undefined
  if (parameters === undefined) return []
  const result: { rawName: string; required: boolean }[] = []
  for (const p of parameters) {
    const resolved = resolveParam(p, spec)
    if (resolved === undefined || resolved.in !== inKind) continue
    result.push({ rawName: resolved.name, required: resolved.required === true })
  }
  return result
}

function getServiceHeaderParams(
  operation: OpenAPIV3_1.OperationObject,
  spec: OpenAPIV3_1.Document
): ServiceHeaderParam[] {
  return getServiceInParams(operation, spec, 'header')
}

function getServiceCookieParams(
  operation: OpenAPIV3_1.OperationObject,
  spec: OpenAPIV3_1.Document
): ServiceCookieParam[] {
  return getServiceInParams(operation, spec, 'cookie')
}

// Parallel type aliases to service.ts: both emitters need the same narrow local types.
// fallow-ignore-next-line code-duplication
type OperationObject = OpenAPIV3_1.OperationObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type ResponseObject = OpenAPIV3_1.ResponseObject

// ── Return type resolution (mirrors service.ts but with schema-type awareness) ──

interface ReturnInfo {
  typeName: string | undefined
  isArray: boolean
  isVoid: boolean
  primitiveType?: string
  isMultiStatus?: boolean
}

function collectContentfulTwoxxCodes(
  responses: Record<string, ResponseObject | ReferenceObject>
): string[] {
  return Object.keys(responses)
    .filter((k) => /^2\d\d$/.test(k) && k !== '204')
    .sort()
}

// fallow-ignore-next-line complexity
function getReturnInfo(operation: OperationObject): ReturnInfo {
  const responses = operation.responses as
    Record<string, ResponseObject | ReferenceObject> | undefined
  if (responses === undefined) return { typeName: undefined, isArray: false, isVoid: true }

  const contentfulCodes = collectContentfulTwoxxCodes(responses)
  const isMultiStatus = contentfulCodes.length > 1

  const twoxxCodes = [
    '200',
    '201',
    ...Object.keys(responses).filter(
      (k) => /^2\d\d$/.test(k) && k !== '200' && k !== '201' && k !== '204'
    ),
  ]

  for (const code of twoxxCodes) {
    const response = responses[code]
    if (response === undefined) continue
    if (isRef(response)) continue

    const resp = response as ResponseObject
    const content = resp.content as
      Record<string, { schema?: OpenAPIV3_1.SchemaObject | ReferenceObject }> | undefined
    if (content === undefined) continue

    const jsonContent = content['application/json']
    if (jsonContent !== undefined && jsonContent.schema !== undefined) {
      const schema = jsonContent.schema
      if (isRef(schema)) {
        return {
          typeName: refToName((schema as ReferenceObject).$ref),
          isArray: false,
          isVoid: false,
          isMultiStatus,
        }
      }

      const s = schema as OpenAPIV3_1.SchemaObject
      if (s.type === 'array') {
        const items = s.items as OpenAPIV3_1.SchemaObject | ReferenceObject | undefined
        if (items !== undefined && isRef(items)) {
          return {
            typeName: refToName((items as ReferenceObject).$ref),
            isArray: true,
            isVoid: false,
            isMultiStatus,
          }
        }
        return { typeName: undefined, isArray: true, isVoid: false, isMultiStatus }
      }

      // Inline JSON response: try synthesized response schema name candidates in order.
      //
      // Fallback order (first match wins, checked via resolveAliasType at buildReturnType time):
      //   1. toTypeName(operationId) + 'Schema'          e.g. LabInlineResponseSchema
      //   2. toTypeName(operationId) + 'ResponseSchema'   e.g. LabInlineBodyResponseSchema
      //   3. toTypeName(operationId) + statusCode + 'Schema' e.g. LabInlineBody200Schema
      //
      // Guard: skip when any candidate would collide with the body schema name.
      const operationId = operation.operationId
      if (operationId !== undefined && operationId.length > 0) {
        const synthesizedName = toTypeName(operationId)
        const bodyInfo = getBodyInfo(operation)
        const bodyTypeName = bodyInfo?.typeName

        // Candidate 1: operationId + Schema
        if (bodyTypeName !== synthesizedName) {
          return {
            typeName: synthesizedName,
            isArray: false,
            isVoid: false,
            isMultiStatus,
          }
        }

        // Candidate 2: operationId + ResponseSchema (typeName without 'Schema' suffix)
        const responseTypeName = `${synthesizedName}Response`
        if (bodyTypeName !== responseTypeName) {
          return {
            typeName: responseTypeName,
            isArray: false,
            isVoid: false,
            isMultiStatus,
          }
        }

        // Candidate 3: operationId + statusCode + Schema (typeName without 'Schema' suffix)
        const statusTypeName = `${synthesizedName}${code}`
        if (bodyTypeName !== statusTypeName) {
          return {
            typeName: statusTypeName,
            isArray: false,
            isVoid: false,
            isMultiStatus,
          }
        }
      }

      return { typeName: undefined, isArray: false, isVoid: false, isMultiStatus }
    }

    // fallow-ignore-next-line code-duplication
    // Parallel to service.ts getReturnInfo — both emitters must handle text/plain,
    // octet-stream, and 204 the same way. The return types differ (fastify-service.ts
    // carries isMultiStatus) so a shared cross-file helper would require exposing an
    // internal union type. Suppressed as inherent two-emitter parallel structure.
    if (content['text/plain'] !== undefined) {
      return { typeName: undefined, isArray: false, isVoid: false, primitiveType: 'string' }
    }

    if (content['application/octet-stream'] !== undefined) {
      return { typeName: undefined, isArray: false, isVoid: false, primitiveType: 'Uint8Array' }
    }
  }

  if (responses['204'] !== undefined) {
    return { typeName: undefined, isArray: false, isVoid: true }
  }

  return { typeName: undefined, isArray: false, isVoid: true }
}

interface OperationInfo {
  methodName: string
  httpMethod: SupportedMethod
  path: string
  pathParams: string[]
  queryParams: QueryParam[]
  headerParams: ServiceHeaderParam[]
  cookieParams: ServiceCookieParam[]
  bodyInfo: BodyInfo | undefined
  // fallow-ignore-next-line code-duplication
  // Parallel interface field to service.ts OperationInfo; both emitters need these fields.
  returnInfo: ReturnInfo & { isSynthesizedResponse?: boolean }
  /** Effective security requirements for this operation (operation.security ?? spec.security). */
  effectiveSecurity: Array<{ scheme: string; scopes: string[] }>
}

// Parallel operation collector to service.ts; each emitter owns its own collection pass.
function collectOperations(spec: OpenAPIV3_1.Document): OperationInfo[] {
  // fallow-ignore-next-line code-duplication
  const operations: OperationInfo[] = []

  for (const [path, pathItem] of objectPathItemEntries(spec)) {
    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method] as OperationObject | undefined
      if (operation === undefined) continue

      const methodName = deriveMethodName(operation.operationId, method, path)
      const pathParams = extractPathParamsFromPath(path)
      const queryParams = getQueryParams(operation, spec)
      const headerParams = getServiceHeaderParams(operation, spec)
      const cookieParams = getServiceCookieParams(operation, spec)
      const bodyInfo = getBodyInfo(operation)
      const returnInfo = getReturnInfo(operation) as ReturnInfo & {
        isSynthesizedResponse?: boolean
      }
      const effectiveSecurity = deriveEffectiveSecurity(operation, spec)

      operations.push({
        methodName,
        httpMethod: method,
        path,
        pathParams,
        queryParams,
        headerParams,
        cookieParams,
        bodyInfo,
        returnInfo,
        effectiveSecurity,
      })
    }
  }

  return operations
}

// ── Type resolution with schema-type awareness ────────────────────────────────

/**
 * Given a type name, return the appropriate TypeScript type string for use in the
 * Fastify-typed service. If a matching schema exists in schemaNames, return the
 * alias name (which maps to z.infer in schema-types.ts); otherwise return 'unknown'.
 */
function resolveAliasType(typeName: string | undefined, schemaNames: Set<string>): string {
  if (typeName === undefined) return 'unknown'
  if (schemaNames.has(`${typeName}Schema`)) return typeName
  return 'unknown'
}

// fallow-ignore-next-line complexity
function buildReturnType(
  info: ReturnInfo & { isSynthesizedResponse?: boolean },
  schemaNames: Set<string>
): string {
  if (info.isVoid) return 'Promise<void>'
  if (info.primitiveType !== undefined) return `Promise<${info.primitiveType}>`

  if (info.isMultiStatus === true) {
    let bodyType: string
    if (info.typeName !== undefined) {
      const alias = resolveAliasType(info.typeName, schemaNames)
      const baseType = alias !== 'unknown' ? alias : 'unknown'
      bodyType = info.isArray ? `${baseType}[]` : baseType
    } else {
      bodyType = info.isArray ? 'unknown[]' : 'unknown'
    }
    return `Promise<{ status: number; body: ${bodyType} }>`
  }

  if (info.typeName !== undefined) {
    const alias = resolveAliasType(info.typeName, schemaNames)
    if (alias !== 'unknown') {
      return info.isArray ? `Promise<${alias}[]>` : `Promise<${alias}>`
    }
  }

  return info.isArray ? 'Promise<unknown[]>' : 'Promise<unknown>'
}

// Cohesive signature builder: assembles a single required `input` object whose keys
// mirror the Fastify request (params/body/query/headers/cookies), keeping ctx separate.
// Zero facets -> no input param. This eliminates the required-after-optional TS1016 by
// construction: input is always required when present, so ctx can safely follow it.
// fallow-ignore-next-line complexity
function buildMethodSignature(
  op: OperationInfo,
  schemaNames: Set<string>,
  contextType?: string
): string {
  const facets: string[] = []

  // params facet: path params as required string fields.
  // Use the RAW param name (with quoting for non-identifier chars) so the key matches
  // what ZodTypeProvider puts on req.params at runtime. Do NOT sanitize (camelCase) the
  // key: sanitizeOperationId("job-id") -> "jobId" but req.params["job-id"] is the real key.
  if (op.pathParams.length > 0) {
    const fields = op.pathParams
      .map((p) => {
        const key = /[^a-zA-Z0-9_$]/.test(p) ? JSON.stringify(p) : p
        return `${key}: string`
      })
      .join('; ')
    facets.push(`params: { ${fields} }`)
  }

  // body facet: resolve type the same way as before.
  if (op.bodyInfo !== undefined) {
    // multipart/form-data and application/octet-stream bodies cannot be described by a
    // Zod body schema: the router passes req.body as unknown/Buffer for those content types.
    // A same-named schema (e.g. LabGallerySchema) may exist for the RESPONSE, not the body,
    // so we must not adopt it as the body param type here.
    // Parallel body-type resolver to service.ts buildMethodSignature; each emitter
    // owns its own signature-assembly pass with different type resolution logic.
    // fallow-ignore-next-line code-duplication
    let bodyType: string
    if (op.bodyInfo.contentType === 'multipart/form-data') {
      bodyType = 'unknown'
    } else if (op.bodyInfo.contentType === 'application/octet-stream') {
      bodyType = 'Buffer'
    } else if (op.bodyInfo.typeName !== undefined) {
      bodyType = resolveAliasType(op.bodyInfo.typeName, schemaNames)
    } else {
      bodyType = 'unknown'
    }
    // fallow-ignore-next-line code-duplication
    facets.push(`body: ${bodyType}`)
  }

  // query facet: preserve per-field optionality; the outer facet key is always required.
  if (op.queryParams.length > 0) {
    const fields = op.queryParams
      .map((q) => `${q.name}${q.required ? '' : '?'}: ${q.tsType}`)
      .join('; ')
    facets.push(`query: { ${fields} }`)
  }

  // headers facet: inner fields reflect each header's required flag.
  if (op.headerParams.length > 0) {
    const fields = op.headerParams
      .map((h) => {
        const key = JSON.stringify(h.rawName.toLowerCase())
        const valType = h.required ? 'string' : 'string | undefined'
        return `${key}${h.required ? '' : '?'}: ${valType}`
      })
      .join('; ')
    facets.push(`headers: { ${fields} }`)
  }

  // cookies facet: inner fields reflect each cookie's required flag.
  if (op.cookieParams.length > 0) {
    const fields = op.cookieParams
      .map((ck) => {
        const key = JSON.stringify(ck.rawName)
        const valType = ck.required ? 'string' : 'string | undefined'
        return `${key}${ck.required ? '' : '?'}: ${valType}`
      })
      .join('; ')
    facets.push(`cookies: { ${fields} }`)
  }

  const methodArgs: string[] = []
  if (facets.length > 0) {
    methodArgs.push(`input: { ${facets.join('; ')} }`)
  }
  if (contextType !== undefined) {
    methodArgs.push('ctx: Ctx')
  }

  const returnType = buildReturnType(op.returnInfo, schemaNames)
  return `${op.methodName}(${methodArgs.join(', ')}): ${returnType}`
}

// ── Options shared by both generators ────────────────────────────────────────

export interface FastifyServiceOptions {
  schemaNames: Set<string>
  schemaImportPath: string
  contextType?: string
}

// ── schema-types.ts generator ─────────────────────────────────────────────────

/**
 * Emit schema-types.ts: a generated file of z.infer aliases for every schema
 * in schemaNames. Both router.ts and service.ts import from this file instead
 * of models.ts, making body/response casts unnecessary.
 *
 * z.infer is equivalent to z.output: it reflects the post-validation, post-transform
 * shape. This is the correct type for a Fastify handler, where ZodTypeProvider has
 * already run the schema through .parse(). When a schema uses .transform(), .default(),
 * or coercion, this type will differ from the hand-authored models.ts interfaces.
 *
 * Alias naming: strip the trailing 'Schema' suffix.
 * Example: PetSchema -> export type Pet = z.infer<typeof PetSchema>
 */
export function generateFastifyTypes(
  schemaNames: Set<string>,
  schemaImportPath: string
): GeneratedFile {
  // Collect aliases in sorted order for deterministic output.
  const aliases: Array<{ typeName: string; schemaName: string }> = []
  for (const schemaName of Array.from(schemaNames).sort()) {
    if (!schemaName.endsWith('Schema')) continue
    const typeName = schemaName.slice(0, -'Schema'.length)
    if (typeName.length === 0) continue
    aliases.push({ typeName, schemaName })
  }

  const lines: string[] = []
  lines.push('// This file is auto-generated. Do not edit manually.')
  lines.push('// Fastify-aligned type aliases derived from Zod schemas via z.infer (= z.output).')
  lines.push('// These are post-validation, post-transform types: they reflect the shape after Zod')
  lines.push(
    '// has parsed and transformed the value, which can differ from models.ts when a schema'
  )
  lines.push(
    '// uses .transform(), .default(), or coercion. Import from here in your Fastify service.'
  )
  lines.push('')
  lines.push("import { z } from 'zod'")

  if (aliases.length > 0) {
    const sortedSchemaNames = aliases.map((a) => a.schemaName).join(', ')
    lines.push(`import { ${sortedSchemaNames} } from '${schemaImportPath}'`)
  }

  lines.push('')

  for (const { typeName, schemaName } of aliases) {
    lines.push(`export type ${typeName} = z.infer<typeof ${schemaName}>`)
  }

  lines.push('')

  return {
    filename: 'schema-types.ts',
    content: lines.join('\n'),
  }
}

// ── Fastify-typed service.ts generator ───────────────────────────────────────

/**
 * Emit service.ts for the Fastify zero-cast path.
 *
 * Method signatures use z.infer-derived alias types (from schema-types.ts) wherever
 * a matching schema exists. When no schema is available, the type falls back to unknown.
 * This matches what ZodTypeProvider infers for req.body and reply.send, so the generated
 * router.ts can pass req.body directly without any `as ModelType` cast.
 */
// fallow-ignore-next-line complexity
export function generateFastifyTypedService(
  spec: OpenAPIV3_1.Document,
  options: FastifyServiceOptions
): GeneratedFile {
  const serviceName = deriveServiceName(spec)
  const operations = collectOperations(spec)
  const { schemaNames, contextType } = options

  // Collect which alias type names are actually referenced in method signatures.
  const usedAliases = new Set<string>()
  for (const op of operations) {
    // Skip non-JSON bodies: their param type is always unknown/Buffer regardless of schemaNames.
    const isNonJsonBody =
      op.bodyInfo?.contentType === 'multipart/form-data' ||
      op.bodyInfo?.contentType === 'application/octet-stream'
    if (!isNonJsonBody && op.bodyInfo?.typeName !== undefined) {
      const alias = resolveAliasType(op.bodyInfo.typeName, schemaNames)
      if (alias !== 'unknown') usedAliases.add(alias)
    }
    if (op.returnInfo.typeName !== undefined) {
      const alias = resolveAliasType(op.returnInfo.typeName, schemaNames)
      if (alias !== 'unknown') usedAliases.add(alias)
    }
  }

  const lines: string[] = []
  lines.push('// This file is auto-generated. Do not edit manually.')
  lines.push('')

  if (usedAliases.size > 0) {
    const sorted = Array.from(usedAliases).sort()
    lines.push(`import type { ${sorted.join(', ')} } from './schema-types.js'`)
    lines.push('')
  }

  const interfaceDecl =
    contextType !== undefined
      ? `export interface ${serviceName}<Ctx = never> {`
      : `export interface ${serviceName} {`
  lines.push(interfaceDecl)

  for (const op of operations) {
    if (op.effectiveSecurity.length > 0) {
      // Emit a multi-line JSDoc with @security tags for each security requirement.
      // Scheme and scope strings from the spec are escaped to prevent comment injection.
      lines.push('  /**')
      lines.push(`   * ${op.httpMethod.toUpperCase()} ${op.path}`)
      for (const { scheme, scopes } of op.effectiveSecurity) {
        const safeScheme = escapeJsDocString(scheme)
        const safeScopesStr = scopes.map((s) => escapeJsDocString(s)).join(' ')
        lines.push(
          `   * @security ${safeScheme}${safeScopesStr.length > 0 ? ' ' + safeScopesStr : ''}`
        )
      }
      lines.push('   */')
    } else {
      lines.push(`  /** ${op.httpMethod.toUpperCase()} ${op.path} */`)
    }
    lines.push(`  ${buildMethodSignature(op, schemaNames, contextType)}`)
  }

  lines.push('}')
  lines.push('')

  return {
    filename: 'service.ts',
    content: lines.join('\n'),
  }
}
