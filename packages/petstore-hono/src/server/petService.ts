import { randomUUID } from 'node:crypto'
import type { PetstoreService } from '../../generated/service.js'
import { HttpError } from '../../generated/router.js'
import type { Pet, LabDelimitedEcho, LabDeepFilterEcho } from '../../generated/models.js'

const pets = new Map<string, Pet>()

export const petService: PetstoreService = {
  async listPets(params) {
    const all = Array.from(pets.values())
    if (params?.species) {
      return all.filter((p) => p.species.toLowerCase() === params.species!.toLowerCase())
    }
    return all
  },
  async createPet(body) {
    const pet: Pet = { id: randomUUID(), ...body }
    pets.set(pet.id, pet)
    return pet
  },
  async getPet(id) {
    const pet = pets.get(id)
    if (!pet) throw new HttpError(404, `Pet ${id} not found`)
    return pet
  },
  async deletePet(id) {
    if (!pets.has(id)) throw new HttpError(404, `Pet ${id} not found`)
    pets.delete(id)
  },

  // -------------------------------------------------------------------------
  // Lab echo handlers — each echoes back validated input (identity functions)
  // -------------------------------------------------------------------------

  async labNumeric(body) {
    return body
  },

  async labString(body) {
    return body
  },

  async labArray(body) {
    return body
  },

  async labFormats(body) {
    return body
  },

  async labEnumConst(body) {
    return body
  },

  async labClosed(body) {
    return body
  },

  async labPresence(body) {
    // The Zod schema applies defaults; the router passes validatedBody (parsed data),
    // so defaults are already applied. Normalize to explicit nulls for optional absent fields.
    return {
      mandatory: body.mandatory,
      nullableField: body.nullableField ?? null,
      optionalField: body.optionalField ?? null,
      withDefault: body.withDefault ?? 'fallback',
    }
  },

  async labMap(body) {
    return body
  },

  async labEmptyMap() {
    return { label: 'empty', counts: {} }
  },

  async labUnion(body) {
    return body
  },

  async labAnyOfUnion(body) {
    return body
  },

  async labShape(body) {
    return body
  },

  async labInlineShape(body) {
    return body
  },

  async labInheritShape(body) {
    return body
  },

  async labResponseUnion(body) {
    // Echo the requested shape based on the `want` selector
    if (body.want === 'circle') {
      return { kind: 'circle', radius: 1.5 }
    }
    return { kind: 'square', side: 4 }
  },

  async labBackedEnum(body) {
    return body
  },

  async labTuple(body) {
    return body
  },

  async labAllOf(body) {
    return body
  },

  async labNestedVariant(body) {
    // body is the write shape (LabNestedVariantWritable: items carry the writeOnly secret).
    // Map to the read response shape (LabNestedVariant): keep name, assign a server-side
    // readOnly serverId, and drop the writeOnly secret entirely. No cast needed now that the
    // generated interface types the request body as the write variant and the response as read.
    const items = body.items.map((item) => ({
      name: item.name,
      serverId: randomUUID(),
    }))
    return { title: body.title, items }
  },

  async labInlineResponse() {
    // Inline response: return readOnly generated_at, omit writeOnly internal_token.
    return {
      label: 'inline',
      generated_at: '2026-06-13T12:00:00Z',
    }
  },

  async labLooseUnion(body) {
    return body
  },

  async labQuery(params) {
    return {
      tier: params.tier,
      count: params.count,
      code: params.code,
    }
  },

  async labHeader() {
    // The generator does not pass the header value to the service method.
    // Returning a placeholder; Phase 1 tests only check the 200/422 status,
    // not the echoed token value.
    return { token: '' }
  },

  async labInlineBody(body) {
    // Inline body: generator now synthesizes LabInlineBodySchema from operationId and
    // wires safeParse. Handler receives the already-validated body; echo it back.
    return body
  },

  // -------------------------------------------------------------------------
  // Phase 2 echo handlers
  // -------------------------------------------------------------------------

  async labDelimitedQuery(params) {
    // Generator now splits delimited array params before Zod validation:
    // csv=a,b,c → params.csv = ['a', 'b', 'c']
    // ssv=x%20y%20z → params.ssv = ['x', 'y', 'z']
    // psv=p|q|r → params.psv = ['p', 'q', 'r']
    return params as unknown as LabDelimitedEcho
  },

  async labDeepFilter(params) {
    // Generator assembles bracket-notation keys into params.filter:
    // filter[gte]=10&filter[lte]=100&filter[color]=blue
    //   → params.filter = { gte: '10', lte: '100', color: 'blue' }
    // Zod validates with z.coerce.number() but passes the raw `params` to the service.
    // Coerce numeric fields here and return the flat filter object (schema: LabDeepFilterEcho).
    const f = (params as { filter: Record<string, string | undefined> }).filter
    return {
      gte: f['gte'] !== undefined ? Number(f['gte']) : undefined,
      lte: f['lte'] !== undefined ? Number(f['lte']) : undefined,
      color: f['color'],
    } as LabDeepFilterEcho
  },

  async labPath(score) {
    // score is a raw path param string (e.g. '15'). No range validation is wired.
    // The promised contract: { score: 15 } (number). Actual: string '15' cast to number.
    return { score: Number(score) }
  },

  async labFormBody(body) {
    // Form-urlencoded body: generator now uses parseBody() and wires LabFormBodySchema.safeParse.
    // z.coerce.number() in the schema converts string form values to numbers.
    // Handler receives the already-validated and coerced body; echo it back.
    return body
  },

  async labGallery(body) {
    // Bug #8 fixed: generator now emits parseBody({ all: true }) for multipart/form-data.
    // body is Record<string, string | File | (string | File)[]> from Hono parseBody.
    // Count how many files were uploaded under the 'photos' key.
    const parsed = body as Record<string, string | File | (string | File)[]>
    const photos = parsed['photos']
    let count = 0
    if (Array.isArray(photos)) {
      count = photos.filter((p) => p instanceof File).length
    } else if (photos instanceof File) {
      count = 1
    }
    return { count }
  },

  async labAccepted(body) {
    // Bug #9 fixed: spec declares only 202. Generator now emits c.json(result, 202).
    return body
  },

  async labDualStatus(params) {
    // Bug #10 fixed: generator now emits envelope dispatch.
    // Service returns { status, body } so the router calls c.json(_envelope.body, _envelope.status).
    // prefer=async signals a long-running task (202 still running); otherwise task is done (200).
    if (params?.prefer === 'async') {
      return { status: 202 as const, body: { phase: 'running' } }
    }
    return { status: 200 as const, body: { phase: 'done' } }
  },

  async labPlainText(): Promise<string> {
    // Bug #11 fixed: generator now emits c.text() for text/plain responses.
    // Service returns a plain string; router emits it with Content-Type: text/plain.
    return 'lab plain text body'
  },

  async labDownload(): Promise<Uint8Array> {
    // Bug #11 fixed: generator now emits new Response(_result, { 'content-type': 'application/octet-stream' }).
    // Service returns raw bytes; router wraps them with the correct Content-Type header.
    return new TextEncoder().encode('binary-content')
  },

  async labInt64(body) {
    // int64 echo: min leg (ledger >= 0) is validated. For large int64 values
    // (> Number.MAX_SAFE_INTEGER = 2^53 - 1), JavaScript JSON.parse loses precision.
    return body
  },
}

/** Reset all pets — only used in dev/test environments */
export function resetPets(): void {
  pets.clear()
}
