/** Read data descriptors instead of evaluating getters, toJSON or custom inspection hooks. */
function ownData(object: object, key: PropertyKey): unknown {
  return Object.getOwnPropertyDescriptor(object, key)?.value
}

function className(value: object): string {
  const proto: object | null = Object.getPrototypeOf(value)
  const ctor = proto && ownData(proto, "constructor")
  const name = typeof ctor === "function" && ownData(ctor, "name")
  return typeof name === "string" ? name : ""
}

const regexpFlags = {
  hasIndices: "d",
  global: "g",
  ignoreCase: "i",
  multiline: "m",
  dotAll: "s",
  unicode: "u",
  unicodeSets: "v",
  sticky: "y",
}

function describeRegExp(value: RegExp): string {
  const read = (key: string) =>
    Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get?.call(value)
  const flags = Object.entries(regexpFlags)
    .filter(([key]) => read(key))
    .map(([, flag]) => flag)
    .join("")
  return `/${read("source")}/${flags}`
}

function describeBytes(kind: string, bytes: Uint8Array): string {
  const preview = bytes.subarray(0, 64)
  return `${kind}(${bytes.length}) [${preview.join(", ")}${preview.length < bytes.length ? ", …" : ""}]`
}

function describeObject(value: object, ancestors: Set<object>): string {
  const member = (item: unknown) => describe(item, ancestors)
  if (value instanceof RegExp) return describeRegExp(value)
  if (value instanceof Date) {
    const time = Date.prototype.getTime.call(value)
    return Number.isNaN(time) ? "Invalid Date" : new Date(time).toISOString()
  }
  if (typeof URL !== "undefined" && value instanceof URL) return URL.prototype.toString.call(value)
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams)
    return URLSearchParams.prototype.toString.call(value)
  if (value instanceof ArrayBuffer) return describeBytes("ArrayBuffer", new Uint8Array(value))
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer)
    return describeBytes("SharedArrayBuffer", new Uint8Array(value))
  if (value instanceof DataView) {
    const buffer = Reflect.get(DataView.prototype, "buffer", value)
    const offset = Reflect.get(DataView.prototype, "byteOffset", value)
    const length = Reflect.get(DataView.prototype, "byteLength", value)
    return describeBytes("DataView", new Uint8Array(buffer, offset, length))
  }
  const field = ([key, item]: [string, unknown]) => `${JSON.stringify(key)}: ${member(item)}`
  if (typeof Headers !== "undefined" && value instanceof Headers)
    return `Headers {${Array.from(Headers.prototype.entries.call(value), field).join(", ")}}`
  if (typeof FormData !== "undefined" && value instanceof FormData)
    return `FormData {${Array.from(FormData.prototype.entries.call(value), field).join(", ")}}`
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    const size = Reflect.get(Blob.prototype, "size", value)
    const type = JSON.stringify(Reflect.get(Blob.prototype, "type", value))
    if (typeof File !== "undefined" && value instanceof File) {
      const name = JSON.stringify(Reflect.get(File.prototype, "name", value))
      const modified = Reflect.get(File.prototype, "lastModified", value)
      return `File {name: ${name}, size: ${size}, type: ${type}, lastModified: ${modified}}`
    }
    return `Blob {size: ${size}, type: ${type}}`
  }
  if (value instanceof Map) {
    const entries = Array.from(
      Map.prototype.entries.call(value),
      ([k, v]) => `${member(k)} => ${member(v)}`,
    )
    return `Map { ${entries.join(", ")} }`
  }
  if (value instanceof Set) {
    return `Set { ${Array.from(Set.prototype.values.call(value), member).join(", ")} }`
  }
  const name = className(value)
  if (value instanceof Error) {
    const message = ownData(value, "message")
    return typeof message === "string" ? `${name || "Error"}: ${message}` : name || "Error"
  }
  const props = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(props).filter((key) => Reflect.get(props, key).enumerable)
  const isArray = Array.isArray(value)
  // Index-keyed output keeps even very sparse arrays proportional to the number of entries.
  const dense =
    isArray && keys.length === ownData(value, "length") && keys.every((k, i) => k === String(i))
  const parts = keys.map((key) => {
    const descriptor: PropertyDescriptor = Reflect.get(props, key)
    const text =
      "value" in descriptor
        ? member(descriptor.value)
        : descriptor.get
          ? descriptor.set
            ? "[Getter/Setter]"
            : "[Getter]"
          : "[Setter]"
    if (dense) return text
    const label = typeof key === "symbol" ? `[${String(key)}]` : JSON.stringify(key)
    return `${label}: ${text}`
  })
  if (dense) return `[${parts.join(", ")}]`
  const prefix = isArray
    ? `Array(${ownData(value, "length")}) `
    : name && name !== "Object"
      ? `${name} `
      : ""
  return `${prefix}{${parts.join(", ")}}`
}

function describe(value: unknown, ancestors: Set<object>): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "function") {
    const name = ownData(value, "name")
    return typeof name === "string" && name ? `[Function: ${name}]` : "[Function]"
  }
  if (value === null || typeof value !== "object")
    return Object.is(value, -0) ? "-0" : String(value)
  if (ancestors.has(value)) return "[Circular]"
  ancestors.add(value)
  try {
    return describeObject(value, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

export function describeValue(value: unknown): string {
  try {
    return describe(value, new Set())
  } catch {
    // Revoked proxies and other exotic objects can reject reflection.
    return "<uninspectable>"
  }
}
