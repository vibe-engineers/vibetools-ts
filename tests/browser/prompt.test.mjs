import assert from "node:assert/strict"
import { register } from "node:module"
import test from "node:test"

register(
  "data:text/javascript," +
    encodeURIComponent(
      'import { isBuiltin } from "node:module"; export function resolve(s, c, next) { if (isBuiltin(s)) throw Error("Browser imported " + s); return next(s,c) }',
    ),
  import.meta.url,
)

test("browser prompts retain distinct values without calling accessors or custom serializers", async () => {
  const { formatPositionalArgs } = await import("@vibe-engineers/vibetools/_internal/prompt")
  let calls = 0
  const record = {
    id: 9007199254740993n,
    get privateValue() {
      calls++
      return "private"
    },
  }
  record.self = record
  record.toJSON = () => {
    calls++
    return "replaced"
  }
  const text = formatPositionalArgs([record, -0, undefined, 'a"b'])
  assert.match(text, /9007199254740993n/)
  assert.match(text, /\[Getter\]/)
  assert.match(text, /\[Circular\]/)
  assert.ok(text.endsWith(', -0, undefined, "a\\"b")'))
  assert.equal(calls, 0)
  assert.equal(formatPositionalArgs([]), "()")
  assert.equal(formatPositionalArgs([false]), "(false,)")
})

test("browser prompts describe nested collections, repeated references, dates and sparse arrays", async () => {
  const { describeValue } = await import("@vibe-engineers/vibetools/_internal/prompt")
  const item = { name: "item" }
  const date = new Date("2026-01-01T00:00:00Z")
  const rendered = describeValue(
    new Map([
      ["members", new Set([date])],
      ["list", [item, item]],
    ]),
  )
  assert.match(rendered, /members/)
  assert.match(rendered, /2026-01-01T00:00:00\.000Z/)
  assert.equal(rendered.split('"item"').length - 1, 2)
  const sparse = []
  sparse[10000000] = "last"
  assert.match(describeValue(sparse), /10000000/)
  assert.match(describeValue(sparse), /"last"/)
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  assert.equal(describeValue(proxy), "<uninspectable>")
})

test("URLs and regular expressions retain the values supplied to an operation", async () => {
  const { describeValue } = await import("@vibe-engineers/vibetools/_internal/prompt")
  const url = new URL("https://example.test/report?page=2")
  const query = new URLSearchParams("mode=fast")
  const pattern = /reports?\/\d+/gi
  for (const [obj, key] of [
    [url, "href"],
    [query, "toString"],
    [pattern, "flags"],
    [pattern, "source"],
  ]) {
    Object.defineProperty(obj, key, {
      get() {
        throw new Error("formatter read instance accessor")
      },
    })
  }
  assert.match(describeValue(url), /example\.test\/report\?page=2/)
  assert.match(describeValue(query), /mode=fast/)
  assert.equal(describeValue(pattern), "/reports?\\/\\d+/gi")
})

test("browser prompts describe buffer bytes and limit data views to their visible range", async () => {
  const { describeValue } = await import("@vibe-engineers/vibetools/_internal/prompt")
  const bytes = Uint8Array.of(99, 1, 2, 88)
  const view = new DataView(bytes.buffer, 1, 2)
  Object.defineProperty(view, "buffer", { get: () => assert.fail("read instance getter") })
  assert.equal(describeValue(bytes.buffer), "ArrayBuffer(4) [99, 1, 2, 88]")
  assert.equal(describeValue(view), "DataView(2) [1, 2]")
  const shared = new SharedArrayBuffer(2)
  new Uint8Array(shared).set([4, 5])
  assert.equal(describeValue(shared), "SharedArrayBuffer(2) [4, 5]")
  const large = new Uint8Array(100_000)
  assert.match(describeValue(large.buffer), /^ArrayBuffer\(100000\) \[0, .+…\]$/u)
  assert.ok(describeValue(large.buffer).length < 400)
})

test("browser prompts describe header and form entries, including file metadata", async () => {
  const { describeValue } = await import("@vibe-engineers/vibetools/_internal/prompt")
  const headers = new Headers({ "x-region": "north" })
  Object.defineProperty(headers, "entries", { get: () => assert.fail("read instance getter") })
  assert.equal(describeValue(headers), 'Headers {"x-region": "north"}')
  const form = new FormData()
  form.append("tag", "one")
  form.append("tag", "two")
  const file = new File(["abc"], "notes.txt", { type: "text/plain", lastModified: 0 })
  form.append("upload", file)
  Object.defineProperty(file, "name", { get: () => assert.fail("read instance getter") })
  assert.equal(
    describeValue(form),
    'FormData {"tag": "one", "tag": "two", "upload": File {name: "notes.txt", size: 3, type: "text/plain", lastModified: 0}}',
  )
  assert.equal(describeValue(new Blob(["abc"])), 'Blob {size: 3, type: ""}')
})
