import { VibeConfig } from "@vibe-engineers/vibetools"
import type { TypeSafeClient } from "@typesafe-ai/sdk"
import { ConsoleLogger, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"
import { parseResponse } from "@vibe-engineers/vibetools/llms/return_type"

declare const llm: VibeLlmClient
declare const jev: TypeSafeClient
// @ts-expect-error The generative evaluator requires a text-generation client.
new VibeLlmClient(jev, "jev-model", {}, new ConsoleLogger())
declare function expectType<T>(value: T): void

expectType<Promise<string>>(llm.vibe_eval("plain"))
expectType<Promise<string>>(llm.vibe_eval("plain", null))
expectType<Promise<string>>(llm.vibe_eval("plain", String))
expectType<Promise<boolean>>(llm.vibe_eval("decision", Boolean))
expectType<Promise<number>>(llm.vibe_eval("a number", Number))
expectType<Promise<bigint>>(llm.vibe_eval("an integer", BigInt))
expectType<Promise<unknown[]>>(llm.vibe_eval("a list", Array))
expectType<Promise<Record<string, unknown>>>(llm.vibe_eval("a mapping", Object))

class Breed {
  constructor(readonly name: string) {}
  static parse(value: unknown) {
    if (typeof value !== "string") throw new TypeError("Expected a breed name")
    return new Breed(value)
  }
}
expectType<Promise<Breed>>(llm.vibe_eval("a breed", Breed))

const options = new VibeConfig({ vibe_mode: "EAGER", system_instruction: null })
new VibeConfig({ ...options })
// @ts-expect-error A configuration constructor expects plain settings.
new VibeConfig(options)
declare const another: VibeLlmClient
llm.llm = another.llm
llm.llm.model = "replacement-model"
llm.config = options
llm.logger = another.logger
// @ts-expect-error Configuration is frozen.
options.timeout = 500
// @ts-expect-error Type annotations alone cannot describe a runtime schema.
llm.vibe_eval<string[]>("a list of names")
// @ts-expect-error The requested response is a number.
expectType<Promise<boolean>>(llm.vibe_eval("a number", Number))

const asyncSchema = {
  async parse(_value: unknown) {
    return 42
  },
}
// @ts-expect-error Runtime schemas validate synchronously.
llm.vibe_eval("answer", asyncSchema)
// @ts-expect-error The underlying synchronous parser also rejects async schemas.
parseResponse("42", asyncSchema)
