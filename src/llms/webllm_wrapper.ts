import { readProperty, rejectionMessage } from "../_internal/error_message.js"
import { evaluateWithRetries, withEvaluationTimeout } from "../_internal/evaluation.js"
import { strip } from "../_internal/text.js"
import type { VibeConfig } from "../_internal/vibe_config.js"
import {
  VibeInputTypeException,
  VibeLlmApiException,
  VibeResponseParseException,
} from "../exceptions/exceptions.js"
import { parseResponse, type ReturnTypeSpec } from "./return_type.js"
import { VibeBaseLlm, type VibeLogger } from "./vibe_base_llm.js"

type Message = { role: "system" | "user" | "assistant"; content: string }
type ResponseFormat = { type: "grammar"; grammar: string } | { type: "json_object"; schema: string }
type Examples = readonly (readonly [prompt: string, answer: string])[]
const booleanExamples: Examples = [
  ["Water is a liquid at room temperature.", "True"],
  ["The Sun is a planet.", "False"],
]
type Completion = {
  choices: { message: { content: string | null }; finish_reason?: string | null }[]
}

/** The WebLLM engine and worker expose this same non-streaming chat API. */
export interface WebLlmEngine {
  getGPUVendor(): Promise<string>
  chat: {
    completions: {
      create(request: {
        model: string
        messages: Message[]
        stream: false
        response_format?: ResponseFormat
      }): PromiseLike<Completion>
    }
  }
}

export function isWebLlmEngine(value: unknown): value is WebLlmEngine {
  if (typeof readProperty(value, "getGPUVendor") !== "function") return false
  const completions = readProperty(readProperty(value, "chat"), "completions")
  return typeof readProperty(completions, "create") === "function"
}

/** Evaluate prompts on an engine owned and initialized by the application. */
export class WebLlmWrapper extends VibeBaseLlm {
  constructor(
    public client: WebLlmEngine,
    public model: string,
    config: VibeConfig,
    logger: VibeLogger,
    private readonly stockBooleanInstruction?: string,
  ) {
    super(config, logger)
  }

  protected responseFormat(returnType?: ReturnTypeSpec): ResponseFormat | undefined {
    return returnType === Boolean
      ? { type: "grammar", grammar: 'root ::= "True" | "False"' }
      : undefined
  }

  protected requiresCompleteResponse(returnType?: ReturnTypeSpec): boolean {
    return returnType != null && returnType !== String
  }

  protected examplesFor(returnType?: ReturnTypeSpec): Examples {
    return returnType === Boolean && this.config.system_instruction === this.stockBooleanInstruction
      ? booleanExamples
      : []
  }

  async _vibe_eval_llm(prompt: string, return_type?: ReturnTypeSpec): Promise<string> {
    const messages: Message[] = []
    if (this.config.system_instruction !== null) {
      messages.push({ role: "system", content: this.config.system_instruction })
    }
    for (const [example, answer] of this.examplesFor(return_type)) {
      messages.push({ role: "user", content: example }, { role: "assistant", content: answer })
    }
    messages.push({ role: "user", content: prompt })
    const format = this.responseFormat(return_type)
    let reply: Completion
    try {
      reply = await this.client.chat.completions.create({
        model: this.model,
        messages,
        stream: false,
        ...(format && { response_format: format }),
      })
    } catch (cause) {
      throw new VibeLlmApiException(`Unable to evaluate prompt: ${rejectionMessage(cause)}`, {
        cause,
      })
    }
    const choice = reply?.choices?.[0]
    const reason = choice?.finish_reason
    if (reason !== undefined && reason !== "stop" && this.requiresCompleteResponse(return_type)) {
      throw new VibeResponseParseException(
        `WebLLM returned an incomplete response (finish_reason: ${reason}).`,
      )
    }
    const content = choice?.message?.content
    if (typeof content === "string") return strip(content)
    if (content == null && !this.requiresCompleteResponse(return_type)) return ""
    throw new VibeResponseParseException("Expected WebLLM to return text.")
  }

  protected override async evaluate(prompt: string, return_type: ReturnTypeSpec): Promise<unknown> {
    if (typeof prompt !== "string") throw new VibeInputTypeException("Argument must be a string")
    // Interrupting WebLLM would affect all callers sharing this engine. Stop only our retries.
    return withEvaluationTimeout(this.config.timeout, (remainingMs, signal) =>
      evaluateWithRetries(
        async () => {
          remainingMs()
          const text = await this._vibe_eval_llm(prompt, return_type)
          remainingMs()
          return parseResponse(text, return_type, remainingMs)
        },
        this.config.vibe_mode,
        this.logger,
        { signal },
      ),
    )
  }
}
