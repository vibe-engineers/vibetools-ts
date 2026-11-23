import { VibeLlmApiException, VibeResponseParseException } from "../exceptions/exceptions.js"
import type { VibeLogger } from "../llms/vibe_base_llm.js"
import { evaluateWithRetries, withEvaluationTimeout } from "./evaluation.js"
import { rejectionMessage } from "./prompt.js"
import type { VibeConfig } from "./vibe_config.js"
import { type SharedClient, isSdkInstance } from "./vibe_llm_client.js"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JevState = string | { [key: string]: JsonValue }
type NoulResult = { answers: { decision: { type: "noul"; noul: number } } }

/** Only the SDK's Noul request surface is needed. Its declarations remain an optional dependency. */
export interface JevClient {
  systemOne(
    request: {
      model: string
      state: JevState
      questions: { decision: { type: "noul"; instructions: string } }
    },
    options: { retry: { maxRetries: number }; timeout: number },
  ): PromiseLike<NoulResult>
}

/** Untyped clients from JavaScript retain the original generative result type. */
export type DecisionClientResult<
  C extends JevClient | SharedClient,
  Jev,
  Generative,
> = unknown extends C ? Generative : C extends JevClient ? Jev : Generative

export function isJevClient(client: unknown): client is JevClient {
  if (client === null || typeof client !== "object") return false
  try {
    // Ordinary generative clients need no TypeSafe module lookup. Avoid invoking accessors.
    if (!("systemOne" in client)) return false
  } catch {
    return false
  }
  return isSdkInstance<JevClient>(client, "@typesafe-ai/sdk", "TypeSafeClient")
}

/** Validate a caller-supplied Jev decision threshold without coercion or rounding. */
export function validateProbabilityThreshold(value: unknown): number {
  const message = "probability_threshold must be a finite number between 0 and 1."
  if (typeof value !== "number") throw new TypeError(message)
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(message)
  return value
}

/** Evaluates one named System One Noul question about a statement or structured failure. */
export class JevEvaluator {
  constructor(
    public client: JevClient,
    public model: string,
    public config: VibeConfig,
    public logger: VibeLogger,
    private readonly question: string,
    private readonly stockInstruction?: string,
  ) {}

  probability(state: JevState): Promise<number> {
    const custom = this.config.system_instruction
    const instructions =
      custom && custom !== this.stockInstruction ? `${this.question}\n\n${custom}` : this.question
    return withEvaluationTimeout(this.config.timeout, (remainingMs, signal) =>
      evaluateWithRetries(
        () => this.requestProbability(state, instructions, remainingMs(), signal),
        this.config.vibe_mode,
        this.logger,
        { signal },
      ),
    )
  }

  private async requestProbability(
    state: JevState,
    instructions: string,
    timeout: number,
    signal: AbortSignal,
  ): Promise<number> {
    let result: NoulResult
    const options = { retry: { maxRetries: 0 }, timeout, signal }
    try {
      result = await this.client.systemOne(
        { model: this.model, state, questions: { decision: { type: "noul", instructions } } },
        options,
      )
    } catch (cause) {
      throw new VibeLlmApiException(`Unable to evaluate Noul: ${rejectionMessage(cause)}`, {
        cause,
      })
    }
    const answer = result?.answers?.decision
    const probability = answer?.noul
    if (
      answer?.type !== "noul" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new VibeResponseParseException("Expected a decision Noul probability between 0 and 1.")
    }
    return probability
  }
}
