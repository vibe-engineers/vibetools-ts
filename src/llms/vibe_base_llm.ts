import { evaluateWithRetries, withEvaluationTimeout } from "../_internal/evaluation.js"
import { ConsoleLogger } from "../_internal/logger.js"
import type { VibeConfig } from "../_internal/vibe_config.js"
import {
  type Evaluated,
  type ReturnTypeSpec,
  type SynchronousSpec,
  parseResponse,
} from "./return_type.js"

export type VibeLogger = Pick<ConsoleLogger, "debug" | "info" | "error">

/** Common evaluation, response validation, retry policy and deadline handling. */
export abstract class VibeBaseLlm {
  constructor(
    public config: VibeConfig,
    public logger: VibeLogger = new ConsoleLogger("vibetools"),
  ) {}

  abstract _vibe_eval_llm(prompt: string): Promise<string>

  vibe_eval(prompt: string): Promise<string>
  vibe_eval<S extends ReturnTypeSpec>(
    prompt: string,
    return_type: S & SynchronousSpec<S>,
  ): Promise<Evaluated<S>>
  vibe_eval(prompt: string, return_type: ReturnTypeSpec = null): Promise<unknown> {
    return this.evaluate(prompt, return_type)
  }

  protected async evaluate(
    prompt: string,
    return_type: ReturnTypeSpec,
    keepAliveDuringRetry = true,
  ): Promise<unknown> {
    return evaluateWithRetries(
      async () => {
        const text = await this._vibe_eval_llm(prompt)
        this.logger.debug(`Raw response: ${JSON.stringify(text)}`)
        return parseResponse(text, return_type)
      },
      this.config.vibe_mode,
      this.logger,
      { ref: keepAliveDuringRetry },
    )
  }

  /** Bound the caller's wait. Like the Python worker, an in-flight SDK operation can still settle. */
  async _run_with_timeout<A extends unknown[], R>(
    func: (...args: A) => R | PromiseLike<R>,
    timeout: number,
    ...args: A
  ): Promise<R> {
    return withEvaluationTimeout(timeout, () => func(...args))
  }
}
