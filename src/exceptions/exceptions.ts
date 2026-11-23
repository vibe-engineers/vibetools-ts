/** Preserve the specific exception name on both instanceof checks and Node stack traces. */
class VibeError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** The supplied client is not an instance of either supported provider SDK. */
export class VibeLlmClientException extends VibeError {}
/** The model's reply could not be converted to the requested type. */
export class VibeResponseParseException extends VibeError {}
/** The provider failed while evaluating the prompt. */
export class VibeLlmApiException extends VibeError {}
/** The complete evaluation exceeded its configured deadline. */
export class VibeTimeoutException extends VibeError {}
/** An evaluation expects a string prompt. */
export class VibeInputTypeException extends VibeError {}
