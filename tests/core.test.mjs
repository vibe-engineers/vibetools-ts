import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { test } from "node:test"
import { GoogleGenAI } from "@google/genai"
import OpenAI from "openai"
import {
  VibeConfig,
  VibeInputTypeException,
  VibeLlmApiException,
  VibeLlmClientException,
  VibeResponseParseException,
  VibeTimeoutException,
} from "@vibe-engineers/vibetools"
import { ConsoleLogger, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"
import { VibeMode } from "@vibe-engineers/vibetools/_internal/vibe_mode"
import { ColorFormatter } from "@vibe-engineers/vibetools/_internal/logger"
import { VibeBaseLlm } from "@vibe-engineers/vibetools/llms/vibe_base_llm"
import { OpenAiWrapper } from "@vibe-engineers/vibetools/llms/openai_wrapper"
import { GeminiWrapper } from "@vibe-engineers/vibetools/llms/gemini_wrapper"

const logger = new ConsoleLogger("test")
const require = createRequire(import.meta.url)

test("frozen config preserves Python defaults, case-insensitive modes and keyword checks", () => {
  const config = new VibeConfig()
  assert.equal(config.timeout, 10_000)
  assert.equal(config.system_instruction, null)
  assert.equal(config.vibe_mode, VibeMode.CHILL)
  assert.ok(Object.isFrozen(config))
  for (const value of ["EAGER", "eager", "eAgEr", VibeMode.EAGER]) {
    assert.equal(new VibeConfig({ vibe_mode: value }).vibe_mode, VibeMode.EAGER)
  }
  assert.equal(new VibeConfig({ vibe_mode: "chıll" }).vibe_mode, VibeMode.CHILL)
  assert.equal(new VibeConfig({ vibe_mode: "aggreßive" }).vibe_mode, VibeMode.AGGRESSIVE)
  const custom = new VibeConfig({ timeout: 123, system_instruction: "answer briefly" })
  assert.equal(custom.timeout, 123)
  assert.equal(custom.system_instruction, "answer briefly")
  assert.throws(() => new VibeConfig({ vibe_mode: "unknown" }), RangeError)
  assert.throws(() => new VibeConfig({ temperature: 1 }), TypeError)
})

test("logger identity, levels, names and console colors match the Python logger", () => {
  assert.equal(new ConsoleLogger("test"), logger)
  assert.equal(new ConsoleLogger().name, "VibeTools")
  assert.equal(logger.name, "test")
  const formatter = new ColorFormatter()
  assert.equal(
    formatter.format("test", "INFO", "ready"),
    "[\x1b[33mtest\x1b[0m] \x1b[32mINFO\x1b[0m: ready",
  )
})

test("VIBE_LOG_LEVEL controls stderr and repeated initialization adds no duplicate handlers", () => {
  const program = [
    'import { ConsoleLogger } from "@vibe-engineers/vibetools/_internal/logger"',
    'const log = new ConsoleLogger("environment-test")',
    'new ConsoleLogger("environment-test")',
    'log.debug("debug record")',
    'log.info("info record")',
    'log.warning("warning record")',
    'log.error("error record")',
  ].join("\n")
  for (const [level, expected] of [
    ["dEbUg", ["debug", "info", "warning", "error"]],
    ["INFO", ["info", "warning", "error"]],
    ["NOTSET", ["warning", "error"]],
    ["unknown", ["error"]],
  ]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, VIBE_LOG_LEVEL: level },
      encoding: "utf8",
    })
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout, "")
    const records = [...child.stderr.matchAll(/(\w+) record/g)].map((match) => match[1])
    assert.deepEqual(records, expected, level)
  }
})

for (const [name, Client, Wrapper] of [
  ["OpenAI ESM", OpenAI, OpenAiWrapper],
  ["OpenAI CommonJS", require("openai").OpenAI, OpenAiWrapper],
  ["Gemini ESM", GoogleGenAI, GeminiWrapper],
  ["Gemini CommonJS", require("@google/genai").GoogleGenAI, GeminiWrapper],
]) {
  test(`dispatches the official ${name} client`, () => {
    const sdk = new Client({ apiKey: "offline" })
    const wrapped = new VibeLlmClient(sdk, "model", null, logger)
    assert.ok(wrapped.llm instanceof Wrapper)
    assert.equal(wrapped.llm.client, sdk)
    assert.ok(wrapped.config instanceof VibeConfig)
  })
}

test("rejects unsupported clients, including a lookalike object", () => {
  for (const input of [null, 42, {}, { responses: { create() {} } }]) {
    assert.throws(() => new VibeLlmClient(input, "model", null, logger), VibeLlmClientException)
  }
})

const instruction = "Use the requested return type"
for (const [name, Client, Wrapper] of [
  ["OpenAI", OpenAI, OpenAiWrapper],
  ["Gemini", GoogleGenAI, GeminiWrapper],
]) {
  test(`${name} forwards model, input and instructions and trims the SDK's output`, async (t) => {
    const sdk = new Client({ apiKey: "offline" })
    const wrapper = new Wrapper(
      sdk,
      "unit-model",
      new VibeConfig({ system_instruction: instruction }),
      logger,
    )
    const method =
      name === "OpenAI"
        ? t.mock.method(sdk.responses, "create", async () => ({ output_text: "  yes  " }))
        : t.mock.method(sdk.models, "generateContent", async () => ({ text: "  yes  " }))
    assert.equal(await wrapper._vibe_eval_llm("subject"), "yes")
    const args = method.mock.calls[0].arguments
    assert.deepEqual(args, [
      name === "OpenAI"
        ? { model: "unit-model", input: "subject", instructions: instruction }
        : { model: "unit-model", contents: "subject", config: { systemInstruction: instruction } },
    ])
    method.mock.mockImplementation(async () => ({}))
    assert.equal(await wrapper.vibe_eval("subject"), "")
    for (const cause of [new Error("offline failure"), Symbol("request cancelled")]) {
      method.mock.mockImplementation(async () => {
        throw cause
      })
      await assert.rejects(
        wrapper.vibe_eval("subject"),
        (error) => error instanceof VibeLlmApiException && error.cause === cause,
      )
    }
  })
}

test("top-level evaluation preserves direct input errors and chained evaluation failures", async (t) => {
  const sdk = new OpenAI({ apiKey: "offline" })
  const method = t.mock.method(sdk.responses, "create", async () => ({ output_text: "unclear" }))
  const client = new VibeLlmClient(sdk, "model", {}, logger)
  await assert.rejects(client.vibe_eval(123, Boolean), VibeInputTypeException)
  assert.equal(method.mock.callCount(), 0)
  await assert.rejects(
    client.vibe_eval("x", Boolean),
    (error) =>
      error.message === "Exception occurred in target function" &&
      error.cause instanceof VibeResponseParseException,
  )
  method.mock.mockImplementation(async () => {
    throw new Error("transport")
  })
  await assert.rejects(client.vibe_eval("y"), (error) => error.cause instanceof VibeLlmApiException)
})

test("trimming a reply with long internal whitespace preserves it within the evaluation deadline", async (t) => {
  const text = `first row${" ".repeat(65_536)}last row`
  const sdk = new OpenAI({ apiKey: "offline" })
  t.mock.method(sdk.responses, "create", async () => ({ output_text: `\u001c${text}\u0085` }))
  const client = new VibeLlmClient(sdk, "model", { timeout: 500 }, logger)
  assert.equal(await client.vibe_eval("Return the text"), text)
})

test("the timeout applies once across the retry pause and returns the original timeout exception", async () => {
  const sdk = new OpenAI({ apiKey: "offline" })
  let calls = 0
  sdk.responses.create = async () => ({ output_text: ++calls === 1 ? "unclear" : "True" })
  const client = new VibeLlmClient(sdk, "m", { timeout: 30, vibe_mode: "eager" }, logger)
  await assert.rejects(client.vibe_eval("x", Boolean), VibeTimeoutException)
  assert.equal(calls, 1)
})

test("a pending retry after a timeout allows an otherwise idle process to exit", () => {
  const program = `
    import OpenAI from "openai"
    import { ConsoleLogger, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"
    const sdk = new OpenAI({ apiKey: "offline" })
    let attempts = 0
    sdk.responses.create = async () => {
      attempts++
      return { output_text: "unclear" }
    }
    const client = new VibeLlmClient(sdk, "m", { timeout: 25, vibe_mode: "eager" }, new ConsoleLogger())
    try { await client.vibe_eval("x", Boolean) } catch (error) { console.log(error.name) }
    process.once("beforeExit", () => console.log(attempts))
  `
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    timeout: 10_000,
  })
  assert.equal(child.status, 0, child.error?.message ?? child.stderr)
  assert.deepEqual(child.stdout.trim().split(/\r?\n/), ["VibeTimeoutException", "1"])
})

test("a running service can finish the remaining retry after the caller times out", async () => {
  const sdk = new OpenAI({ apiKey: "offline" })
  const retried = Promise.withResolvers()
  let calls = 0
  sdk.responses.create = async () => {
    if (++calls === 2) retried.resolve()
    return { output_text: calls === 1 ? "unclear" : "True" }
  }
  const client = new VibeLlmClient(sdk, "m", { timeout: 25, vibe_mode: "eager" }, logger)
  const service = setTimeout(() => retried.reject(new Error("Retry did not run")), 5_000)
  try {
    await assert.rejects(client.vibe_eval("x", Boolean), VibeTimeoutException)
    await retried.promise
    assert.equal(calls, 2)
  } finally {
    clearTimeout(service)
  }
})

test("overlapping evaluations have independent results and deadlines", async (t) => {
  const sdk = new OpenAI({ apiKey: "offline" })
  let finishSlow
  t.mock.method(sdk.responses, "create", async ({ input }) => {
    if (input === "slow")
      await new Promise((resolve) => {
        finishSlow = resolve
      })
    return { output_text: "False" }
  })
  const client = new VibeLlmClient(sdk, "m", { timeout: 40 }, logger)
  const slow = assert.rejects(client.vibe_eval("slow", Boolean), VibeTimeoutException)
  assert.equal(await client.vibe_eval("fast", Boolean), false)
  await slow
  finishSlow()
})

test("an evaluation that blocks the event loop past its deadline cannot settle successfully or with a late parse error", async () => {
  const sdk = new OpenAI({ apiKey: "offline" })
  sdk.responses.create = async () => ({ output_text: "1" })
  const client = new VibeLlmClient(sdk, "m", { timeout: 15 }, logger)
  for (const shouldThrow of [false, true]) {
    const schema = {
      parse(value) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45)
        if (shouldThrow) throw new TypeError("late schema failure")
        return value
      },
    }
    await assert.rejects(client.vibe_eval("x", schema), VibeTimeoutException)
  }
})

class Sequence extends VibeBaseLlm {
  constructor(mode, items) {
    super(new VibeConfig({ vibe_mode: mode }), logger)
    this.items = items
    this.calls = 0
  }
  async _vibe_eval_llm() {
    const item = this.items[this.calls++]
    if (item instanceof Error) throw item
    return item
  }
}

test("a custom wrapper preserves a rejection without a string conversion as an API error", async (t) => {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  const wrapper = new Sequence("chill", [])
  t.mock.method(logger, "error", () => {})
  for (const reason of [Object.create(null), proxy]) {
    wrapper._vibe_eval_llm = async () => {
      throw reason
    }
    await assert.rejects(
      wrapper.vibe_eval("x"),
      (error) => error instanceof VibeLlmApiException && error.cause === reason,
    )
  }
})

for (const [mode, attempts] of [
  ["CHILL", 1],
  ["EAGER", 2],
  ["AGGRESSIVE", 3],
]) {
  test(`${mode} implements the Python evaluation-attempt count and one-second pauses`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const wrapper = new Sequence(mode, Array(attempts).fill("bad"))
    const exhausted = assert.rejects(wrapper.vibe_eval("x", Boolean), VibeResponseParseException)
    for (let i = 1; i < attempts; i++) {
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(wrapper.calls, i)
      t.mock.timers.tick(999)
      assert.equal(wrapper.calls, i)
      t.mock.timers.tick(1)
    }
    await exhausted
    assert.equal(wrapper.calls, attempts)
  })
}

test("retry can recover after a provider error followed by a parse error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const wrapper = new Sequence("aggressive", [new VibeLlmApiException("first"), "unclear", "0"])
  const decision = wrapper.vibe_eval("same question", Boolean)
  for (let i = 0; i < 2; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(1000)
  }
  assert.equal(await decision, false)
  assert.equal(wrapper.calls, 3)
})
