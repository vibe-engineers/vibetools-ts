import { strip } from "../_internal/text.js"
import { isPlainObject } from "../_internal/vibe_config.js"
import { VibeResponseParseException } from "../exceptions/exceptions.js"

type PrimitiveSpec = BooleanConstructor | NumberConstructor | BigIntConstructor
type Primitive = boolean | number | bigint
type Schema<T = unknown> = { parse(value: unknown): T }
type Thenable = { then(...args: never[]): unknown }

/** Runtime values that describe the requested response, including Zod-compatible schemas. */
export type ReturnTypeSpec =
  | null
  | undefined
  | StringConstructor
  | PrimitiveSpec
  | ArrayConstructor
  | ObjectConstructor
  | Schema

/** A schema's parse method runs synchronously, including when its output type is unknown. */
export type SynchronousSpec<S extends ReturnTypeSpec> =
  S extends Schema<infer T>
    ? unknown extends T
      ? S
      : Extract<T, Thenable> extends never
        ? S
        : never
    : S

/** The value produced by each runtime response type. */
export type Evaluated<S extends ReturnTypeSpec> = S extends null | undefined
  ? string
  : S extends StringConstructor | PrimitiveSpec
    ? ReturnType<S>
    : S extends ArrayConstructor
      ? unknown[]
      : S extends ObjectConstructor
        ? Record<string, unknown>
        : S extends Schema<infer T>
          ? Exclude<T, Thenable>
          : never

// Unicode decimal digits occur in consecutive groups of ten, including adjoining groups.
function asciiDigit(digit: string): string {
  const codePoint = digit.codePointAt(0) as number
  let first = codePoint
  while (/\p{Decimal_Number}/u.test(String.fromCodePoint(first - 1))) first--
  return String((codePoint - first) % 10)
}

function parseLiteral(input: string, expected: PrimitiveSpec): Primitive | undefined {
  const text = strip(input)
  if (expected === Boolean) {
    const word = text.toLowerCase()
    if (["true", "t", "yes", "y", "1"].includes(word)) return true
    if (["false", "f", "no", "n", "0"].includes(word)) return false
    return undefined
  }

  // Python permits underscores between decimal digits and accepts non-ASCII decimal digits.
  const decimal = text
    .replace(/(?!\d)\p{Decimal_Number}/gu, asciiDigit)
    .replace(/(?<=\d)_(?=\d)/g, "")
  if (expected === BigInt) return /^[+-]?\d+$/.test(decimal) ? BigInt(decimal) : undefined
  if (/^[+-]?nan$/i.test(decimal)) return NaN
  if (/^[+-]?inf(?:inity)?$/i.test(decimal)) return decimal.startsWith("-") ? -Infinity : Infinity
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(decimal)) return Number(decimal)
  return undefined
}

function parsePrimitive(raw: string, expected: PrimitiveSpec): Primitive | undefined {
  const literal = parseLiteral(raw, expected)
  if (literal !== undefined) return literal

  const value: unknown = JSON.parse(raw)
  if (typeof value === "string") return parseLiteral(value, expected)
  if (expected === Boolean && (value === 0 || value === 1)) return value === 1
  // In Python bool subclasses int. A BigInt request always produces a bigint here.
  if (expected === BigInt && typeof value === "boolean") return BigInt(value)
  return undefined
}

// An unsafe integer has at least 17 digits, or 16 starting with 9. Match whole JSON
// values so digits in fractions, exponents, and unquoted object keys stay with JSON.parse.
const indexedJsonValue =
  /(?<=^|\[|[:, \t\r\n])(?:-?(?:[1-9]\d{16,}|9\d{15})|NaN|-?Infinity)(?=[ \t\r\n]*(?:[,}\]]|$))/
const jsonStringToken = /"(?:[^"\\]|\\[\s\S])*"?/
const jsonTokens = new RegExp(`${jsonStringToken.source}|${indexedJsonValue.source}`, "g")

function parseJson(raw: string): unknown {
  if (!raw.includes("\\") && !indexedJsonValue.test(raw)) return JSON.parse(raw)

  // Decode strings individually: some Node versions conflate escaped object keys across
  // replies. Indexing every string keeps literal indices distinct from user-provided text.
  const literals: (string | number | bigint)[] = []
  const indexed = raw.replace(jsonTokens, (token) => {
    let literal: string | number | bigint
    if (token.startsWith('"')) literal = JSON.parse(token)
    else if (token === "NaN" || token.endsWith("Infinity")) literal = Number(token)
    else {
      if (Number.isSafeInteger(Number(token))) return token
      literal = BigInt(token)
    }
    const index = literals.push(literal) - 1
    return `"${index}"`
  })
  if (literals.length === 0) return JSON.parse(raw)

  // JSON.parse without a recursive reviver also supports deeply nested responses.
  const containers: object[] = []
  function restore(value: unknown): unknown {
    if (typeof value === "string") return literals[Number(value)]
    if (value === null || typeof value !== "object") return value
    const container = Array.isArray(value)
      ? value
      : Object.fromEntries(
          Object.entries(value).map(([index, member]) => [
            literals[Number(index)] as string,
            member,
          ]),
        )
    containers.push(container)
    return container
  }
  const root = restore(JSON.parse(indexed))
  for (const container of containers) {
    for (const [key, member] of Object.entries(container))
      Reflect.set(container, key, restore(member))
  }
  return root
}

function parseSchema(schema: Schema, value: unknown): unknown {
  const result = schema.parse(value)
  if (
    result !== null &&
    (typeof result === "object" || typeof result === "function") &&
    "then" in result &&
    typeof result.then === "function"
  ) {
    // Observe any rejection before reporting the synchronous interface violation.
    void Promise.resolve(result).catch(() => undefined)
    throw new TypeError("Response schema parse() must return synchronously.")
  }
  return result
}

/**
 * Coerce a model reply. BigInt reads the decimal text directly to preserve integer precision.
 * Structured results use bigint for integer literals outside the safe number range.
 */
export function parseResponse<S extends ReturnTypeSpec>(
  raw: string,
  expected: S & SynchronousSpec<S>,
  beforeSchema: () => void,
): Evaluated<S>
export function parseResponse<S extends ReturnTypeSpec>(
  raw: string,
  expected: S & SynchronousSpec<S>,
): Evaluated<S>
export function parseResponse(
  raw: string,
  expected: ReturnTypeSpec,
  beforeSchema: (() => void) | undefined = undefined,
): unknown {
  if (expected == null || expected === String) return raw
  const name = typeof expected === "function" ? expected.name : "schema"
  const message = `Unable to parse response to expected ${name} type.`
  try {
    if (expected === Boolean || expected === Number || expected === BigInt) {
      const value = parsePrimitive(raw, expected)
      if (value !== undefined) return value
    } else {
      const value = parseJson(raw)
      if (expected === Array && Array.isArray(value)) return value
      if (expected === Object && isPlainObject(value)) return value
      if ("parse" in expected) {
        beforeSchema?.()
        return parseSchema(expected, value)
      }
    }
  } catch (cause) {
    throw new VibeResponseParseException(message, { cause })
  }
  throw new VibeResponseParseException(message)
}
