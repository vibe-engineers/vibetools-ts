import type { VibeConfig } from "../_internal/vibe_config.js"
import { rejectionMessage } from "../_internal/prompt.js"
import { strip } from "../_internal/text.js"
import { VibeLlmApiException } from "../exceptions/exceptions.js"
import { VibeBaseLlm, type VibeLogger } from "./vibe_base_llm.js"

/** The Responses API used by the adapter. Consumers can install either provider independently. */
export interface OpenAiClient {
  responses: {
    create(params: {
      model: string
      instructions: string | null
      input: string
    }): PromiseLike<{ output_text?: string | null | undefined }>
  }
}

export class OpenAiWrapper extends VibeBaseLlm {
  constructor(
    public client: OpenAiClient,
    public model: string,
    config: VibeConfig,
    logger: VibeLogger,
  ) {
    super(config, logger)
  }

  async _vibe_eval_llm(prompt: string): Promise<string> {
    try {
      this.logger.debug(`Performing _vibe_eval_llm with prompt: ${JSON.stringify(prompt)}`)
      const response = await this.client.responses.create({
        model: this.model,
        instructions: this.config.system_instruction,
        input: prompt,
      })
      return strip(response.output_text ?? "")
    } catch (cause) {
      throw new VibeLlmApiException(`Unable to evaluate prompt: ${rejectionMessage(cause)}`, {
        cause,
      })
    }
  }
}
