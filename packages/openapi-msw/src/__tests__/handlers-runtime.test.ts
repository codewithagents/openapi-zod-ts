// Runtime proof for the handler URL matcher: generated handlers are loaded and served
// through msw/node's setupServer, then hit with real absolute-URL fetches. Node's fetch
// requires absolute URLs, so a relative matcher like '/api/v1/tasks' could never match here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { setupServer, type SetupServer } from 'msw/node'
import type { RequestHandler } from 'msw'
import type { OpenAPIV3_1 } from 'openapi-types'
import { generateHandlers, type HandlerGenOptions } from '../plugins/handlers.js'
import { removeScratchDir, writeScratchFiles } from './scratch-files.js'

const fixturePath = join(import.meta.dirname, '../__fixtures__/specs/task-api.json')
const spec = JSON.parse(readFileSync(fixturePath, 'utf-8')) as OpenAPIV3_1.Document

let server: SetupServer | undefined
let scratchDir: string | undefined

afterEach(() => {
  server?.close()
  server = undefined
  if (scratchDir !== undefined) removeScratchDir(scratchDir)
  scratchDir = undefined
})

async function startServer(opts: Partial<HandlerGenOptions>): Promise<void> {
  const { filename, content } = generateHandlers(spec, {
    seed: 42,
    maxArrayItems: 3,
    depthCap: 30,
    ...opts,
  })
  scratchDir = writeScratchFiles({ [filename]: content })
  const mod = (await import(pathToFileURL(join(scratchDir, filename)).href)) as {
    handlers: RequestHandler[]
  }
  server = setupServer(...mod.handlers)
  server.listen({ onUnhandledFrame: 'error' })
}

describe('generated handlers under msw/node setupServer', () => {
  it('default (no base_url): matches an absolute URL on any origin', async () => {
    await startServer({})
    const list = await fetch('http://localhost/api/v1/tasks')
    expect(list.status).toBe(200)
    expect(Array.isArray(await list.json())).toBe(true)

    const other = await fetch('https://some-other-host.test/api/v1/tasks/abc')
    expect(other.status).toBe(200)
    expect(await other.json()).toHaveProperty('id')

    const removed = await fetch('http://localhost/api/v1/tasks/abc', { method: 'DELETE' })
    expect(removed.status).toBe(204)
  })

  it('base_url: matches requests to the configured origin', async () => {
    await startServer({ baseUrl: 'https://api.test' })
    const created = await fetch('https://api.test/api/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toHaveProperty('title')
  })

  it('base_url: a request to a different origin stays unhandled and errors', async () => {
    await startServer({ baseUrl: 'https://api.test' })
    await expect(fetch('https://elsewhere.test/api/v1/tasks')).rejects.toThrow()
  })
})
