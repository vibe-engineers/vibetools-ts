import assert from "node:assert/strict"
import test from "node:test"
import { VibeConfig } from "../dist/_internal/vibe_config.js"
import { VibeResponseParseException } from "../dist/exceptions/exceptions.js"
import { parseResponse } from "../dist/llms/return_type.js"
import { VibeBaseLlm } from "../dist/llms/vibe_base_llm.js"

test("raw text and String preserve whitespace, quoting, and non-JSON text", () => {
  for (const expected of [undefined, null, String]) {
    for (const raw of ['  "answer"\n', "not JSON", ""]) {
      assert.equal(parseResponse(raw, expected), raw)
    }
  }
})

test("Boolean recognizes the Python literals and the JSON numbers zero and one", () => {
  for (const raw of [
    "true",
    " T ",
    "YES",
    "y",
    "1",
    '" TrUe "',
    '"1"',
    "1.0",
    "1e0",
    String.raw`"\u0079es"`,
  ]) {
    assert.equal(parseResponse(raw, Boolean), true, raw)
  }
  for (const raw of ["false", " F ", "NO", "n", "0", '" fAlSe "', '"0"', "-0", "0.0", "0e4"]) {
    assert.equal(parseResponse(raw, Boolean), false, raw)
  }
  for (const raw of [
    "2",
    "+1",
    "00",
    '"1.0"',
    '"off"',
    "yes please",
    "[]",
    "{}",
    "null",
    "",
    "\uFEFFyes",
  ]) {
    assert.throws(() => parseResponse(raw, Boolean), VibeResponseParseException, raw)
  }
})

test("Number parses Python decimal and special floating-point spellings, including JSON strings", () => {
  for (const [raw, value] of [
    ["42", 42],
    ["+001_2.5_0e-1", 1.25],
    [".5", 0.5],
    ["1.", 1],
    ["-0", -0],
    ["\u0085٦.٢٥\u0085", 6.25],
    ['" 1e+2 "', 100],
    [String.raw`"\u002b\u0033.5"`, 3.5],
    ["+iNF", Infinity],
    ['"-InFiNiTy"', -Infinity],
    ["-NaN", NaN],
    ["1e999", Infinity],
  ]) {
    assert.equal(parseResponse(raw, Number), value, raw)
  }
  for (const raw of [
    "",
    " ",
    '""',
    "true",
    "false",
    "null",
    "[]",
    '"0x10"',
    "0b10",
    "1__2",
    "1_e2",
    "1.0x",
    "\uFEFF1",
  ]) {
    assert.throws(() => parseResponse(raw, Number), VibeResponseParseException, raw)
  }
})

test("BigInt keeps exact decimal integers and the Python JSON boolean-to-int behavior", () => {
  for (const [raw, value] of [
    ["900719925474099312345", 900719925474099312345n],
    [String.raw`"900719925474099\u0033"`, 9007199254740993n],
    ['" -001_023 "', -1023n],
    ["\u001c+０𝟡\u001f", 9n],
    ["-0", 0n],
    ["true", 1n],
    ["false", 0n],
  ]) {
    assert.equal(parseResponse(raw, BigInt), value, raw)
  }
  for (const raw of [
    "1.0",
    "1e2",
    '"2.0"',
    '"true"',
    "0x10",
    '"0b10"',
    "5__6",
    "Infinity",
    "null",
    "",
    "[]",
  ]) {
    assert.throws(() => parseResponse(raw, BigInt), VibeResponseParseException, raw)
  }
})

test("Array and Object validate the top-level JSON container", () => {
  assert.deepEqual(parseResponse('[1, {"items": [true, null]}, "x"]', Array), [
    1,
    { items: [true, null] },
    "x",
  ])
  assert.deepEqual(parseResponse('{"one": [{"two": false}]}', Object), { one: [{ two: false }] })
  for (const [expected, raw] of [
    [Object, "[]"],
    [Object, "null"],
    [Object, "2"],
    [Object, '"{}"'],
    [Array, "{}"],
    [Array, "null"],
    [Array, '"[]"'],
    [Array, "[1,]"],
  ]) {
    assert.throws(() => parseResponse(raw, expected), VibeResponseParseException, raw)
  }
})

test("structured integers on either side of the safe range preserve their exact digits", () => {
  const raw =
    "[-9007199254740993,-9007199254740992,-9007199254740991,0,9007199254740991,9007199254740992,9007199254740993]"
  assert.deepEqual(parseResponse(raw, Array), [
    -9007199254740993n,
    -9007199254740992n,
    -9007199254740991,
    0,
    9007199254740991,
    9007199254740992n,
    9007199254740993n,
  ])
  const digits = "9".repeat(400)
  assert.deepEqual(parseResponse(`{"records":[{"id":${digits}}]}`, Object), {
    records: [{ id: BigInt(digits) }],
  })
})

test("decimal and exponent literals, numeric strings and numeric keys retain their JSON types", () => {
  const raw =
    '{"9007199254740993":[9007199254740993.0,9007199254740993e0,1.9007199254740993,1e-9007199254740993,"9007199254740993",-0,9007199254740993]}'
  assert.deepEqual(parseResponse(raw, Object), {
    "9007199254740993": [
      9007199254740992,
      9007199254740992,
      1.9007199254740994,
      0,
      "9007199254740993",
      -0,
      9007199254740993n,
    ],
  })
  assert.equal(parseResponse("9007199254740993", String), "9007199254740993")
  assert.equal(parseResponse("9007199254740993", Number), 9007199254740992)
})

test("schema inputs receive exact integers at the root and inside records", async () => {
  const idSchema = {
    parse(value) {
      if (typeof value !== "bigint") throw new TypeError("Expected an exact integer ID")
      return value
    },
  }
  class Echo extends VibeBaseLlm {
    async _vibe_eval_llm(prompt) {
      return prompt
    }
  }
  const llm = new Echo(new VibeConfig())
  assert.equal(await llm.vibe_eval("9007199254740993", idSchema), 9007199254740993n)
  assert.equal(
    await llm.vibe_eval('{"id": -9007199254740993}', {
      parse: (row) => idSchema.parse(row.id),
    }),
    -9007199254740993n,
  )
  await assert.rejects(llm.vibe_eval('"9007199254740993"', idSchema), VibeResponseParseException)
})

test("large integers coexist with escaped keys, duplicate names and nonfinite values", () => {
  const raw = String.raw`{"id":9007199254740992,"\u0069d":9007199254740993,"nested":{"__proto__":[NaN,-Infinity,9007199254740993],"\u0031":"9007199254740993"}}`
  const value = parseResponse(raw, Object)
  assert.deepEqual(value, {
    id: 9007199254740993n,
    nested: { ["__proto__"]: [NaN, -Infinity, 9007199254740993n], 1: "9007199254740993" },
  })
  assert.equal(Object.getPrototypeOf(value.nested), Object.prototype)
  for (const invalid of [
    "{9007199254740993:1}",
    '{"id":09007199254740993}',
    "[+9007199254740993]",
    "[9007199254740993.]",
    "[9007199254740993e]",
    "[1 9007199254740993]",
  ]) {
    assert.throws(
      () => parseResponse(invalid, invalid[0] === "{" ? Object : Array),
      VibeResponseParseException,
    )
  }
})

test("an exact integer can be read from deeply nested JSON", () => {
  const depth = 10_000
  const raw = `${"[".repeat(depth)}9007199254740993${"]".repeat(depth)}`
  let value = parseResponse(raw, Array)
  for (let level = 0; level < depth; level++) value = value[0]
  assert.equal(value, 9007199254740993n)
})

test("Python JSON nonfinite constants are recognized only in value positions", () => {
  const raw = String.raw`{"NaN": [NaN, Infinity, -Infinity, "NaN", "\u0049nfinity", "\"-Infinity\"", {"__proto__": NaN}]}`
  assert.deepEqual(parseResponse(raw, Object), {
    NaN: [NaN, Infinity, -Infinity, "NaN", "Infinity", '"-Infinity"', { ["__proto__"]: NaN }],
  })
  for (const raw of [
    "[1Infinity]",
    "[Infinity0]",
    "[+Infinity]",
    "[-NaN]",
    "[nan]",
    "{NaN:1}",
    '["NaN", NaN,]',
    String.raw`["\NaN]`,
    String.raw`{"bad":"\Infinity}`,
  ]) {
    assert.throws(
      () => parseResponse(raw, raw.startsWith("{") ? Object : Array),
      VibeResponseParseException,
      raw,
    )
  }
})

test("escaped object keys retain their decoded spelling across consecutive replies", () => {
  for (const [raw, key] of [
    [String.raw`{"kind":"reading","\\":1}`, "\\"],
    [String.raw`{"kind":"reading","\"":1}`, '"'],
    [String.raw`{"kind":"reading","\u0000":1}`, "\u0000"],
  ]) {
    assert.deepEqual(parseResponse(raw, Object), { kind: "reading", [key]: 1 })
  }
  assert.deepEqual(parseResponse(String.raw`{"a": 1, "\u0061": Infinity}`, Object), { a: Infinity })
})

test("a schema can validate typed records and tuples and return a class instance", () => {
  class Reading {
    constructor(name, value) {
      this.name = name
      this.value = value
    }
  }
  const readings = {
    parse(input) {
      if (!input || !Array.isArray(input.rows)) throw new TypeError("rows must be an array")
      return input.rows.map((row) => {
        if (
          !Array.isArray(row) ||
          row.length !== 2 ||
          typeof row[0] !== "string" ||
          typeof row[1] !== "number"
        ) {
          throw new TypeError("expected a [name, value] tuple")
        }
        return new Reading(row[0], row[1])
      })
    },
  }
  assert.deepEqual(parseResponse('{"rows": [["temp", 21.5]], "extra": 0}', readings), [
    new Reading("temp", 21.5),
  ])
  for (const raw of ['{"rows": [["temp"]]}', '{"rows":[["temp", "21.5"]]}', "{}"]) {
    assert.throws(() => parseResponse(raw, readings), VibeResponseParseException, raw)
  }
})

test("schemas receive decoded scalar values and require a valid JSON response", () => {
  const identity = {
    parse(value) {
      return value
    },
  }
  assert.equal(parseResponse('"words"', identity), "words")
  assert.equal(parseResponse("null", identity), null)
  assert.equal(parseResponse("NaN", identity), NaN)
  assert.throws(() => parseResponse("words", identity), VibeResponseParseException)
})

test("schemas returning promises or thenables fail synchronously", async () => {
  for (const parse of [
    async () => {
      throw new Error("asynchronous validation failed")
    },
    () => ({
      // biome-ignore lint/suspicious/noThenProperty: This exercises a thenable from outside Promise.
      then(resolve) {
        resolve(42)
      },
    }),
  ]) {
    assert.throws(
      () => parseResponse("42", { parse }),
      (error) => error instanceof VibeResponseParseException && error.cause instanceof TypeError,
    )
  }
  const object = parseResponse('{"then":"ordinary field"}', { parse: (value) => value })
  assert.equal(object.then, "ordinary field")
  await new Promise((resolve) => setImmediate(resolve))
})

test("vibe_eval retries an async schema rejection as a response parse failure", async () => {
  class FixedReply extends VibeBaseLlm {
    async _vibe_eval_llm() {
      return "42"
    }
  }
  const wrapper = new FixedReply(new VibeConfig({ vibe_mode: "eager" }))
  let attempts = 0
  const schema = {
    async parse() {
      attempts++
      throw new Error("asynchronous validation failed")
    },
  }
  await assert.rejects(wrapper.vibe_eval("a number", schema), VibeResponseParseException)
  assert.equal(attempts, 2)
})
