import assert from "node:assert/strict"
import { test } from "node:test"
import {
  VibeConfig,
  VibeLlmApiException,
  VibeResponseParseException,
  VibeTimeoutException,
} from "@vibe-engineers/vibetools"
import { ConsoleLogger, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"
import { WebLlmWrapper } from "@vibe-engineers/vibetools/llms/webllm_wrapper"
import * as sdkClients from "@vibe-engineers/vibetools/_internal/vibe_llm_client"

const config = { system_instruction: "Give a boolean verdict." }
const logger = new ConsoleLogger("transport-test")

function webClient(create, settings = {}) {
  const sdk = { getGPUVendor: async () => "offline", chat: { completions: { create } } }
  return new WebLlmWrapper(sdk, "local-model", new VibeConfig(settings), logger)
}

test("the WebLLM wrapper constrains only boolean replies and shares typed response parsing", async () => {
  const requests = []
  const create = async (request) => {
    requests.push(request)
    const content = request.response_format ? "False" : "  [9007199254740993]  "
    return { choices: [{ message: { content } }] }
  }
  const client = webClient(create)
  assert.equal(await client.vibe_eval("claim", Boolean), false)
  assert.deepEqual(await client.vibe_eval("numbers", Array), [9007199254740993n])
  assert.equal(await client._vibe_eval_llm("raw"), "[9007199254740993]")
  assert.equal(requests[0].response_format.type, "grammar")
  assert.equal("response_format" in requests[1], false)
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "numbers" }])
})

test("WebLLM rejects unfinished typed answers and preserves partial raw text", async () => {
  for (const [reason, content, type] of [
    ["length", "F", Boolean],
    ["abort", "True", Boolean],
    ["length", "12", Number],
    ["tool_calls", "[]", Array],
  ]) {
    const client = webClient(async () => ({
      choices: [{ finish_reason: reason, message: { content } }],
    }))
    await assert.rejects(
      client.vibe_eval("claim", type),
      (error) =>
        error.cause instanceof VibeResponseParseException && error.cause.message.includes(reason),
    )
    assert.equal(await client.vibe_eval("raw", String), content)
  }
  const invalid = webClient(async () => ({ choices: [{ message: { content: 7 } }] }))
  await assert.rejects(
    invalid.vibe_eval("claim", Boolean),
    (error) => error.cause instanceof VibeResponseParseException,
  )
})

test("a WebLLM retry gets a fresh grammar and can complete a truncated verdict", async () => {
  let calls = 0
  const client = webClient(
    async ({ response_format }) => {
      assert.equal(response_format.grammar, 'root ::= "True" | "False"')
      response_format.grammar = 'root ::= "False"'
      return {
        choices: [
          ++calls === 1
            ? { finish_reason: "length", message: { content: "F" } }
            : { finish_reason: "stop", message: { content: "True" } },
        ],
      }
    },
    { vibe_mode: "eager" },
  )
  assert.equal(await client.vibe_eval("claim", Boolean), true)
  assert.equal(calls, 2)
})

test("expired WebLLM checks skip both new requests and user schema callbacks", async (t) => {
  let now = 0
  t.mock.method(performance, "now", () => now)
  let calls = 0
  let parses = 0
  const client = webClient(
    async () => {
      calls++
      now += 100
      return { choices: [{ finish_reason: "stop", message: { content: "{}" } }] }
    },
    { timeout: 10 },
  )
  const expired = client.vibe_eval("claim", Boolean)
  now += 100
  await assert.rejects(expired, VibeTimeoutException)
  assert.equal(calls, 0)
  await assert.rejects(
    client.vibe_eval("object", {
      parse() {
        parses++
      },
    }),
    VibeTimeoutException,
  )
  assert.equal(calls, 1)
  assert.equal(parses, 0)
})

async function createOpenAI(options) {
  const { default: OpenAI } = await import("openai")
  return new OpenAI(options)
}

test("WebLLM skips the schema callback when JSON decoding consumes the deadline", async (t) => {
  let now = 0
  let validations = 0
  t.mock.method(performance, "now", () => now)
  const parse = JSON.parse
  t.mock.method(JSON, "parse", (text) => {
    const value = parse(text)
    now += 20
    return value
  })
  const client = webClient(async () => ({ choices: [{ message: { content: "{}" } }] }), {
    timeout: 10,
  })
  await assert.rejects(
    client.vibe_eval("object", {
      parse() {
        validations++
      },
    }),
    VibeTimeoutException,
  )
  assert.equal(validations, 0)
})

test("Node routes real hosted clients before a structurally compatible local engine", async () => {
  const local = {
    getGPUVendor: async () => "test",
    chat: { completions: { create: async () => ({ choices: [] }) } },
  }
  const openai = await createOpenAI({ apiKey: "offline" })
  openai.getGPUVendor = local.getGPUVendor
  const gemini = await createGemini({ apiKey: "offline" })
  Object.assign(gemini, local)
  assert.equal(sdkClients.usesLocalEngine(openai), false)
  assert.equal(sdkClients.usesLocalEngine(gemini), false)
  assert.equal(sdkClients.usesLocalEngine(local), true)
})

test("a WebLLM evaluator can constrain a particular schema and retain the stock boolean grammar", async () => {
  const schema = { parse: (value) => value }
  class RecordEvaluator extends WebLlmWrapper {
    responseFormat(type) {
      return type === schema
        ? { type: "json_object", schema: '{"type":"object","additionalProperties":true}' }
        : super.responseFormat(type)
    }
  }
  const requests = []
  const create = async (request) => {
    requests.push(request)
    return {
      choices: [
        { finish_reason: "stop", message: { content: requests.length === 2 ? "True" : "{}" } },
      ],
    }
  }
  const engine = { getGPUVendor: async () => "test", chat: { completions: { create } } }
  const client = new RecordEvaluator(engine, "m", new VibeConfig(), logger)
  assert.deepEqual(await client.vibe_eval("record", schema), {})
  assert.equal(await client.vibe_eval("claim", Boolean), true)
  assert.equal(await client.vibe_eval("text"), "{}")
  assert.deepEqual(
    requests.map((r) => r.response_format),
    [
      { type: "json_object", schema: '{"type":"object","additionalProperties":true}' },
      { type: "grammar", grammar: 'root ::= "True" | "False"' },
      undefined,
    ],
  )
})

test("generated text can require completion while a raw read still exposes partial text", async () => {
  class GenerationEvaluator extends WebLlmWrapper {
    requiresCompleteResponse(type) {
      return type != null
    }
  }
  const partial = { choices: [{ finish_reason: "length", message: { content: "first" } }] }
  const engine = {
    getGPUVendor: async () => "test",
    chat: { completions: { create: async () => partial } },
  }
  const client = new GenerationEvaluator(engine, "m", new VibeConfig(), logger)
  await assert.rejects(
    client.vibe_eval("sentence", String),
    (e) => e.cause instanceof VibeResponseParseException,
  )
  assert.equal(await client.vibe_eval("raw"), "first")
})

test("each local evaluation gets its own ordered example messages before the user prompt", async () => {
  class ExampleEvaluator extends WebLlmWrapper {
    examplesFor(type) {
      return type === Number ? [["one more than 5", "6"]] : []
    }
  }
  const requests = []
  const create = async (request) => {
    requests.push(request.messages)
    return { choices: [{ finish_reason: "stop", message: { content: "3" } }] }
  }
  const engine = { getGPUVendor: async () => "test", chat: { completions: { create } } }
  const client = new ExampleEvaluator(engine, "m", new VibeConfig(config), logger)
  assert.equal(await client.vibe_eval("one more than 2", Number), 3)
  assert.equal(await client.vibe_eval("raw"), "3")
  assert.deepEqual(requests[0].slice(1), [
    { role: "user", content: "one more than 5" },
    { role: "assistant", content: "6" },
    { role: "user", content: "one more than 2" },
  ])
  assert.deepEqual(
    requests[1].map((m) => m.role),
    ["system", "user"],
  )
})

async function createGemini(options) {
  const { GoogleGenAI } = await import("@google/genai")
  return new GoogleGenAI(options)
}

test("the OpenAI Responses SDK sends instructions and joins visible output text", async () => {
  let request
  const sdk = await createOpenAI({
    apiKey: "offline",
    baseURL: "https://openai.invalid/v1",
    maxRetries: 0,
    fetch: async (input, init) => {
      request = new Request(input, init)
      return Response.json({
        id: "resp_fixture",
        object: "response",
        output: [
          {
            id: "rs_fixture",
            type: "reasoning",
            summary: [{ type: "summary_text", text: "False" }],
          },
          {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: "  TR", annotations: [] },
              { type: "output_text", text: "UE  ", annotations: [] },
            ],
          },
        ],
      })
    },
  })
  const client = new VibeLlmClient(sdk, "model", config, logger)
  assert.equal(await client.vibe_eval("Dogs are mammals.", Boolean), true)
  assert.equal(request.url, "https://openai.invalid/v1/responses")
  assert.equal(request.method, "POST")
  assert.deepEqual(await request.json(), {
    model: "model",
    instructions: config.system_instruction,
    input: "Dogs are mammals.",
  })
})

test("the Gemini SDK sends instructions and joins visible candidate text", async (t) => {
  let request
  t.mock.method(globalThis, "fetch", async (input, init) => {
    request = new Request(input, init)
    return Response.json({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ thought: true, text: "True" }, { text: "  FA" }, { text: "LSE  " }],
          },
          finishReason: "STOP",
        },
      ],
    })
  })
  const sdk = await createGemini({
    apiKey: "offline",
    httpOptions: { baseUrl: "https://gemini.invalid" },
  })
  const client = new VibeLlmClient(sdk, "model", config, logger)
  assert.equal(await client.vibe_eval("Dogs are reptiles.", Boolean), false)
  assert.equal(new URL(request.url).hostname, "gemini.invalid")
  assert.ok(new URL(request.url).pathname.endsWith("/models/model:generateContent"))
  assert.equal(request.method, "POST")
  const body = await request.json()
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "Dogs are reptiles." }] }])
  assert.deepEqual(body.systemInstruction.parts, [{ text: config.system_instruction }])
})

for (const provider of ["OpenAI", "Gemini"]) {
  test(`${provider} rate limits and replies without text retain their distinct error types`, async (t) => {
    let calls = 0
    const empty =
      provider === "OpenAI"
        ? {
            object: "response",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "refusal", refusal: "No response." }],
              },
            ],
          }
        : { promptFeedback: { blockReason: "SAFETY" } }
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      if (++calls === 1) {
        return Response.json(
          { error: { code: 429, message: "Offline rate limit" } },
          { status: 429 },
        )
      }
      return Response.json(empty)
    })
    const sdk =
      provider === "OpenAI"
        ? await createOpenAI({
            apiKey: "offline",
            baseURL: "https://openai.invalid/v1",
            maxRetries: 0,
            fetch,
          })
        : await createGemini({
            apiKey: "offline",
            httpOptions: {
              baseUrl: "https://gemini.invalid",
              retryOptions: { attempts: 1 },
            },
          })
    const client = new VibeLlmClient(sdk, "model", config, logger)
    await assert.rejects(client.vibe_eval("test", Boolean), (error) => {
      assert.ok(error.cause instanceof VibeLlmApiException)
      assert.equal(error.cause.cause.status, 429)
      return true
    })
    await assert.rejects(
      client.vibe_eval("test", Boolean),
      (error) => error.cause instanceof VibeResponseParseException,
    )
    assert.equal(calls, 2)
  })
}

test("a single VibeTools attempt respects the OpenAI SDK's own HTTP retries", async () => {
  let calls = 0
  const sdk = await createOpenAI({
    apiKey: "offline",
    baseURL: "https://openai.invalid/v1",
    maxRetries: 1,
    fetch: async () => {
      if (++calls === 1)
        return Response.json(
          { error: { message: "Try again" } },
          {
            status: 503,
            headers: { "retry-after-ms": "1" },
          },
        )
      return Response.json({ object: "response", output: [] })
    },
  })
  const client = new VibeLlmClient(sdk, "model", { vibe_mode: "chill" }, logger)
  assert.equal(await client.vibe_eval("test"), "")
  assert.equal(calls, 2)
})
