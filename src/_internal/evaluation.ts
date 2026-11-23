import timers from "node:timers/promises"
import {
  VibeLlmApiException,
  VibeResponseParseException,
  VibeTimeoutException,
} from "../exceptions/exceptions.js"
import type { VibeLogger } from "../llms/vibe_base_llm.js"
import { rejectionMessage } from "./prompt.js"
import { VibeMode } from "./vibe_mode.js"

const attemptsByMode = { [VibeMode.CHILL]: 1, [VibeMode.EAGER]: 2, [VibeMode.AGGRESSIVE]: 3 }
const maxTimerDelay = 2_147_483_647

function isEvaluationError(
  error: unknown,
): error is VibeLlmApiException | VibeResponseParseException {
  try {
    return error instanceof VibeLlmApiException || error instanceof VibeResponseParseException
  } catch {
    // A revoked proxy cannot report its prototype.
    return false
  }
}

/** Retry the complete evaluation, so malformed answers and provider errors share one budget. */
export async function evaluateWithRetries<T>(
  evaluate: () => Promise<T>,
  mode: VibeMode,
  logger: VibeLogger,
  options: { ref?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const attempts = attemptsByMode[mode] ?? 1
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted()
    try {
      return await evaluate()
    } catch (error) {
      options.signal?.throwIfAborted()
      const expected = isEvaluationError(error)
      const failure = expected
        ? error
        : new VibeLlmApiException(`An unexpected error occurred: ${rejectionMessage(error)}`, {
            cause: error,
          })
      const message = `Attempt ${attempt} failed: ${failure.message}`
      if (expected) logger.info(message)
      else logger.error(message)
      if (attempt === attempts) throw failure
      if (options.signal) {
        await timers.setTimeout(1000, undefined, options)
      } else {
        await new Promise<void>((resolve) => {
          const retry = setTimeout(resolve, 1000)
          if (options.ref === false) retry.unref()
        })
      }
    }
  }
}

/** A single deadline across attempts, with a cancellation signal for transports that support it. */
export async function withEvaluationTimeout<T>(
  timeout: number,
  evaluate: (remainingMs: () => number, signal: AbortSignal) => T | PromiseLike<T>,
): Promise<T> {
  if (!Number.isFinite(timeout))
    throw new RangeError("timeout must be a finite number of milliseconds.")
  const expires = performance.now() + timeout
  const controller = new AbortController()
  const timeoutError = () => new VibeTimeoutException(`Function call timed out after ${timeout} ms`)
  const remainingMs = () => {
    const remaining = expires - performance.now()
    if (remaining <= 0) {
      controller.abort(timeoutError())
      throw controller.signal.reason
    }
    return Math.min(Math.ceil(remaining), maxTimerDelay)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    const expire = () => {
      try {
        timer = setTimeout(expire, remainingMs())
      } catch (error) {
        reject(error)
      }
    }
    expire()
  })
  const running = Promise.resolve()
    .then(() => evaluate(remainingMs, controller.signal))
    .catch((cause: unknown) => {
      throw new Error("Exception occurred in target function", { cause })
    })
    .finally(() => {
      // Synchronous parsing may finish after the deadline before its timer has fired.
      remainingMs()
    })
  try {
    return await Promise.race([running, deadline])
  } finally {
    clearTimeout(timer)
  }
}
