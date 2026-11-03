import type { OpenAPIV3_1 } from 'openapi-types'
import type { GeneratedFile } from 'openapi-zod-ts'
import { buildWritableVariantMap } from 'openapi-zod-ts'
import {
  SUPPORTED_METHODS,
  type SupportedMethod,
  isRef,
  refToName,
  extractPathParamsFromPath,
  deriveServiceName,
  sanitizeOperationId,
  deriveMethodName,
  type QueryParam,
  getQueryParams,
  type BodyInfo,
  getBodyInfo,
  warnOnNonObjectPathItems,
  objectPathItemEntries,
} from './shared.js'

type OperationObject = OpenAPIV3_1.OperationObject
type ReferenceObject = OpenAPIV3_1.ReferenceObject
type ResponseObject = OpenAPIV3_1.ResponseObject

interface ReturnInfo {
  typeName: string | undefined
  isArray: boolean
  isVoid: boolean
  /**
   * For non-JSON success responses: the TypeScript primitive type to use as the
   * return type. 'string' for text/plain; 'Uint8Array' for application/octet-stream.
   * When set, typeName is undefined and the type is NOT imported from models.ts.
   */
  primitiveType?: string
  /**
   * True when the operation declares more than one 2xx success response.
   * The service method returns a discriminated envelope { status: number; body: T }
   * so the handler can select the appropriate status code at runtime.
   * The body type T is inferred from the first 2xx response that has JSON content.
   */
  isMultiStatus?: boolean
}

/**
 * Collect all 2xx response codes from an operation's responses object, sorted numerically.
 * Excludes 204 (void) since those carry no body.
 */
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

  // Detect multi-status: more than one 2xx response code (excluding 204).
  const contentfulCodes = collectContentfulTwoxxCodes(responses)
  const isMultiStatus = contentfulCodes.length > 1

  // Check 2xx responses in priority order: 200, 201, then any other 2xx with content.
  // 204 (void) and multi-2xx cases are handled below.
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

      return { typeName: undefined, isArray: false, isVoid: false, isMultiStatus }
    }

    // text/plain response: service returns a plain string.
    if (content['text/plain'] !== undefined) {
      return { typeName: undefined, isArray: false, isVoid: false, primitiveType: 'string' }
    }

    // application/octet-stream response: service returns raw bytes.
    if (content['application/octet-stream'] !== undefined) {
      return { typeName: undefined, isArray: false, isVoid: false, primitiveType: 'Uint8Array' }
    }
  }

  // Check for 204 explicitly
  if (responses['204'] !== undefined) {
    return { typeName: undefined, isArray: false, isVoid: true }
  }

  return { typeName: undefined, isArray: false, isVoid: true }
}

// fallow-ignore-next-line complexity
function buildReturnType(info: ReturnInfo): string {
  if (info.isVoid) return 'Promise<void>'
  if (info.primitiveType !== undefined) return `Promise<${info.primitiveType}>`
  // Multi-status: wrap in discriminated envelope { status: number; body: T }
  if (info.isMultiStatus === true) {
    let bodyType: string
    if (info.typeName !== undefined) {
      bodyType = info.isArray ? `${info.typeName}[]` : info.typeName
    } else {
      bodyType = info.isArray ? 'unknown[]' : 'unknown'
    }
    return `Promise<{ status: number; body: ${bodyType} }>`
  }
  if (info.typeName !== undefined) {
    return info.isArray ? `Promise<${info.typeName}[]>` : `Promise<${info.typeName}>`
  }
  return info.isArray ? 'Promise<unknown[]>' : 'Promise<unknown>'
}

interface OperationInfo {
  methodName: string
  httpMethod: SupportedMethod
  path: string
  pathParams: string[]
  queryParams: QueryParam[]
  bodyInfo: BodyInfo | undefined
  returnInfo: ReturnInfo
}

function collectOperations(
  spec: OpenAPIV3_1.Document,
  writableVariantMap?: Map<string, string>
): OperationInfo[] {
  // fallow-ignore-next-line code-duplication
  const operations: OperationInfo[] = []

  for (const [path, pathItem] of objectPathItemEntries(spec)) {
    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method] as OperationObject | undefined
      if (operation === undefined) continue

      const methodName = deriveMethodName(operation.operationId, method, path)
      const pathParams = extractPathParamsFromPath(path)
      const queryParams = getQueryParams(operation, spec)
      const bodyInfo = getBodyInfo(operation, writableVariantMap)
      const returnInfo = getReturnInfo(operation)

      // Warn when the return type falls back to unknown due to a missing or
      // unresolvable response schema. Fires for Promise<unknown> and Promise<unknown[]>.
      // Does not fire for void, typed, or primitive (text/plain, octet-stream) responses.
      if (
        returnInfo.typeName === undefined &&
        !returnInfo.isVoid &&
        returnInfo.primitiveType === undefined
      ) {
        console.warn(
          `${methodName} (${method.toUpperCase()} ${path}): response type is unknown, ` +
            'no named response schema could be resolved from the spec. ' +
            'Add a named $ref response schema to get a typed return type and enable runtime validation.'
        )
      }

      operations.push({
        methodName,
        httpMethod: method,
        path,
        pathParams,
        queryParams,
        bodyInfo,
        returnInfo,
      })
    }
  }

  return operations
}

/** Options for the service generator. */
export interface ServiceOptions {
  /**
   * When set, the generated interface becomes `XService<Ctx = never>` and each method
   * receives a final `ctx: Ctx` argument. Use this to thread a caller principal
   * (auth context, request metadata, etc.) into service methods without coupling
   * the service interface to any specific framework type.
   *
   * Example: `contextType: 'RequestContext'`
   * Result:  `export interface PetstoreService<Ctx = never> { listPets(ctx: Ctx): Promise<Pet[]> }`
   *
   * When not set (the default), the interface is generated without a generic parameter
   * and all existing code remains unchanged.
   */
  contextType?: string
}

// fallow-ignore-next-line complexity
function buildMethodSignature(op: OperationInfo, options?: ServiceOptions): string {
  const args: string[] = []

  // Path params as positional string args (in template order).
  // Raw names are sanitized to valid TypeScript identifiers here.
  for (const p of op.pathParams) {
    args.push(`${sanitizeOperationId(p)}: string`)
  }

  // Body arg: synthesized names (inline schemas, not $ref) live only in schemas.ts
  // for Zod safeParse — they have no corresponding model type in models.ts.
  // Use 'unknown' for synthesized bodies so service.ts does not emit a dangling import.
  // When the body $ref has a writable variant (readOnly/writeOnly, direct or transitive),
  // use the XWritable name so the service interface accepts the write shape for requests.
  if (op.bodyInfo !== undefined) {
    let typeName: string
    if (op.bodyInfo.typeName !== undefined && !op.bodyInfo.isSynthesized) {
      typeName = op.bodyInfo.writableTypeName ?? op.bodyInfo.typeName
    } else {
      typeName = 'unknown'
    }
    args.push(`body: ${typeName}`)
  }

  // Query params as optional object
  if (op.queryParams.length > 0) {
    const allOptional = op.queryParams.every((q) => !q.required)
    const fields = op.queryParams
      .map((q) => `${q.name}${q.required ? '' : '?'}: ${q.tsType}`)
      .join('; ')
    const paramsToken = allOptional ? 'params?' : 'params'
    args.push(`${paramsToken}: { ${fields} }`)
  }

  // Context arg: appended last so all existing positional args remain in place.
  if (options?.contextType !== undefined) {
    args.push('ctx: Ctx')
  }

  const returnType = buildReturnType(op.returnInfo)
  const argStr = args.join(', ')
  return `${op.methodName}(${argStr}): ${returnType}`
}

export function generateService(
  spec: OpenAPIV3_1.Document,
  options?: ServiceOptions
): GeneratedFile {
  warnOnNonObjectPathItems(spec)
  const serviceName = deriveServiceName(spec)
  const writableVariantMap = buildWritableVariantMap(spec)
  const operations = collectOperations(spec, writableVariantMap)

  // Collect import types: body types and return types that are named identifiers.
  // Synthesized body names (inline schemas, isSynthesized:true) are excluded: they have
  // no entry in models.ts and emitting them as imports would cause a dangling TS error.
  // Request bodies import the XWritable variant when one exists (matches buildMethodSignature),
  // responses keep the base read type.
  const importTypes = new Set<string>()
  for (const op of operations) {
    if (op.bodyInfo?.typeName !== undefined && !op.bodyInfo.isSynthesized) {
      importTypes.add(op.bodyInfo.writableTypeName ?? op.bodyInfo.typeName)
    }
    if (op.returnInfo.typeName !== undefined) {
      importTypes.add(op.returnInfo.typeName)
    }
  }

  const sortedImports = Array.from(importTypes).sort()

  const lines: string[] = []
  lines.push('// This file is auto-generated. Do not edit manually.')
  lines.push('')

  if (sortedImports.length > 0) {
    lines.push(`import type { ${sortedImports.join(', ')} } from './models.js'`)
    lines.push('')
  }

  // When a context type is configured, emit the interface with a generic Ctx parameter.
  // The default `Ctx = never` keeps the interface usable without specifying a type argument.
  const interfaceDecl =
    options?.contextType !== undefined
      ? `export interface ${serviceName}<Ctx = never> {`
      : `export interface ${serviceName} {`
  lines.push(interfaceDecl)

  for (const op of operations) {
    lines.push(`  /** ${op.httpMethod.toUpperCase()} ${op.path} */`)
    lines.push(`  ${buildMethodSignature(op, options)}`)
  }

  lines.push('}')
  lines.push('')

  return {
    filename: 'service.ts',
    content: lines.join('\n'),
  }
}
