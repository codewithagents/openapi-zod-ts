import { randomUUID } from 'node:crypto'
import type { PetstoreService } from '../../generated/service.js'
import type { Pet } from '../../generated/schema-types.js'
import { HttpError } from '../../generated/router.js'

const pets = new Map<string, Pet>()

export const petService: PetstoreService = {
  async listPets(input) {
    const all = Array.from(pets.values())
    const species = input.query.species
    if (species) {
      return all.filter((p) => p.species.toLowerCase() === species.toLowerCase())
    }
    return all
  },
  async createPet(input) {
    const pet: Pet = { id: randomUUID(), ...input.body }
    pets.set(pet.id, pet)
    return pet
  },
  async getPet(input) {
    const id = input.params.id
    const pet = pets.get(id)
    // HttpError is recognised by the generated setErrorHandler and mapped to its status.
    if (!pet) throw new HttpError(404, `Pet ${id} not found`)
    return pet
  },
  async deletePet(input) {
    pets.delete(input.params.id)
  },
  async labNumeric(_input) {
    throw new Error('not implemented')
  },
  async labString(_input) {
    throw new Error('not implemented')
  },
  async labArray(_input) {
    throw new Error('not implemented')
  },
  async labFormats(_input) {
    throw new Error('not implemented')
  },
  async labEnumConst(_input) {
    throw new Error('not implemented')
  },
  async labClosed(_input) {
    throw new Error('not implemented')
  },
  async labPresence(_input) {
    throw new Error('not implemented')
  },
  async labMap(_input) {
    throw new Error('not implemented')
  },
  async labEmptyMap() {
    throw new Error('not implemented')
  },
  async labUnion(_input) {
    throw new Error('not implemented')
  },
  async labAnyOfUnion(_input) {
    throw new Error('not implemented')
  },
  async labShape(_input) {
    throw new Error('not implemented')
  },
  async labInlineShape(_input) {
    throw new Error('not implemented')
  },
  async labInheritShape(_input) {
    throw new Error('not implemented')
  },
  async labResponseUnion(input) {
    // Echo: pick a concrete variant based on the requested selector.
    return input.body.want === 'circle'
      ? { kind: 'circle', radius: 1 }
      : { kind: 'square', side: 1 }
  },
  async labBackedEnum(_input) {
    throw new Error('not implemented')
  },
  async labTuple(_input) {
    throw new Error('not implemented')
  },
  async labAllOf(_input) {
    throw new Error('not implemented')
  },
  async labNestedVariant(_input) {
    throw new Error('not implemented')
  },
  async labInlineResponse() {
    // Echo: a fixed inline-shaped response (no named schema).
    return { ok: true, note: 'inline response' }
  },
  async labLooseUnion(_input) {
    throw new Error('not implemented')
  },
  async labQuery(input) {
    // Echo the coerced query params (count arrives as a number).
    const { tier, count, code } = input.query
    return { tier, count, code }
  },
  async labHeader(_input) {
    // The header is validated by the router; the service just returns a canned token.
    return { token: 'tok-0000' }
  },
  async labInlineBody(_input) {
    throw new Error('not implemented')
  },
  async labDelimitedQuery(input) {
    // Echo the delimiter-split arrays back; the router already reshaped them.
    const { csv, ssv, psv } = input.query
    return { csv, ssv, psv }
  },
  async labDeepFilter(input) {
    // Echo the reshaped + coerced deepObject filter back.
    const { filter } = input.query
    return {
      gte: filter.gte ?? 0,
      lte: filter.lte ?? 0,
      color: filter.color,
    }
  },
  async labPath(_input) {
    throw new Error('not implemented')
  },
  async labFormBody(_input) {
    // Acknowledge a form-urlencoded body was parsed.
    return { ok: true }
  },
  async labGallery(_input) {
    // Acknowledge a multipart body was parsed.
    return { uploaded: 1 }
  },
  async labAccepted(_input) {
    throw new Error('not implemented')
  },
  async labDualStatus(input) {
    // prefer=async returns 202, anything else returns 200.
    const isAsync = input.query.prefer === 'async'
    return { status: isAsync ? 202 : 200, body: { phase: isAsync ? 'pending' : 'done' } }
  },
  async labPlainText() {
    return 'hello plain text'
  },
  async labDownload() {
    return new Uint8Array([1, 2, 3, 4])
  },
  async labInt64(_input) {
    throw new Error('not implemented')
  },
}

/** Reset all pets. Only used in dev/test environments. */
export function resetPets(): void {
  pets.clear()
}
