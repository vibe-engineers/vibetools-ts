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
