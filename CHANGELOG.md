# Changelog

## Unreleased (0.1.0)

- Added an optional TypeSafe Jev adapter for probability judgments in VibeChecks and VibeRetry.
- Ported the OpenAI and Gemini wrappers, shared configuration, retry modes, timeout handling, console logger, and exception classes to TypeScript.
- Configuration constructor types distinguish a plain settings object from an existing instance.
- Added asynchronous `vibe_eval` with text, scalar, JSON array, JSON object, and runtime schema return types.
- The provider wrappers now trim from the edges using Python's `str.strip` rules, preserving long runs of whitespace inside a reply without repeated scans.
- Provider failures retain the original rejection value as the cause of `VibeLlmApiException`, including values other than JavaScript errors.
- Structured results now preserve unquoted integer literals outside JavaScript's safe integer range as `bigint`, including values passed to a schema.
- VibeGen and VibeRetry share one internal formatter for function arguments in model prompts.
- A pending library retry after a caller timeout lets an otherwise idle Node process exit. A running service can still complete the retry.
