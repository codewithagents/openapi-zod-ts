/**
 * Unit tests for the readOnly/writeOnly request/response type variant split (#211)
 * and the transitive container split extension (#nested-response-variant).
 *
 * Verifies:
 * - Schema with readOnly props: X emits without readOnly props, XWritable omits them.
 * - Schema with writeOnly props: X omits writeOnly props, XWritable includes them.
 * - Schema with BOTH readOnly and writeOnly: X and XWritable are both correctly filtered.
 * - Plain schema (no readOnly/writeOnly): single unchanged type, NO XWritable variant.
 * - allOf schema with writeOnly in inline member: both shapes emitted correctly.
 * - Request body referencing a split schema uses XWritable.
 * - Response referencing a split schema uses X.
 * - XWritable is always a plain TS interface (not z.infer).
 */
import { describe, it, expect } from 'vitest'
import { generateTypes } from '../plugins/types.js'
import { generateClient } from '../plugins/client.js'
import { buildWritableVariantMap } from '../utils/writable-variants.js'
import type { OpenAPIV3_1 } from 'openapi-types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(
  schemas: Record<string, OpenAPIV3_1.SchemaObject>,
  paths?: OpenAPIV3_1.Document['paths']
): OpenAPIV3_1.Document {
  return {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1' },
    paths: paths ?? {},
    components: { schemas },
  }
}

// ---------------------------------------------------------------------------
// models.ts split emission tests
// ---------------------------------------------------------------------------

describe('readOnly/writeOnly split: models.ts', () => {
  it('emits X without writeOnly prop and XWritable without readOnly prop', () => {
    const spec = makeSpec({
      User: {
        type: 'object',
        properties: {
          // readOnly: server-set, omit from write shape
          id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          name: { type: 'string' },
          // writeOnly: client-only, omit from read shape
          password: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
    })
    const out = generateTypes(spec).content

    // Read shape (User): should have id and name, NOT password
    expect(out).toContain('export interface User {')
    expect(out).toMatch(/id\??\s*:\s*string/)
    expect(out).toMatch(/name\??\s*:\s*string/)
    // password is writeOnly so excluded from read shape
    expect(out).not.toMatch(/export interface User \{[^}]*password/)

    // Write shape (UserWritable): should have name and password, NOT id
    expect(out).toContain('export interface UserWritable {')
    expect(out).toMatch(/password\??\s*:\s*string/)
    // id is readOnly so excluded from write shape
    expect(out).not.toMatch(/export interface UserWritable \{[^}]*\n.*id/)
  })

  it('single readOnly prop: X omits it, XWritable keeps it... wait, readOnly goes in X only', () => {
    // readOnly: X includes it (it is a response-side field), XWritable excludes it
    const spec = makeSpec({
      Article: {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          title: { type: 'string' },
        },
      },
    })
    const out = generateTypes(spec).content

    // X (Article) includes id (it is readOnly, present in read shape)
    expect(out).toContain('export interface Article {')
    expect(out).toMatch(/id\??\s*:\s*string/)
    expect(out).toMatch(/title\??\s*:\s*string/)

    // XWritable (ArticleWritable) excludes id (readOnly) but keeps title
    expect(out).toContain('export interface ArticleWritable {')
    expect(out).toMatch(/title\??\s*:\s*string/)
    // id should not appear in ArticleWritable
    const writableSection = out.slice(out.indexOf('export interface ArticleWritable {'))
    const closingBrace = writableSection.indexOf('}')
    const writableBody = writableSection.slice(0, closingBrace + 1)
    expect(writableBody).not.toContain('id')
  })

  it('single writeOnly prop: X omits it, XWritable includes it', () => {
    const spec = makeSpec({
      Credential: {
        type: 'object',
        properties: {
          username: { type: 'string' },
          secret: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
    })
    const out = generateTypes(spec).content

    // X (Credential) excludes secret (writeOnly)
    expect(out).toContain('export interface Credential {')
    expect(out).toMatch(/username\??\s*:\s*string/)
    const readSection = out.slice(out.indexOf('export interface Credential {'))
    const readClose = readSection.indexOf('}')
    const readBody = readSection.slice(0, readClose + 1)
    expect(readBody).not.toContain('secret')

    // XWritable (CredentialWritable) includes secret
    expect(out).toContain('export interface CredentialWritable {')
    expect(out).toMatch(/secret\??\s*:\s*string/)
  })

  it('plain schema with no readOnly/writeOnly: single type, no XWritable', () => {
    const spec = makeSpec({
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    })
    const out = generateTypes(spec).content

    // Only one type for Tag
    expect(out).toContain('export interface Tag {')
    expect(out).not.toContain('TagWritable')
  })

  it('allOf schema with writeOnly in inline member: both shapes emitted', () => {
    // Pattern common in real specs: allOf with a $ref base + inline member with writeOnly
    const spec = makeSpec({
      BaseUser: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
        },
      },
      UserWithPassword: {
        allOf: [
          { $ref: '#/components/schemas/BaseUser' },
          {
            type: 'object',
            properties: {
              email: { type: 'string' },
              password: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
            },
          } as OpenAPIV3_1.SchemaObject,
        ],
      } as OpenAPIV3_1.SchemaObject,
    })
    const out = generateTypes(spec).content

    // X (UserWithPassword): allOf type with password excluded from inline member
    expect(out).toContain('export type UserWithPassword =')
    // The read shape should contain email but NOT password
    expect(out).toContain('email')
    // password should NOT appear in the read-shape allOf expansion
    const readSection = out.slice(
      out.indexOf('export type UserWithPassword ='),
      out.indexOf('export interface UserWithPasswordWritable')
    )
    expect(readSection).not.toContain('password')

    // XWritable (UserWithPasswordWritable): flat interface with email + password
    expect(out).toContain('export interface UserWithPasswordWritable {')
    expect(out).toMatch(/email\??\s*:\s*string/)
    expect(out).toMatch(/password\??\s*:\s*string/)
  })

  it('the auto-generated banner is present', () => {
    const spec = makeSpec({
      Foo: { type: 'object', properties: { x: { type: 'string' } } },
    })
    const out = generateTypes(spec).content
    expect(out.startsWith('// This file is auto-generated by openapi-zod-ts')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// client.ts request body wiring tests
// ---------------------------------------------------------------------------

describe('readOnly/writeOnly split: client.ts request body wiring', () => {
  it('POST request body with $ref to split schema uses XWritable', () => {
    const spec = makeSpec(
      {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
            name: { type: 'string' },
            password: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
          },
        },
      },
      {
        '/users': {
          post: {
            operationId: 'createUser',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/User' } },
              },
            },
            responses: {
              '201': {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
        },
      }
    )
    const clientOut = generateClient(spec).content

    // Request body should reference UserWritable
    expect(clientOut).toContain('body: UserWritable')
    // UserWritable must be imported from ./models.js
    expect(clientOut).toContain('UserWritable')
    expect(clientOut).toMatch(/import type \{[^}]*UserWritable[^}]*\} from '\.\/models\.js'/)
  })

  it('GET response with $ref to split schema still uses X (read shape)', () => {
    const spec = makeSpec(
      {
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
            name: { type: 'string' },
          },
        },
      },
      {
        '/products/{id}': {
          get: {
            operationId: 'getProduct',
            parameters: [{ name: 'id', in: 'path', required: true }],
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Product' } },
                },
              },
            },
          },
        },
      }
    )
    const clientOut = generateClient(spec).content

    // Return type should be Product (read shape), not ProductWritable
    expect(clientOut).toContain('Promise<Product>')
    expect(clientOut).not.toContain('Promise<ProductWritable>')
  })

  it('schema without readOnly/writeOnly: client uses X (unchanged name) for request body', () => {
    const spec = makeSpec(
      {
        Item: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            value: { type: 'number' },
          },
        },
      },
      {
        '/items': {
          post: {
            operationId: 'createItem',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } },
              },
            },
            responses: {
              '201': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
              },
            },
          },
        },
      }
    )
    const clientOut = generateClient(spec).content

    // No split: body uses Item directly
    expect(clientOut).toContain('body: Item')
    expect(clientOut).not.toContain('ItemWritable')
  })
})

// ---------------------------------------------------------------------------
// Transitive container split: buildWritableVariantMap
// ---------------------------------------------------------------------------

describe('transitive container split: buildWritableVariantMap', () => {
  it('includes a container whose array items $ref a split leaf', () => {
    const spec = makeSpec({
      Item: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          serverId: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          secret: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
      Container: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Item' },
          } as OpenAPIV3_1.SchemaObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const map = buildWritableVariantMap(spec)
    expect(map.has('Item')).toBe(true)
    expect(map.has('Container')).toBe(true)
  })

  it('includes a container whose $ref property points to a split leaf', () => {
    // Single $ref property (not an array) should also trigger transitive inclusion.
    const spec = makeSpec({
      WebData: {
        type: 'object',
        properties: {
          token: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
          url: { type: 'string' },
        },
      },
      Individual: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          webData: { $ref: '#/components/schemas/WebData' } as OpenAPIV3_1.ReferenceObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const map = buildWritableVariantMap(spec)
    expect(map.has('WebData')).toBe(true)
    expect(map.has('Individual')).toBe(true)
  })

  it('does NOT include a container whose nested refs are all plain (no split)', () => {
    const spec = makeSpec({
      Item: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      },
      Container: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Item' },
          } as OpenAPIV3_1.SchemaObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const map = buildWritableVariantMap(spec)
    expect(map.has('Item')).toBe(false)
    expect(map.has('Container')).toBe(false)
  })

  it('handles container-of-container transitive closure (A -> B -> split C)', () => {
    const spec = makeSpec({
      SplitLeaf: {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          name: { type: 'string' },
        },
      },
      Middle: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/SplitLeaf' },
          } as OpenAPIV3_1.SchemaObject,
        },
      } as OpenAPIV3_1.SchemaObject,
      Outer: {
        type: 'object',
        properties: {
          nested: { $ref: '#/components/schemas/Middle' } as OpenAPIV3_1.ReferenceObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const map = buildWritableVariantMap(spec)
    expect(map.has('SplitLeaf')).toBe(true)
    expect(map.has('Middle')).toBe(true)
    expect(map.has('Outer')).toBe(true)
  })

  it('terminates without error when schemas have cyclic $ref (cycle guard)', () => {
    // A references B and B references A: the fixpoint must not loop forever.
    const spec = makeSpec({
      NodeA: {
        type: 'object',
        properties: {
          child: { $ref: '#/components/schemas/NodeB' } as OpenAPIV3_1.ReferenceObject,
          id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      } as OpenAPIV3_1.SchemaObject,
      NodeB: {
        type: 'object',
        properties: {
          parent: { $ref: '#/components/schemas/NodeA' } as OpenAPIV3_1.ReferenceObject,
          label: { type: 'string' },
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    // Should not throw or hang; both schemas end up in the map because NodeA has readOnly.
    expect(() => buildWritableVariantMap(spec)).not.toThrow()
    const map = buildWritableVariantMap(spec)
    expect(map.has('NodeA')).toBe(true)
    // NodeB refs NodeA which is in the split set -> transitively included.
    expect(map.has('NodeB')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Transitive container split: deep-ref renderer in models.ts
// ---------------------------------------------------------------------------

describe('transitive container split: generateTypes models.ts', () => {
  it('emits read Container with items: Item[] and write ContainerWritable with items: ItemWritable[]', () => {
    const spec = makeSpec({
      Item: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          serverId: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          secret: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
      Container: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Item' },
          } as OpenAPIV3_1.SchemaObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const out = generateTypes(spec).content

    // Item: read shape has name + serverId, no secret
    expect(out).toContain('export interface Item {')
    expect(out).toMatch(/serverId\??\s*:\s*string/)
    expect(out).not.toMatch(/export interface Item \{[^}]*secret/)

    // ItemWritable: write shape has name + secret, no serverId
    expect(out).toContain('export interface ItemWritable {')
    expect(out).toMatch(/secret\??\s*:\s*string/)

    // Container (read): items are Item[], not ItemWritable[]
    expect(out).toContain('export interface Container {')
    // The read items field should reference Item[]
    const containerSection = out.slice(out.indexOf('export interface Container {'))
    const containerClose = containerSection.indexOf('\n}')
    const containerBody = containerSection.slice(0, containerClose + 2)
    expect(containerBody).toContain('Item[]')
    expect(containerBody).not.toContain('ItemWritable[]')

    // ContainerWritable (write): items are ItemWritable[]
    expect(out).toContain('export interface ContainerWritable {')
    const writableSection = out.slice(out.indexOf('export interface ContainerWritable {'))
    const writableClose = writableSection.indexOf('\n}')
    const writableBody = writableSection.slice(0, writableClose + 2)
    expect(writableBody).toContain('ItemWritable[]')
  })

  it('emits deep-write ContainerWritable for a single $ref property (non-array)', () => {
    // Individual.webData: WebData -> Individual gets IndividualWritable with webData?: WebDataWritable
    const spec = makeSpec({
      WebData: {
        type: 'object',
        properties: {
          token: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
          url: { type: 'string' },
        },
      },
      Individual: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          webData: { $ref: '#/components/schemas/WebData' } as OpenAPIV3_1.ReferenceObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const out = generateTypes(spec).content

    expect(out).toContain('export interface IndividualWritable {')
    const writableSection = out.slice(out.indexOf('export interface IndividualWritable {'))
    const writableClose = writableSection.indexOf('\n}')
    const writableBody = writableSection.slice(0, writableClose + 2)
    // The $ref property should be rewritten to WebDataWritable, not WebData.
    expect(writableBody).toContain('WebDataWritable')
    expect(writableBody).not.toContain('webData?: WebData\n')
  })

  it('schema-enhanced mode: transitive container emits spec-derived read interface, NOT z.infer', () => {
    const spec = makeSpec({
      Item: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          serverId: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          secret: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
      Container: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/Item' },
          } as OpenAPIV3_1.SchemaObject,
        },
      } as OpenAPIV3_1.SchemaObject,
    })
    const schemaNames = new Set(['ItemSchema', 'ContainerSchema'])
    const out = generateTypes(spec, { schemaNames, schemaImportPath: './schemas.js' }).content

    // Item has direct split flags: keeps z.infer as its read type.
    expect(out).toContain('export type Item = z.infer<typeof ItemSchema>')

    // Container is transitively in the map (no direct flags): spec-derived read interface.
    expect(out).not.toContain('export type Container = z.infer<typeof ContainerSchema>')
    expect(out).toContain('export interface Container {')
    // The spec-derived read interface has items: Item[] (not ItemWritable[]).
    const containerSection = out.slice(out.indexOf('export interface Container {'))
    const containerClose = containerSection.indexOf('\n}')
    const containerBody = containerSection.slice(0, containerClose + 2)
    expect(containerBody).toContain('Item[]')

    // ContainerWritable is also emitted alongside the spec-derived Container interface.
    expect(out).toContain('export interface ContainerWritable {')
    expect(out).toContain('ItemWritable[]')
  })

  it('schema-enhanced mode: leaf schema with direct split keeps z.infer for read type (regression guard)', () => {
    // A leaf schema that has direct readOnly/writeOnly flags must NOT switch to spec-derived.
    // The user's Zod schema is the read source of truth for direct-split leaves.
    const spec = makeSpec({
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          name: { type: 'string' },
          password: { type: 'string', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
    })
    const schemaNames = new Set(['UserSchema'])
    const out = generateTypes(spec, { schemaNames, schemaImportPath: './schemas.js' }).content

    // Direct-split leaf: read type stays z.infer.
    expect(out).toContain('export type User = z.infer<typeof UserSchema>')
    // XWritable is still emitted.
    expect(out).toContain('export interface UserWritable {')
  })

  it('plain non-container direct split emits exactly one read interface + one Writable (regression guard)', () => {
    // A schema with direct readOnly/writeOnly in plain (non-schema-enhanced) mode:
    // must emit exactly X (read) and XWritable (write), nothing spurious.
    const spec = makeSpec({
      Article: {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true } as OpenAPIV3_1.SchemaObject,
          title: { type: 'string' },
          draft: { type: 'boolean', writeOnly: true } as OpenAPIV3_1.SchemaObject,
        },
      },
    })
    const out = generateTypes(spec).content

    // Exactly one Article (read) and one ArticleWritable.
    const articleCount = (out.match(/export interface Article /g) ?? []).length
    const writableCount = (out.match(/export interface ArticleWritable /g) ?? []).length
    expect(articleCount).toBe(1)
    expect(writableCount).toBe(1)
    // No spurious Article_2 or ArticleWritable_2.
    expect(out).not.toContain('Article_2')
    expect(out).not.toContain('ArticleWritable_2')
  })
})
