// biome-ignore lint/suspicious/noControlCharactersInRegex: These separators belong to Python's whitespace set.
const whitespace = /[\p{White_Space}\u001c-\u001f]/u

/** Python str.strip includes the four ASCII separators and preserves U+FEFF. */
export function strip(value: string): string {
  let start = 0
  let end = value.length
  while (whitespace.test(value.charAt(start))) start++
  while (start < end && whitespace.test(value.charAt(end - 1))) end--
  return value.slice(start, end)
}
