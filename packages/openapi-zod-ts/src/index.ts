export type { Config } from './config.js'
export { loadConfig, loadConfigs, defineConfig, defineProjects } from './config.js'
export { parseSpec } from './parser.js'
export type { GeneratedFile } from './plugins/types.js'
export { generateTypes } from './plugins/types.js'
export { generateClientConfig } from './plugins/client-config.js'
export type { GenerateClientConfigOptions } from './plugins/client-config.js'
export {
  generateClient,
  generateClientFiles,
  tagToModuleName,
  hasCookieAuth,
  detectAuthSchemes,
  CLIENT_INTERNAL_NAMES,
  getParamPresence,
} from './plugins/client.js'
export type { AuthSchemes } from './plugins/client.js'
export { generateZodSchemas } from './plugins/zod.js'
export { generateServer } from './plugins/server.js'
export { generate } from './generator.js'
export type { GenerateOptions } from './generator.js'
export {
  toTypeName,
  toPropertyKey,
  uniquifyName,
  sanitizeOperationId,
  deriveOperationName,
  RESERVED,
} from './utils/naming.js'
export { buildWritableVariantMap, resolveBodyRefToWritableName } from './utils/writable-variants.js'
