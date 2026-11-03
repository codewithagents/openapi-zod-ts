/**
 * spec_prefix support (#334): share one schemas.ts across several specs.
 *
 * Every emitter looks schemas up by the bare convention name `${Type}Schema` and emits that
 * bare name as the identifier. To namespace a shared schemas file per spec without touching
 * each lookup site, the prefix is resolved once at the boundary:
 *
 *   exported `PublicApiGetUserSchema` + spec_prefix `PublicApi`
 *     -> lookup set contains `GetUserSchema`
 *     -> import is emitted as `import { PublicApiGetUserSchema as GetUserSchema } from ...`
 *
 * so the rest of the generated file keeps using `GetUserSchema` unchanged.
 */

/** Result of resolving exported schema names against an optional spec prefix. */
export interface PrefixedSchemaNames {
  /** Bare `${Type}Schema` names available to the emitters' convention lookups. */
  schemaNames: Set<string>
  /** Bare name -> actual exported name, only for names that differ (prefixed exports). */
  importAliases: Map<string, string>
}

/**
 * Resolve the exported schema names of an `input_schema` file against `specPrefix`.
 *
 * - No prefix: the exported names are used as-is (default behaviour, no aliases).
 * - With prefix: every export `${specPrefix}${Type}Schema` is exposed as `${Type}Schema`
 *   (aliased on import). Unprefixed exports stay available as a fallback, so schemas that
 *   are genuinely shared between specs (e.g. a common `ErrorSchema`) can stay unprefixed;
 *   a prefixed export always wins over an unprefixed one with the same bare name.
 */
export function resolvePrefixedSchemaNames(
  exported: Set<string>,
  specPrefix?: string
): PrefixedSchemaNames {
  const importAliases = new Map<string, string>()
  if (specPrefix === undefined || specPrefix.length === 0) {
    return { schemaNames: new Set(exported), importAliases }
  }
  const schemaNames = new Set<string>()
  for (const name of exported) {
    const bare = name.startsWith(specPrefix) ? name.slice(specPrefix.length) : undefined
    // Only strip at a word boundary: generated type names are PascalCase, so what remains must
    // start with an uppercase letter (`Admin` + `UserSchema`, not `Admin` + `istratorSchema`)
    // and still be a `${Type}Schema` identifier (Type non-empty).
    if (bare !== undefined && bare.length > 'Schema'.length && /^[A-Z]/.test(bare)) {
      schemaNames.add(bare)
      importAliases.set(bare, name)
    } else {
      schemaNames.add(name)
    }
  }
  return { schemaNames, importAliases }
}

/**
 * Format the specifier list of a schema import, aliasing prefixed exports back to their bare
 * names (`PublicApiGetUserSchema as GetUserSchema`). Names are sorted by bare name.
 */
export function formatSchemaImportSpecifiers(
  bareNames: Iterable<string>,
  importAliases?: Map<string, string>
): string {
  return Array.from(bareNames)
    .sort()
    .map((bare) => {
      const actual = importAliases?.get(bare)
      return actual !== undefined && actual !== bare ? `${actual} as ${bare}` : bare
    })
    .join(', ')
}
