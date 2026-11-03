/**
 * Source text for the text/event-stream (Server-Sent Events) runtime helper that the
 * client generator emits into the generated client, but only when the spec has at least
 * one operation whose success response is text/event-stream. Specs without such an
 * operation get byte-identical output to before the helper existed.
 *
 * The parser follows the WHATWG HTML "event stream interpretation" rules:
 * https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
 *
 * - Lines end in CRLF, LF, or CR (a CRLF split across two chunks counts as one break).
 * - A leading UTF-8 BOM is ignored.
 * - Lines starting with ':' are comments and are ignored.
 * - `field: value` (one optional space after the colon is stripped); a line without a
 *   colon is a field with an empty value. Unknown fields are ignored.
 * - `data` lines accumulate, joined with '\n'. A blank line dispatches the event; an
 *   event whose data buffer is empty is not dispatched.
 * - `id` sets the last event ID (ignored when the value contains U+0000); it persists
 *   across events, exactly like EventSource#lastEventId.
 * - `retry` is honored only when the value is ASCII digits.
 * - An unterminated event at end-of-stream is discarded.
 */

/** Public names the helper declares at file scope in the generated client. */
export const EVENT_STREAM_HELPER_NAMES = ['parseEventStream', 'EventStreamMessage'] as const

export const EVENT_STREAM_HELPER_SOURCE = `/**
 * One server-sent event, parsed from a text/event-stream body following the WHATWG
 * HTML event stream interpretation rules.
 */
export interface EventStreamMessage {
  /** The \`event:\` field. Undefined means the default type (EventSource calls it 'message'). */
  event?: string
  /** All \`data:\` lines of the event, joined with '\\n'. */
  data: string
  /** The last event ID seen on the stream. Like EventSource#lastEventId it persists across events. */
  id?: string
  /** Reconnection time in milliseconds from a \`retry:\` field received since the previous event. */
  retry?: number
}

/**
 * Parse a text/event-stream response body into an async iterable of events.
 *
 * Handles CRLF / LF / CR line endings (including a CRLF split across chunks), a leading
 * BOM, comments, multi-line data and the id / retry fields. Breaking out of a
 * \`for await\` loop cancels the underlying stream, which closes the HTTP connection.
 *
 * @example
 * for await (const msg of parseEventStream(res.body!)) {
 *   console.log(msg.event, JSON.parse(msg.data))
 * }
 */
export async function* parseEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<EventStreamMessage, void, undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let skipLineFeed = false
  let atStart = true
  let data = ''
  let event = ''
  let lastId = ''
  let retry: number | undefined
  let finished = false

  const handleLine = (line: string): EventStreamMessage | undefined => {
    if (line === '') {
      if (data === '') {
        event = ''
        return undefined
      }
      const msg: EventStreamMessage = { data: data.endsWith('\\n') ? data.slice(0, -1) : data }
      if (event !== '') msg.event = event
      if (lastId !== '') msg.id = lastId
      if (retry !== undefined) msg.retry = retry
      data = ''
      event = ''
      retry = undefined
      return msg
    }
    if (line.charCodeAt(0) === 58) return undefined
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.charCodeAt(0) === 32) value = value.slice(1)
    if (field === 'data') data += value + '\\n'
    else if (field === 'event') event = value
    else if (field === 'id') {
      if (!value.includes('\\u0000')) lastId = value
    } else if (field === 'retry' && /^[0-9]+$/.test(value)) retry = Number.parseInt(value, 10)
    return undefined
  }

  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        finished = true
        break
      }
      let text = decoder.decode(chunk.value, { stream: true })
      if (atStart && text.length > 0) {
        atStart = false
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      }
      let start = 0
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (skipLineFeed) {
          skipLineFeed = false
          if (c === 10) {
            start = i + 1
            continue
          }
        }
        if (c !== 10 && c !== 13) continue
        const line = pending + text.slice(start, i)
        pending = ''
        start = i + 1
        if (c === 13) skipLineFeed = true
        const msg = handleLine(line)
        if (msg !== undefined) yield msg
      }
      pending += text.slice(start)
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}`
