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
