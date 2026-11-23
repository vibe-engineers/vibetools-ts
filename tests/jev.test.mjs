import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { InternalServerError, TypeSafeClient } from "@typesafe-ai/sdk"
import {
  VibeLlmApiException,
  VibeLlmClientException,
  VibeResponseParseException,
  VibeTimeoutException,
} from "@vibe-engineers/vibetools"
import * as core from "@vibe-engineers/vibetools/_internal"
import * as jev from "@vibe-engineers/vibetools/_internal/jev_evaluator"

const logger = new core.ConsoleLogger("jev-test")
const question = "Should this proceed?"

function fixture(fetch, settings) {
  const client = new TypeSafeClient({
    apiKey: "offline",
    baseURL: "https://jev.invalid",
    logLevel: "off",
    // Any accidental SDK retry would now be immediately observable at the transport.
    retry: { maxRetries: 4, backoffInitialMs: 0, backoffMaxMs: 0 },
    fetch,
  })
  const config = new core.VibeConfig(settings)
  return new core.JevEvaluator(client, "jev-model", config, logger, question)
}

function reply(answers) {
  return Response.json({
    model: "jev-model",
    answers,
    usage: { input_tokens: 5, output_tokens: 1 },
  })
}

test("probability thresholds preserve exact cutoffs and reject invalid input", () => {
  for (const value of [0, 0.375, 1]) {
    assert.equal(jev.validateProbabilityThreshold(value), value)
  }
  for (const value of [false, true, "0.7", null, undefined]) {
    assert.throws(() => jev.validateProbabilityThreshold(value), {
      name: "TypeError",
      message: /probability_threshold/,
    })
  }
  for (const value of [-0.01, 1.01, Infinity, -Infinity, NaN]) {
    assert.throws(() => jev.validateProbabilityThreshold(value), {
      name: "RangeError",
      message: /probability_threshold/,
    })
  }
})

test("only official TypeSafe clients select the Jev evaluator and stay outside the generative client", () => {
  const client = new TypeSafeClient({ apiKey: "offline" })
  assert.equal(core.isJevClient(client), true)
  for (const lookalike of [{ systemOne() {} }, null, "jev"]) {
    assert.equal(core.isJevClient(lookalike), false)
  }
  assert.throws(() => new core.VibeLlmClient(client, "model", {}, logger), VibeLlmClientException)
})

test("checking an unrelated client keeps both optional SDK modules unloaded", () => {
  const program = `
    import assert from "node:assert/strict"
    import { createRequire } from "node:module"
    import { fileURLToPath } from "node:url"
    import { isJevClient } from "@vibe-engineers/vibetools/_internal"
    const require = createRequire(import.meta.url)
    assert.equal(isJevClient({}), false)
    for (const entry of [require.resolve("@typesafe-ai/sdk"), fileURLToPath(import.meta.resolve("@typesafe-ai/sdk"))]) {
      assert.equal(require.cache[entry], undefined)
    }
    assert.equal(isJevClient({ get systemOne() { throw new Error("getter ran") } }), false)
  `
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: new URL(".", import.meta.url),
    encoding: "utf8",
  })
  assert.equal(child.status, 0, child.stderr)
})

test("malformed, missing, mistyped and out-of-range answers are response parse failures", async () => {
  const responses = [
    new Response("malformed"),
    reply({}),
    reply({ decision: null }),
    reply({ decision: { noul: 0.8 } }),
    reply({ decision: { type: "score", noul: 0.8 } }),
    ...[true, "0.7", null, -0.1, 1.1].map((noul) => reply({ decision: { type: "noul", noul } })),
    // JSON.parse produces Infinity for this valid JSON numeric literal.
    new Response('{"answers":{"decision":{"type":"noul","noul":1e400}}}'),
  ]
  const evaluator = fixture(async () => responses.shift())
  const count = responses.length
  for (let i = 0; i < count; i++) {
    await assert.rejects(
      evaluator.probability("task"),
      (error) => error.cause instanceof VibeResponseParseException,
    )
  }
  assert.equal(responses.length, 0)
})

for (const [mode, count] of [
  ["chill", 1],
  ["eager", 2],
  ["aggressive", 3],
]) {
  test(`Jev ${mode} bounds HTTP requests and preserves the SDK error`, async () => {
    let calls = 0
    const evaluator = fixture(
      async () => {
        calls++
        return Response.json({ message: "temporarily unavailable" }, { status: 503 })
      },
      { vibe_mode: mode },
    )
    await assert.rejects(
      evaluator.probability({ record: "task" }),
      (error) =>
        error.cause instanceof VibeLlmApiException &&
        error.cause.cause instanceof InternalServerError &&
        error.cause.cause.status === 503,
    )
    assert.equal(calls, count)
  })
}

test("a Jev evaluation can recover from a malformed first answer", async () => {
  let calls = 0
  const evaluator = fixture(
    async () => reply(++calls === 1 ? {} : { decision: { type: "noul", noul: 0.46 } }),
    { vibe_mode: "eager" },
  )
  assert.equal(await evaluator.probability("task"), 0.46)
  assert.equal(calls, 2)
})

test("Jev's total timeout aborts a pending request and prevents later wire attempts", async () => {
  const signals = []
  const evaluator = fixture(
    (_input, init) => {
      signals.push(init.signal)
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
      )
    },
    { timeout: 40, vibe_mode: "aggressive" },
  )
  await assert.rejects(evaluator.probability("task"), VibeTimeoutException)
  assert.equal(signals.length, 1)
  assert.ok(signals[0].aborted)
  await new Promise((resolve) => setTimeout(resolve, 1020))
  assert.equal(signals.length, 1)
})

test("Jev starts no request with an exhausted deadline, including during the retry pause", async () => {
  for (const [timeout, expectedCalls] of [
    [0, 0],
    [30, 1],
  ]) {
    let calls = 0
    const evaluator = fixture(
      async () => {
        calls++
        return reply({})
      },
      { timeout, vibe_mode: "eager" },
    )
    await assert.rejects(evaluator.probability("task"), VibeTimeoutException)
    await new Promise((resolve) => setTimeout(resolve, 1030))
    assert.equal(calls, expectedCalls)
  }
})
