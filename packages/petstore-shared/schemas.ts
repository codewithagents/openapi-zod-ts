// Bootstrapped by openapi-zod-ts — this file is yours.
// Add error messages, refinements, and business rules freely.
// Re-running the generator will NOT overwrite this file.
// Requires zod v4 (z.record takes two args, z.lazy for circular refs).

import { z } from 'zod'

export const PetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    species: z.string(),
  })
  .passthrough()

export const CreatePetRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  species: z.string().min(1, 'Species is required'),
})

// ---------------------------------------------------------------------------
// Lab schemas — hand-written Zod, wired by the generator via safeParse
// ---------------------------------------------------------------------------

export const LabNumericSchema = z.object({
  bounded: z.number().int().min(10).max(20),
  exclusive: z.number().gt(0).lt(1),
  multiple: z.number().int().multipleOf(5),
})

export const LabStringSchema = z.object({
  sized: z.string().min(3).max(8),
  coded: z.string().regex(/^[A-Z]{2}-[0-9]{4}$/),
})

export const LabArraySchema = z.object({
  bag: z.array(z.string()).min(2).max(4),
  distinct: z
    .array(z.number().int())
    .refine((arr) => new Set(arr).size === arr.length, { message: 'Array items must be unique' }),
})

// Custom regex for formats the generator does not natively validate
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?$/
const DURATION_REGEX =
  /^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/
const HOSTNAME_REGEX =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^localhost$/

export const LabFormatsSchema = z.object({
  day: z.string().regex(ISO_DATE_REGEX, 'Invalid date format (expected YYYY-MM-DD)'),
  moment: z.string().datetime({ offset: true }),
  clock: z.string().regex(TIME_REGEX, 'Invalid time format (expected HH:MM:SS)'),
  span: z.string().regex(DURATION_REGEX, 'Invalid ISO 8601 duration'),
  mail: z.string().email(),
  identifier: z.string().uuid(),
  host: z.string().regex(HOSTNAME_REGEX, 'Invalid hostname'),
})

export const LabEnumConstSchema = z.object({
  color: z.enum(['red', 'green', 'blue']),
  version: z.literal('v2'),
})

export const LabClosedSchema = z
  .object({
    known: z.string(),
  })
  .strict()

export const LabPresenceSchema = z.object({
  mandatory: z.string(),
  nullableField: z.string().nullable().optional().default(null),
  optionalField: z
    .string()
    .optional()
    .default(null as unknown as string),
  withDefault: z.string().optional().default('fallback'),
})

export const LabMapSchema = z.object({
  label: z.string(),
  counts: z.record(z.string(), z.number().int()).optional(),
})

export const LabUnionSchema = z.object({
  value: z.union([z.string(), z.number().int()]),
})

export const LabAnyOfSchema = z.object({
  value: z.union([z.boolean(), z.number().int()]),
})

// Discriminated shapes
export const LabCircleSchema = z.object({
  kind: z.literal('circle'),
  radius: z.number().gt(0),
})

export const LabSquareSchema = z.object({
  kind: z.literal('square'),
  side: z.number().gt(0),
})

export const LabShapeSchema = z.discriminatedUnion('kind', [LabCircleSchema, LabSquareSchema])

// Inline-union discriminated shape (dog/cat)
const LabDogSchema = z.object({
  petType: z.literal('dog'),
  bark: z.string(),
})
const LabCatSchema = z.object({
  petType: z.literal('cat'),
  meow: z.string(),
})
export const LabInlineShapeSchema = z.discriminatedUnion('petType', [LabDogSchema, LabCatSchema])

// allOf-inheritance vehicle union (hand-written merged Zod with discriminator)
export const LabVehicleBaseSchema = z.discriminatedUnion('vehicleType', [
  z.object({ vehicleType: z.literal('car'), wheels: z.number().int().min(3) }),
  z.object({ vehicleType: z.literal('boat'), draft: z.number().gt(0) }),
])

// Backed enum
export const LabPrioritySchema = z.enum(['low', 'medium', 'high'])

export const LabBackedEnumSchema = z.object({
  priority: LabPrioritySchema,
})

// LabBase + LabAllOf (hand-written merged allOf = flattened object)
export const LabBaseSchema = z.object({
  baseField: z.string(),
})

export const LabAllOfSchema = LabBaseSchema.extend({
  extraField: z.number().int(),
})

// Tuple via prefixItems (pair: [string, integer >= 0])
export const LabTupleSchema = z.object({
  pair: z.tuple([z.string(), z.number().int().min(0)]),
})

// Nested-variant: write schema accepts secret (writeOnly), ignores serverId (readOnly)
const LabVariantItemWriteSchema = z.object({
  name: z.string(),
  secret: z.string(),
})

export const LabNestedVariantSchema = z.object({
  title: z.string(),
  items: z.array(LabVariantItemWriteSchema),
})

// LabVariantItemSchema (read variant, for completeness)
export const LabVariantItemSchema = z.object({
  name: z.string(),
  serverId: z.string().optional(),
})

// Response-union selector
export const LabUnionSelectorSchema = z.object({
  want: z.enum(['circle', 'square']),
})

// Loose union (undiscriminated object union): presence-only validation
export const LabLooseUnionSchema = z.object({
  payload: z.unknown(),
})

// Query echo (response schema, not a request body)
export const LabQueryEchoSchema = z.object({
  tier: z.string(),
  count: z.number().int(),
  code: z.string(),
})

// Header echo (response schema, not a request body)
export const LabHeaderEchoSchema = z.object({
  token: z.string(),
})

// Phase 2 schemas

// Int64 echo: JavaScript numbers are IEEE 754 doubles (53-bit mantissa).
// Large int64 values (> 2^53 - 1) will lose precision on round-trip.
export const LabInt64Schema = z.object({
  ledger: z.number().int().min(0),
})

// Inline JSON body (Bug #1): the generator synthesizes the name LabInlineBody
// from operationId 'labInlineBody' and looks for LabInlineBodySchema here.
export const LabInlineBodySchema = z.object({
  title: z.string().min(2),
  rank: z.number().int().min(1).max(5),
})

// Form-urlencoded body (Bug #7): the generator synthesizes the name LabFormBody
// from operationId 'labFormBody' and looks for LabFormBodySchema here.
// Form values are strings on the wire; z.coerce.number() handles the conversion.
export const LabFormBodySchema = z.object({
  label: z.string(),
  quantity: z.coerce.number().int(),
})

// Synthesized schemas for inline JSON responses (operationId-based naming).
// These are used by openapi-server to wire schema.response for Fastify routes.
// Add refinements here as needed.

// GET /lab/inline-response: inline { ok: boolean, note: string } response.
export const LabInlineResponseSchema = z.object({
  ok: z.boolean(),
  note: z.string(),
})

// POST /lab/response-union: oneOf circle | square inline response.
export const LabResponseUnionSchema = z.union([
  z.object({ kind: z.literal('circle'), radius: z.number() }),
  z.object({ kind: z.literal('square'), side: z.number() }),
])

// POST /lab/gallery: multipart upload acknowledgement.
export const LabGallerySchema = z.object({
  count: z.number().int().min(0),
})
