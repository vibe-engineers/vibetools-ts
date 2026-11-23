const levels = { NOTSET: 0, DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, CRITICAL: 50 } as const
type Level = keyof typeof levels
const levelName = (
  typeof process === "undefined" ? "ERROR" : (process.env?.VIBE_LOG_LEVEL ?? "ERROR")
).toUpperCase()
const configuredLevel =
  levelName === "WARN"
    ? levels.WARNING
    : levelName === "FATAL"
      ? levels.CRITICAL
      : Object.hasOwn(levels, levelName)
        ? levels[levelName as Level]
        : levels.ERROR
const colors: Partial<Record<Level, string>> = {
  DEBUG: "\x1b[36m",
  INFO: "\x1b[32m",
  ERROR: "\x1b[31m",
}
const reset = "\x1b[0m"

/** Format a record using the same prefix and ANSI level colors as the Python library. */
export class ColorFormatter {
  format(name: string, level: Level, message: string): string {
    return `[\x1b[33m${name}${reset}] ${colors[level] ?? ""}${level}${reset}: ${message}`
  }
}

/** Named loggers share one console destination and respect VIBE_LOG_LEVEL. */
export class ConsoleLogger {
  static #named = new Map<string, ConsoleLogger>()
  readonly name: string
  readonly level = configuredLevel
  readonly #formatter = new ColorFormatter()

  constructor(name = "VibeTools") {
    this.name = name
    const existing = ConsoleLogger.#named.get(name)
    if (existing) {
      existing.info("✅ Logger is successfully configured.")
      // biome-ignore lint/correctness/noConstructorReturn: Python's logging.getLogger shares the instance by name.
      return existing
    }
    ConsoleLogger.#named.set(name, this)
    this.info("✅ Logger is successfully configured.")
  }

  private write(level: Level, message: string): void {
    // NOTSET inherits the Python root logger's default threshold of WARNING.
    if (levels[level] >= (this.level || levels.WARNING)) {
      if (typeof process !== "undefined" && process.stderr?.write) {
        process.stderr.write(`${this.#formatter.format(this.name, level, message)}\n`)
      } else {
        console.error(`[${this.name}] ${level}: ${message}`)
      }
    }
  }

  debug(message: string): void {
    this.write("DEBUG", message)
  }
  info(message: string): void {
    this.write("INFO", message)
  }
  warning(message: string): void {
    this.write("WARNING", message)
  }
  error(message: string): void {
    this.write("ERROR", message)
  }
  critical(message: string): void {
    this.write("CRITICAL", message)
  }
}
