import { describeValue } from "#describe-value"
export { describeValue }

/** Format the arguments as a Python-style positional tuple. */
export function formatPositionalArgs(args: readonly unknown[]): string {
  return `(${args.map(describeValue).join(", ")}${args.length === 1 ? "," : ""})`
}

export { readProperty, rejectionMessage } from "./error_message.js"
