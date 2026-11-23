<p align="center">
  <img width="300" src="assets/vibetools.png" alt="VibeTools logo" />
</p>
<h1 align="center">VibeTools</h1>

<p align="center">
  <a href="https://github.com/vibe-engineers/vibetools-ts/actions/workflows/ci.yml"><img src="https://github.com/vibe-engineers/vibetools-ts/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@vibe-engineers/vibetools"><img src="https://img.shields.io/npm/v/@vibe-engineers/vibetools" alt="npm version" /></a>
  <a href="https://github.com/vibe-engineers/vibetools-ts/blob/main/package.json"><img src="https://img.shields.io/badge/node-%3E%3D22.13.0-43853d" alt="Node.js 22.13 or later" /></a>
  <a href="https://github.com/vibe-engineers/vibetools-ts/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="https://www.npmjs.com/package/@vibe-engineers/vibetools"><img src="https://img.shields.io/npm/dm/@vibe-engineers/vibetools" alt="Monthly npm downloads" /></a>
</p>

## Table of Contents

- [Introduction](#introduction)
- [Features](#features)
- [Technologies](#technologies)
- [Team](#team)
- [Contributing](#contributing)
- [Others](#others)

### Introduction

**VibeTools** is the internal TypeScript package shared by VibeChecks, VibeGen, and VibeRetry. Each installs it automatically. Install VibeTools directly when developing a library that uses the shared clients, configuration, logging, or exceptions. [VibeChecks](https://github.com/vibe-engineers/vibechecks-ts) · [VibeGen](https://github.com/vibe-engineers/vibegen-ts) · [VibeRetry](https://github.com/vibe-engineers/viberetry-ts)

Install VibeTools from npm.

```sh
npm install @vibe-engineers/vibetools
```

Install the SDK for the provider your application uses. Choose `openai` or `@google/genai` for text generation. For Jev judgments, install the optional TypeSafe SDK alongside VibeTools and set `TYPESAFE_API_KEY`. [Developer Guide](docs/DeveloperGuide.md) · [TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)

```sh
npm install @vibe-engineers/vibetools "@typesafe-ai/sdk@^0.7.0"
```

### Features

- **Shared LLM modules.** The OpenAI and Google Gemini wrappers share evaluation, response parsing, retries, and timeouts. Structured results preserve large integer literals as `bigint` and can use a handwritten validator or an optional synchronous Zod schema. [Response types](docs/DeveloperGuide.md#response-types)
- **Jev judgments.** VibeChecks and VibeRetry use Jev's native probability for boolean conditions and retry decisions. VibeTools validates the probability directly. [TypeSafe Noul questions](https://docs.typesafe.ai/primitives/noul)
- **Common base exceptions.** VibeTools exports exceptions such as `VibeTimeoutException` and `VibeResponseParseException` for use across libraries.
- **Logger.** The shared console logger uses `VIBE_LOG_LEVEL` to control which messages it writes. [Logging](docs/DeveloperGuide.md#logging)

### Technologies

##### Done with

<p align="center">
  <img height="150" width="150" src="https://www.typescriptlang.org/branding/ts-logo-128.svg" alt="TypeScript logo" />
</p>
<p align="center">TypeScript on Node.js 22.13 or later</p>

##### Project Repository

[vibe-engineers/vibetools-ts](https://github.com/vibe-engineers/vibetools-ts) · [Python implementation](https://github.com/vibe-engineers/vibetools)

### Team

- [Kong Le-Yi](https://github.com/konglyyy)
- [Tan Jin](https://github.com/tjtanjin)

### Contributing

To contribute to VibeTools, fork the repository and open a pull request describing the change and how you tested it. The repository includes issue and pull request templates. [Developer Guide](docs/DeveloperGuide.md) · [Contributing](CONTRIBUTING.md)

For bugs or suggestions, open an issue or discuss it with the team on Discord. [GitHub issues](https://github.com/vibe-engineers/vibetools-ts/issues) · [Community Discord](https://discord.gg/dBW35GBCPZ)

### Others

For implementation questions, reach the team on Discord. To report a vulnerability privately, follow the security policy. [Community Discord](https://discord.gg/dBW35GBCPZ) · [Security policy](SECURITY.md)
