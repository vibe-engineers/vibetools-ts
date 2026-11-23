import { inspect } from "node:util"

/** Use Node's value representation with ordinary property getters and custom inspectors disabled. */
export function describeValue(value: unknown): string {
  try {
    return inspect(value, {
      customInspect: false,
      getters: false,
      colors: false,
      depth: null,
      maxArrayLength: null,
      maxStringLength: null,
      compact: true,
      breakLength: Infinity,
    })
  } catch {
    return "<uninspectable>"
  }
}

/** Python-style positional tuple, with each value represented as it appears in Node. */
export function formatPositionalArgs(args: readonly unknown[]): string {
  return `(${args.map(describeValue).join(", ")}${args.length === 1 ? "," : ""})`
}

/** Reading metadata from a thrown value or callable proxy can itself throw. */
export function readProperty(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

/** Keep formatting a rejection from replacing the original error. */
export function rejectionMessage(reason: unknown): string {
  const message = readProperty(reason, "message")
  if (typeof message === "string") return message
  try {
    return String(reason)
  } catch {
    return "<unprintable rejection>"
  }
}
