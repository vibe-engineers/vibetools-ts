import type { VibeConfig } from "../_internal/vibe_config.js"
import { rejectionMessage } from "../_internal/prompt.js"
import { strip } from "../_internal/text.js"
import { VibeLlmApiException } from "../exceptions/exceptions.js"
import { VibeBaseLlm, type VibeLogger } from "./vibe_base_llm.js"

/** The Google Gen AI SDK call used by this adapter. */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string
      contents: string
      config: { systemInstruction?: string }
    }): PromiseLike<{ text?: string | undefined }>
  }
}

export class GeminiWrapper extends VibeBaseLlm {
  constructor(
    public client: GeminiClient,
    public model: string,
    config: VibeConfig,
    logger: VibeLogger,
  ) {
    super(config, logger)
  }

  async _vibe_eval_llm(prompt: string): Promise<string> {
    try {
      this.logger.debug(`Performing _vibe_eval_llm with prompt: ${JSON.stringify(prompt)}`)
      const instruction = this.config.system_instruction
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
        config: instruction === null ? {} : { systemInstruction: instruction },
      })
      return strip(response.text ?? "")
    } catch (cause) {
      throw new VibeLlmApiException(`Unable to evaluate prompt: ${rejectionMessage(cause)}`, {
        cause,
      })
    }
  }
}
