import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { VibeInputTypeException, VibeLlmClientException } from "../exceptions/exceptions.js"
import { type GeminiClient, GeminiWrapper } from "../llms/gemini_wrapper.js"
import { type OpenAiClient, OpenAiWrapper } from "../llms/openai_wrapper.js"
import type { ReturnTypeSpec } from "../llms/return_type.js"
import { VibeBaseLlm, type VibeLogger } from "../llms/vibe_base_llm.js"
import { VibeConfig, type VibeConfigOptions } from "./vibe_config.js"

export type SharedClient = OpenAiClient | GeminiClient

const require = createRequire(import.meta.url)

/** Optional SDKs can expose distinct constructors through their ESM and CommonJS entry points. */
export function isSdkInstance<T>(client: unknown, pkg: string, name: string): client is T {
  if (client === null || typeof client !== "object") return false
  let esm: string
  try {
    esm = fileURLToPath(import.meta.resolve(pkg))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND")
      return false
    throw error
  }
  for (const entry of new Set([esm, require.resolve(pkg)])) {
    const ClientClass = require(entry)[name]
    if (typeof ClientClass === "function" && client instanceof ClientClass) return true
  }
  return false
}

/** Select the provider from the supplied SDK client and apply one deadline to each evaluation. */
export class VibeLlmClient extends VibeBaseLlm {
  llm: OpenAiWrapper | GeminiWrapper

  constructor(
    client: SharedClient,
    model: string,
    config: VibeConfig | VibeConfigOptions | null,
    logger: VibeLogger,
  ) {
    super(config instanceof VibeConfig ? config : new VibeConfig(config ?? {}), logger)
    if (isSdkInstance<OpenAiClient>(client, "openai", "OpenAI")) {
      this.llm = new OpenAiWrapper(client, model, this.config, logger)
      logger.info(`Loaded OpenAI wrapper with model: ${model}`)
    } else if (isSdkInstance<GeminiClient>(client, "@google/genai", "GoogleGenAI")) {
      this.llm = new GeminiWrapper(client, model, this.config, logger)
      logger.info(`Loaded Gemini wrapper with model: ${model}`)
    } else {
      throw new VibeLlmClientException("Client must be an instance of OpenAI or GoogleGenAI")
    }
  }

  _vibe_eval_llm(prompt: string): Promise<string> {
    return this.llm._vibe_eval_llm(prompt)
  }

  protected override async evaluate(prompt: string, return_type: ReturnTypeSpec): Promise<unknown> {
    if (typeof prompt !== "string") throw new VibeInputTypeException("Argument must be a string")
    // The deadline timer keeps Node alive while the caller is waiting. Afterward,
    // a pending retry can run if the application still has other work.
    return this._run_with_timeout(
      () => super.evaluate(prompt, return_type, false),
      this.config.timeout,
    )
  }
}
