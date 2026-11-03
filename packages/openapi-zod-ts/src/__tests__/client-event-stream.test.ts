/**
 * text/event-stream support (#196): the emitted parseEventStream helper (WHATWG SSE
 * parsing rules) and the additive `<op>Events` wrappers.
 *
 * The parser is tested by actually executing the emitted source (transpiled with the
 * TypeScript compiler), including adversarial chunk boundaries. The wrappers are tested
 * structurally, under tsc --strict, and at runtime against a mocked streaming fetch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import type { OpenAPIV3_1 } from 'openapi-types'
import { CLIENT_INTERNAL_NAMES, generateClient, generateClientFiles } from '../plugins/client.js'
import { generateClientConfig } from '../plugins/client-config.js'
import { generateTypes } from '../plugins/types.js'
import { generateIndexBarrel } from '../plugins/index-barrel.js'
import { EVENT_STREAM_HELPER_SOURCE } from '../plugins/event-stream.js'
import { assertNoTsDiagnostics, compileFiles, makeSpec } from './helpers.js'

interface Msg {
  event?: string
  data: string
  id?: string
  retry?: number
}
type Parse = (body: ReadableStream<Uint8Array>) => AsyncGenerator<Msg, void, undefined>

let workDir: string
let parseEventStream: Parse

/** Transpile generated TS to ESM JS and write it into the work dir. */
async function emitJs(name: string, source: string): Promise<string> {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const path = join(workDir, name)
  await writeFile(path, js, 'utf-8')
  return path
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ozt-sse-'))
  const path = await emitJs('sse-helper.mjs', EVENT_STREAM_HELPER_SOURCE)
  parseEventStream = ((await import(pathToFileURL(path).href)) as { parseEventStream: Parse })
    .parseEventStream
})

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

/** A ReadableStream that yields the given chunks (strings are UTF-8 encoded). */
function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      const c = chunks[i++]!
      controller.enqueue(typeof c === 'string' ? enc.encode(c) : c)
    },
  })
}

async function collect(chunks: (string | Uint8Array)[]): Promise<Msg[]> {
  const out: Msg[] = []
  for await (const msg of parseEventStream(streamOf(chunks))) out.push(msg)
  return out
}

/** Split bytes into chunks of the given size (1 = every byte its own chunk). */
function chunked(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size))
  return out
}

describe('parseEventStream: WHATWG field parsing', () => {
  it('parses a simple data-only event', async () => {
    expect(await collect(['data: hello\n\n'])).toEqual([{ data: 'hello' }])
  })

  it('joins multi-line data with \\n', async () => {
    expect(await collect(['data: line1\ndata: line2\ndata:\n\n'])).toEqual([
      { data: 'line1\nline2\n' },
    ])
  })

  it('reads event, id and retry fields', async () => {
    expect(await collect(['event: update\nid: 42\nretry: 3000\ndata: {"a":1}\n\n'])).toEqual([
      { event: 'update', id: '42', retry: 3000, data: '{"a":1}' },
    ])
  })

  it('strips exactly one leading space from a value', async () => {
    expect(await collect(['data:no-space\n\ndata:  two-spaces\n\n'])).toEqual([
      { data: 'no-space' },
      { data: ' two-spaces' },
    ])
  })

  it('treats a line without a colon as a field with an empty value', async () => {
    expect(await collect(['data\n\n'])).toEqual([{ data: '' }])
  })

  it('values may contain colons', async () => {
    expect(await collect(['data: a: b: c\n\n'])).toEqual([{ data: 'a: b: c' }])
  })

  it('ignores comments and unknown fields', async () => {
    expect(
      await collect([': keep-alive\n', 'foo: bar\n', ':\n', 'data: x\n', 'Data: ignored\n\n'])
    ).toEqual([{ data: 'x' }])
  })

  it('does not dispatch an event with an empty data buffer and resets its type', async () => {
    expect(await collect(['event: ping\n\n', 'data: after\n\n'])).toEqual([{ data: 'after' }])
  })

  it('resets event type and retry between events but keeps the last event id', async () => {
    expect(await collect(['event: a\nid: 1\nretry: 10\ndata: one\n\n', 'data: two\n\n'])).toEqual([
      { event: 'a', id: '1', retry: 10, data: 'one' },
      { id: '1', data: 'two' },
    ])
  })

  it('an empty id field clears the last event id', async () => {
    expect(await collect(['id: 7\ndata: a\n\nid\ndata: b\n\n'])).toEqual([
      { id: '7', data: 'a' },
      { data: 'b' },
    ])
  })

  it('ignores an id containing U+0000', async () => {
    expect(await collect(['id: 1\ndata: a\n\nid: x\u0000y\ndata: b\n\n'])).toEqual([
      { id: '1', data: 'a' },
      { id: '1', data: 'b' },
    ])
  })

  it('ignores a retry value that is not ASCII digits', async () => {
    expect(await collect(['retry: 10s\ndata: a\n\nretry: -5\ndata: b\n\n'])).toEqual([
      { data: 'a' },
      { data: 'b' },
    ])
  })

  it('a retry-only block carries over to the next dispatched event', async () => {
    expect(await collect(['retry: 500\n\n', 'data: a\n\n'])).toEqual([{ retry: 500, data: 'a' }])
  })

  it('discards an unterminated event at end of stream', async () => {
    expect(await collect(['data: complete\n\ndata: partial\n'])).toEqual([{ data: 'complete' }])
    expect(await collect(['data: no-newline-at-all'])).toEqual([])
  })

  it('returns no events for an empty stream', async () => {
    expect(await collect([])).toEqual([])
  })
})

describe('parseEventStream: line endings, BOM and encoding', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('%s line endings', async (_label, eol) => {
    const text = ['event: e', 'data: a', 'data: b', '', 'data: c', '', ''].join(eol)
    expect(await collect([text])).toEqual([{ event: 'e', data: 'a\nb' }, { data: 'c' }])
  })

  it('mixed line endings in one stream', async () => {
    expect(await collect(['data: a\r\ndata: b\rdata: c\n\r\n'])).toEqual([{ data: 'a\nb\nc' }])
  })

  it('a CRLF split across two chunks is a single line break', async () => {
    // If the split were mis-handled, the lone \n would be read as a blank line and
    // dispatch "a" early, before "b" arrives.
    expect(await collect(['data: a\r', '\ndata: b\r', '\n\r', '\n'])).toEqual([{ data: 'a\nb' }])
  })

  it('CR at the end of a chunk followed by a non-LF character', async () => {
    expect(await collect(['data: a\r', 'data: b\r\r'])).toEqual([{ data: 'a\nb' }])
  })

  it('strips a leading UTF-8 BOM', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    expect(await collect([bom, 'data: x\n\n'])).toEqual([{ data: 'x' }])
  })

  it('only the first BOM is stripped', async () => {
    expect(await collect(['﻿data: x\n\n﻿data: y\n\n'])).toEqual([{ data: 'x' }])
  })

  it('decodes multi-byte UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: héllo 🌍\n\n')
    const chunks = Array.from(bytes, (b) => new Uint8Array([b]))
    expect(await collect(chunks)).toEqual([{ data: 'héllo 🌍' }])
  })
})

describe('parseEventStream: arbitrary chunk boundaries', () => {
  const stream =
    '﻿: comment\r\nevent: add\r\nid: 1\r\ndata: {"n":1}\r\n\r\n' +
    'data: multi\rdata: line\r\r' +
    'retry: 2500\nevent: done\ndata:\n\n' +
    'data: tail-dropped'
  const expected: Msg[] = [
    { event: 'add', id: '1', data: '{"n":1}' },
    { id: '1', data: 'multi\nline' },
    { event: 'done', id: '1', retry: 2500, data: '' },
  ]

  it.each([1, 2, 3, 5, 7, 11, 64, 4096])('chunk size %i gives identical events', async (size) => {
    expect(await collect(chunked(stream, size))).toEqual(expected)
  })

  it('every possible two-way split gives identical events', async () => {
    const bytes = new TextEncoder().encode(stream)
    for (let cut = 0; cut <= bytes.length; cut++) {
      const got = await collect([bytes.slice(0, cut), bytes.slice(cut)])
      expect(got, `cut at byte ${cut}`).toEqual(expected)
    }
  })
})

describe('parseEventStream: cancellation', () => {
  it('breaking out of the loop cancels the underlying stream', async () => {
    let cancelled = false
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new TextEncoder().encode(`data: ${pulls}\n\n`))
      },
      cancel() {
        cancelled = true
      },
    })
    const seen: string[] = []
    for await (const msg of parseEventStream(body)) {
      seen.push(msg.data)
      if (seen.length === 2) break
    }
    expect(seen).toEqual(['1', '2'])
    expect(cancelled).toBe(true)
    // The lock is released, so the stream is no longer locked.
    expect(body.locked).toBe(false)
  })

  it('a read error propagates to the consumer', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('data: a\n\n'))
        else controller.error(new Error('network down'))
      },
    })
    const seen: string[] = []
    await expect(
      (async () => {
        for await (const msg of parseEventStream(body)) seen.push(msg.data)
      })()
    ).rejects.toThrow('network down')
    expect(seen).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// Generated client
// ---------------------------------------------------------------------------

const sseSpec: OpenAPIV3_1.Document = makeSpec({
  paths: {
    '/rooms/{roomId}/stream': {
      post: {
        operationId: 'streamRoom',
        tags: ['rooms'],
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'since', in: 'query', schema: { type: 'integer' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { topic: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': { description: 'events', content: { 'text/event-stream': {} } },
        },
      },
    },
    '/feed': {
      get: {
        operationId: 'getFeed',
        deprecated: true,
        responses: {
          '200': { description: 'events', content: { 'text/event-stream': {} } },
          '204': { description: 'nothing yet' },
        },
      },
    },
    '/feedEvents': {
      // Its name collides with the wrapper getFeed would get: the operation keeps it.
      get: {
        operationId: 'getFeedEvents',
        tags: ['misc'],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: { Note: { type: 'object', properties: { text: { type: 'string' } } } },
  },
})

const plainSpec: OpenAPIV3_1.Document = makeSpec({
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: {
          '200': {
            description: 'ok',
            // JSON wins over event-stream when both are offered: no streaming op.
            content: {
              'application/json': { schema: { type: 'array', items: { type: 'string' } } },
              'text/event-stream': {},
            },
          },
        },
      },
    },
  },
})

describe('generated client: event-stream operations', () => {
  const content = generateClient(sseSpec).content

  it('keeps the base method and its ReadableStream return type unchanged', () => {
    expect(content).toMatch(
      /export async function streamRoom\(roomId: string, body: \{ topic\?: string \}, params\?: \{\n {2}since\?: number\n\}, config\?: Partial<ClientConfig>\): Promise<ReadableStream<Uint8Array> \| null>/
    )
    expect(content).toContain('Promise<ReadableStream<Uint8Array> | null | undefined>')
  })

  it('emits the helper and an additive <op>Events wrapper per streaming operation', () => {
    expect(content).toContain('export interface EventStreamMessage')
    expect(content).toContain('export async function* parseEventStream(')
    expect(content).toContain(
      'export async function* streamRoomEvents(roomId: string, body: { topic?: string }, params?: {'
    )
    expect(content).toContain(
      "const _stream = await streamRoom(roomId, body, params, { ...config, headers: { Accept: 'text/event-stream', ...(config?.headers ?? getConfig().headers) } })"
    )
    expect(content).toContain('): AsyncGenerator<EventStreamMessage, void, undefined> {')
  })

  it('wrapper names never steal an operation name, and deprecation carries over', () => {
    // getFeedEvents is a real operation; getFeed's wrapper is uniquified instead.
    expect(content).toContain('export async function getFeedEvents(')
    expect(content).toContain('export async function* getFeedEvents_2(')
    const wrapper = content.slice(content.indexOf('function* getFeedEvents_2') - 200)
    expect(wrapper.slice(0, 200)).toContain('@deprecated')
  })

  it('specs without a streaming operation get no helper (output unchanged)', () => {
    const plain = generateClient(plainSpec).content
    expect(plain).not.toContain('parseEventStream')
    expect(plain).not.toContain('EventStreamMessage')
    expect(plain).not.toContain('Events(')
  })

  it('reserves the helper names so an operation cannot shadow them', () => {
    expect(CLIENT_INTERNAL_NAMES.has('parseEventStream')).toBe(true)
    expect(CLIENT_INTERNAL_NAMES.has('EventStreamMessage')).toBe(true)
  })

  it('compiles under tsc --strict, single-file and split', () => {
    const common = {
      'models.ts': generateTypes(sseSpec).content,
      'client-config.ts': generateClientConfig({}).content,
      'index.ts': generateIndexBarrel().content,
      'consumer.ts': [
        "import { streamRoomEvents, parseEventStream, type EventStreamMessage } from './index.js'",
        'export async function run(): Promise<string[]> {',
        '  const out: string[] = []',
        "  for await (const m of streamRoomEvents('r1', { topic: 't' }, { since: 1 })) {",
        '    const msg: EventStreamMessage = m',
        '    out.push(msg.data, msg.event ?? "message", msg.id ?? "", String(msg.retry ?? 0))',
        '  }',
        '  const body = new ReadableStream<Uint8Array>()',
        '  for await (const m of parseEventStream(body)) out.push(m.data)',
        '  return out',
        '}',
      ].join('\n'),
    }
    assertNoTsDiagnostics(
      compileFiles({ ...common, 'client.ts': content }),
      'single-file event-stream client'
    )
    const split = Object.fromEntries(
      generateClientFiles(sseSpec, { splitByTag: true }).map((f) => [f.filename, f.content])
    )
    expect(split['client.ts']).toContain(
      "export { ApiError, parseEventStream, type EventStreamMessage } from './client/_runtime.js'"
    )
    expect(split['client/rooms.ts']).toContain(
      "import { getConfig, type ClientConfig } from '../client-config.js'"
    )
    expect(split['client/rooms.ts']).toContain(
      "import { type EventStreamMessage, _request, parseEventStream } from './_runtime.js'"
    )
    // A tag module without streaming operations keeps the lean imports.
    expect(split['client/misc.ts']).toContain(
      "import type { ClientConfig } from '../client-config.js'"
    )
    expect(split['client/misc.ts']).toContain("import { _request } from './_runtime.js'")
    assertNoTsDiagnostics(compileFiles({ ...common, ...split }), 'split event-stream client')
  }, 30_000)
})

describe('generated client: <op>Events at runtime (mocked streaming fetch)', () => {
  type Client = {
    streamRoomEvents: (
      roomId: string,
      body: { topic?: string },
      params?: { since?: number },
      config?: Record<string, unknown>
    ) => AsyncGenerator<Msg>
    getFeed: (config?: Record<string, unknown>) => Promise<unknown>
    getFeedEvents_2: (config?: Record<string, unknown>) => AsyncGenerator<Msg>
  }
  type Config = { configureClient: (c: Record<string, unknown>) => void }
  let client: Client
  let clientConfig: Config

  beforeAll(async () => {
    await emitJs('client-config.js', generateClientConfig({}).content)
    const path = await emitJs('client.js', generateClient(sseSpec).content)
    clientConfig = (await import(pathToFileURL(join(workDir, 'client-config.js')).href)) as Config
    client = (await import(pathToFileURL(path).href)) as Client
  })

  it('sends the request, asks for text/event-stream and yields parsed events', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchMock = async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init })
      return new Response(
        streamOf(['event: msg\nid: 1\ndata: {"text":"hi"}\n\n', ': ping\n\n', 'data: bye\r\n\r\n']),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    }
    clientConfig.configureClient({
      baseUrl: 'https://api.example.test',
      headers: { 'X-Global': 'g' },
      fetch: fetchMock,
    })

    const events: Msg[] = []
    for await (const e of client.streamRoomEvents('room 1', { topic: 'news' }, { since: 5 })) {
      events.push(e)
    }

    expect(events).toEqual([
      { event: 'msg', id: '1', data: '{"text":"hi"}' },
      { id: '1', data: 'bye' },
    ])
    expect(JSON.parse(events[0]!.data)).toEqual({ text: 'hi' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.example.test/rooms/room%201/stream?since=5')
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.body).toBe('{"topic":"news"}')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['Accept']).toBe('text/event-stream')
    // Global headers are still sent when no per-call headers are given.
    expect(headers['X-Global']).toBe('g')
  })

  it('per-call headers replace global ones (same as the base method) and may override Accept', async () => {
    let seen: Record<string, string> = {}
    clientConfig.configureClient({
      baseUrl: '',
      headers: { 'X-Global': 'g' },
      fetch: async (_url: string, init: RequestInit) => {
        seen = init.headers as Record<string, string>
        return new Response(streamOf(['data: x\n\n']), { status: 200 })
      },
    })
    const out: Msg[] = []
    for await (const e of client.streamRoomEvents('r', {}, undefined, {
      headers: { Accept: 'application/x-ndjson', 'X-Call': 'c' },
    })) {
      out.push(e)
    }
    expect(out).toEqual([{ data: 'x' }])
    expect(seen['Accept']).toBe('application/x-ndjson')
    expect(seen['X-Call']).toBe('c')
    expect(seen['X-Global']).toBeUndefined()
  })

  it('a 204 response yields no events; the base method is unchanged', async () => {
    clientConfig.configureClient({
      baseUrl: '',
      fetch: async () => new Response(null, { status: 204 }),
    })
    const out: Msg[] = []
    for await (const e of client.getFeedEvents_2()) out.push(e)
    expect(out).toEqual([])
    expect(await client.getFeed()).toBeUndefined()
  })

  it('non-2xx responses throw ApiError before any event is yielded', async () => {
    clientConfig.configureClient({
      baseUrl: '',
      fetch: async () => new Response(JSON.stringify({ message: 'nope' }), { status: 403 }),
    })
    await expect(
      (async () => {
        for await (const _ of client.streamRoomEvents('r', {})) void _
      })()
    ).rejects.toMatchObject({ name: 'ApiError', status: 403, body: { message: 'nope' } })
  })

  it('breaking early cancels the response body (closes the connection)', async () => {
    let cancelled = false
    clientConfig.configureClient({
      baseUrl: '',
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode('data: tick\n\n'))
            },
            cancel() {
              cancelled = true
            },
          }),
          { status: 200 }
        ),
    })
    let n = 0
    for await (const _ of client.streamRoomEvents('r', {})) {
      void _
      if (++n === 3) break
    }
    expect(n).toBe(3)
    expect(cancelled).toBe(true)
  })
})
