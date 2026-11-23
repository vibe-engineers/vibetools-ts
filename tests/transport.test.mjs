import assert from "node:assert/strict"
import { test } from "node:test"
import { VibeLlmApiException, VibeResponseParseException } from "@vibe-engineers/vibetools"
import { ConsoleLogger, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"

const config = { system_instruction: "Give a boolean verdict." }
const logger = new ConsoleLogger("transport-test")

async function createOpenAI(options) {
  const { default: OpenAI } = await import("openai")
  return new OpenAI(options)
}

async function createGemini(options) {
  const { GoogleGenAI } = await import("@google/genai")
  return new GoogleGenAI(options)
}

test("the OpenAI Responses SDK sends the instruction and reads actual output content", async () => {
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
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "  YES  ", annotations: [] }],
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

test("the Gemini SDK sends the instruction and reads candidate content", async (t) => {
  let request
  t.mock.method(globalThis, "fetch", async (input, init) => {
    request = new Request(input, init)
    return Response.json({
      candidates: [
        { content: { role: "model", parts: [{ text: "  No  " }] }, finishReason: "STOP" },
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
