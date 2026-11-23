<p align="center">
  <img width="220" src="../assets/vibetools.png" alt="VibeTools logo" />
</p>
<h1 align="center">VibeTools Developer Guide</h1>

## Table of Contents

- [Introduction](#introduction)
- [Navigating this Developer Guide](#navigating-this-developer-guide)
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Key Concepts & Design](#key-concepts--design)
- [Code Documentation](#code-documentation)
- [Testing](#testing)
- [Pull Requests](#pull-requests)
- [Final Notes](#final-notes)

## Introduction

VibeTools supplies the OpenAI and Gemini adapters and common evaluation logic used by VibeChecks, VibeGen, and VibeRetry. Its root exports `VibeConfig` and the shared exceptions. Libraries using the underlying clients import `ConsoleLogger` and `VibeLlmClient` from `@vibe-engineers/vibetools/_internal`. [VibeTools README](../README.md)

VibeChecks and VibeRetry can also use TypeSafe's Jev adapter to obtain a probability for a judgment.

## Navigating this Developer Guide

Run the commands in this guide from the root of the VibeTools TypeScript repository. All project paths below are relative to that directory. [vibe-engineers/vibetools-ts](https://github.com/vibe-engineers/vibetools-ts)

## Setup

Use Node.js 22.13 or later. Install the locked development dependencies and run the tests, which build VibeTools before checking its public imports.

```sh
npm ci
npm test
```

Provider SDKs are development dependencies here and optional peers for consumers. Install the SDK your application uses, choosing `openai@^7.62.0`, `@google/genai@^3.6.1`, or `@typesafe-ai/sdk@^0.7.0`. A Jev application creates a `TypeSafeClient` from `@typesafe-ai/sdk` with `TYPESAFE_API_KEY` set in the environment. [TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)

To use a local VibeTools build in another application, pack this repository and install the archive in that application's directory. For live calls, install the chosen SDK there using the version range in `peerDependencies`. [Package manifest](../package.json)

```sh
npm pack
npm install --prefix /path/to/your-app "$PWD/vibe-engineers-vibetools-0.1.0.tgz"
```

## Project Structure

- _src/index.ts_ exports the shared configuration and exceptions.
- *src/_internal/* contains `VibeConfig`, the retry modes, `VibeLlmClient`, the Jev evaluator, the console logger, and the argument formatting shared by VibeGen and VibeRetry.
- _src/llms/_ implements the base text evaluator, response coercion, and the OpenAI and Gemini adapters.
- _src/exceptions/_ defines the shared error classes.
- _tests/_ covers configuration, evaluation, provider calls, and logging.
- _assets/_ and _docs/_ contain the project image and this guide.

## Key Concepts & Design

### VibeLlmClient facade

For text generation, construct `new VibeLlmClient(client, model, config, logger)` with an OpenAI or Google Gemini SDK instance. The shared client selects a wrapper and exposes `await llm.vibe_eval(prompt, return_type?)`. Pass a string prompt and omit the second argument to receive the provider's text with surrounding whitespace trimmed. This example reads `OPENAI_API_KEY` and asks for a numeric result.

```ts
import OpenAI from "openai"
import { VibeConfig } from "@vibe-engineers/vibetools"
import { ConsoleLogger, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"

const llm = new VibeLlmClient(
  new OpenAI(),
  "gpt-5.6-luna",
  new VibeConfig({ vibe_mode: "EAGER" }),
  new ConsoleLogger("Example"),
)
const product = await llm.vibe_eval("What is 3.5 times 2? Reply with only the number.", Number)
console.log(product)
```

VibeTools recognizes SDK clients by their constructors. Your application and VibeTools must resolve the same installed copy of the provider SDK. This also applies to helpers that create clients. ESM and CommonJS imports from that installation both work. To change the model, instruction, and retry settings together, construct a new client with the new configuration.

### Shared LLM primitives

The OpenAI wrapper calls `responses.create` and reads `output_text`. The Gemini wrapper calls `models.generateContent` and reads `text`. Both forward the configured model, instruction, and prompt. They trim whitespace at the edges of the reply using Python's `str.strip` rules. The base evaluator applies the requested response type and retries provider or parse failures according to the configured mode.

The Jev adapter asks one Noul question per SDK call and validates the answer as a finite number in the inclusive range `0` to `1`. VibeChecks and VibeRetry apply their own decision thresholds. The adapter uses the shared timeout and retry settings. [TypeSafe Noul questions](https://docs.typesafe.ai/primitives/noul)

### Response types

TypeScript types are erased at runtime. The second argument to `vibe_eval` tells VibeTools how to interpret an OpenAI or Gemini text response.

| Argument                      | Result                                                                                   | Example model text       |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| Omitted or `String`           | Provider text                                                                            | `Shiba Inu`              |
| `Boolean`                     | A boolean. It accepts true/false, yes/no, t/f, y/n and 1/0, including case variants.     | `YES`                    |
| `Number`                      | A JavaScript floating-point number                                                       | `3.5`                    |
| `BigInt`                      | An exact standalone integer. JSON `true` and `false` are also accepted as `1n` and `0n`. | `9007199254740993`       |
| `Array`                       | An array decoded from JSON                                                               | `["Shiba Inu", "Akita"]` |
| `Object`                      | An object decoded from JSON                                                              | `{"breed":"Akita"}`      |
| An object with `parse(value)` | The value returned by your runtime schema                                                | `[51.5,-0.1]`            |

A schema can check required fields, validate array elements, enforce tuple length, or construct a class instance. For the equivalent of a Python `TypedDict` or dataclass, validate the decoded fields in a synchronous `parse` method and return the typed object or constructed instance. Throw when the value fails validation. If your application uses Zod, pass its synchronous schema directly to `vibe_eval`. Zod is a third-party dependency only for the application that chooses it. Given an initialized `llm`, this handwritten schema returns a TypeScript tuple.

```ts
const coordinate = {
  parse(value: unknown): [number, number] {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new TypeError("Expected a pair of coordinates.")
    }
    const [latitude, longitude] = value
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new TypeError("Both coordinates must be numbers.")
    }
    return [latitude, longitude]
  },
}

const [latitude, longitude] = await llm.vibe_eval(
  "Return London's latitude and longitude as a JSON array of two numbers.",
  coordinate,
)
```

Tuples are arrays at runtime. In arrays, objects, and inputs to a schema's `parse` method, unquoted JSON integer literals from `-9007199254740991` through `9007199254740991` are JavaScript `number` values. Integers outside that range arrive as exact `bigint` values. For example, the response `{"page":2,"id":9007199254740993}` produces `{ page: 2, id: 9007199254740993n }`. A schema for an integer field that can cross the boundary should accept both types.

Decimal and exponent literals such as `9007199254740993.0` and `1e20` use floating-point `number` precision. Quoted digits stay strings. For a standalone result, request `BigInt` to receive an exact integer even for small values, or `Number` for floating-point semantics. Python's configurable decimal-string limit can reject a very long integer that Node accepts.

By default, `JSON.stringify` throws on a `bigint`. If the receiving API accepts large IDs as decimal strings, supply a replacer when you serialize the result.

```ts
const record = { page: 2, id: 9007199254740993n }
const json = JSON.stringify(record, (_key, value) =>
  typeof value === "bigint" ? value.toString() : value,
)
// {"page":2,"id":"9007199254740993"}
```

### Configuration defaults

`new VibeConfig()` leaves `system_instruction` unset, uses a `timeout` of `10_000` milliseconds, and selects `"chill"`. Each configuration is immutable. Mode strings are case-insensitive, or you can pass a member of the `VibeMode` enum from `@vibe-engineers/vibetools/_internal/vibe_mode`.

When migrating a JSON configuration, omit `vibe_mode` to use the default in both languages. The Python dataclass also accepts an explicit `null` at runtime and makes one attempt. The TypeScript package requires a string or enum value for that option and raises `TypeError` for `null`. An unknown mode string raises `RangeError` in Node and `ValueError` in Python.

| `vibe_mode`  | Total attempts | Retries |
| ------------ | -------------: | ------: |
| `CHILL`      |              1 |       0 |
| `EAGER`      |              2 |       1 |
| `AGGRESSIVE` |              3 |       2 |

The evaluator waits one second between attempts. Each attempt calls the provider SDK once. The Jev evaluator disables SDK retries for that call. For OpenAI and Gemini, the SDK's own retry settings determine how many HTTP requests it can send.

The timeout covers the whole evaluation, including retry waits. The caller receives `VibeTimeoutException` when that deadline expires. For Jev, the evaluator signals cancellation and skips further attempts. With OpenAI and Gemini, an in-flight request can finish later, and remaining retries can run while the application stays alive. A pending VibeTools retry lets an otherwise idle Node process exit. The SDK's timers and connections can still keep the process alive. A synchronous schema that blocks the Node event loop delays delivery of the timeout until the schema yields.

### Logging

Pass a named `ConsoleLogger` to the shared client. It writes to standard error. Set `VIBE_LOG_LEVEL` before starting Node. The default is `ERROR`. OpenAI and Gemini log wrapper selection at `INFO` and prompts and replies at `DEBUG`. Jev logs evaluation failures at `INFO`. For Jev request and response details, set the SDK's `TYPESAFE_LOG_LEVEL=debug`.

### Exception taxonomy

All five exception classes can be imported from `@vibe-engineers/vibetools` or `@vibe-engineers/vibetools/exceptions`. The provider wrappers raise the final API or parse error directly. A `VibeLlmApiException` keeps the SDK's original rejection value in its `cause`. When its attempts run out, `VibeLlmClient.vibe_eval` rejects with an `Error` whose own `cause` is the final API or parse exception.

| Exception                    | When the caller sees it                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `VibeLlmClientException`     | Directly during construction if the client is unsupported.                                                               |
| `VibeInputTypeException`     | Directly when the prompt is not a string, before a provider call.                                                        |
| `VibeTimeoutException`       | Directly when the evaluation exceeds its deadline.                                                                       |
| `VibeLlmApiException`        | As the `cause` of an `Error` from the shared client when the last attempt failed at the provider.                        |
| `VibeResponseParseException` | As the `cause` of an `Error` from the shared client when the last response could not be converted to the requested type. |

## Code Documentation

Document provider-specific request fields in the wrapper that uses them. Include the expected resolved value and error behavior when changing the evaluator. Examples that introduce a new response shape should show how callers validate it at runtime.

## Testing

Run `npm run lint` and `npm test`. The test command builds VibeTools, type-checks its public declarations, and runs offline tests for response parsing, provider requests, retries, timeouts, and error causes. To inspect the package contents, run `npm pack --dry-run`.

Each companion package compares its behavior with the Python implementation. To verify a VibeTools change, pack it, install the archive in the affected package, and run `npm run test:parity` there. [VibeChecks tests](https://github.com/vibe-engineers/vibechecks-ts/blob/main/docs/DeveloperGuide.md#testing) · [VibeGen tests](https://github.com/vibe-engineers/vibegen-ts/blob/main/docs/DeveloperGuide.md#testing) · [VibeRetry tests](https://github.com/vibe-engineers/viberetry-ts/blob/main/docs/DeveloperGuide.md#testing)

## Pull Requests

Start a branch in your fork and describe the effect on dependent packages. Include a focused test for a change to coercion, retries, or the wire format used by a provider. Update the README or this guide when the import path or evaluation contract changes. [Contribution guide](../CONTRIBUTING.md)

## Final Notes

Discuss changes to the shared API with the maintainers. A small input and expected response can illustrate differences between providers. [Community Discord](https://discord.gg/dBW35GBCPZ)
