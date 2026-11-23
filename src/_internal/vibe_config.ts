import { VibeMode } from "./vibe_mode.js"

// A type-only marker distinguishes a config instance from its spreadable settings.
declare const configInstance: unique symbol

export type VibeConfigOptions = {
  [configInstance]?: never
  system_instruction?: string | null
  /** Total evaluation timeout in milliseconds, including retries. */
  timeout?: number
  /** Mode names are case-insensitive. */
  vibe_mode?: string
}

/** The JavaScript counterpart of a Python configuration dictionary. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Immutable configuration shared by all Vibe Engineers packages. */
export class VibeConfig {
  declare private readonly [configInstance]?: true
  readonly system_instruction: string | null
  readonly timeout: number
  readonly vibe_mode: VibeMode

  constructor(options: VibeConfigOptions = {}) {
    if (!isPlainObject(options)) throw new TypeError("config must be a plain object.")
    for (const key of Object.keys(options)) {
      if (key !== "system_instruction" && key !== "timeout" && key !== "vibe_mode") {
        throw new TypeError(`Unexpected configuration key: ${key}`)
      }
    }
    const { system_instruction = null, timeout = 10_000, vibe_mode = VibeMode.CHILL } = options
    const modeName = vibe_mode.toUpperCase()
    if (!Object.hasOwn(VibeMode, modeName)) {
      throw new RangeError(
        `Invalid vibe_mode '${vibe_mode}'. Valid modes are: CHILL, EAGER, AGGRESSIVE.`,
      )
    }
    this.system_instruction = system_instruction
    this.timeout = timeout
    this.vibe_mode = VibeMode[modeName as keyof typeof VibeMode]
    if (new.target === VibeConfig) {
      Object.freeze(this)
    } else {
      // Protect inherited settings while allowing a subclass to initialize its own fields.
      for (const key of Object.keys(this)) {
        Object.defineProperty(this, key, { writable: false, configurable: false })
      }
    }
  }
}

/** Validate a caller-supplied Jev decision threshold without coercion or rounding. */
export function validateProbabilityThreshold(value: unknown): number {
  const message = "probability_threshold must be a finite number between 0 and 1."
  if (typeof value !== "number") throw new TypeError(message)
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(message)
  return value
}
