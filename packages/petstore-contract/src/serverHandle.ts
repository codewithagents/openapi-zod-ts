// Shared by the express and hono adapters, whose underlying Node http.Server both expose
// close(cb). Fastify is the exception: its app.close() already returns a Promise, so the
// fastify adapter builds its handle directly. Structurally typed (no import from
// startServer.ts) so this module stays a leaf and introduces no import cycle.
type ClosableServer = { close: (cb: (err?: unknown) => void) => void }

export function makeHandle(
  baseUrl: string,
  server: ClosableServer
): { baseUrl: string; close: () => Promise<void> } {
  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  }
}
