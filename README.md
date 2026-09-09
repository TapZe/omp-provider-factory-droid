# OMP Provider Factory Droid

**`omp-provider-factory-droid` is a production-ready [Oh My Pi (`omp`)](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent) provider extension for accessing Factory.ai Droid models—including Claude Opus 5, Gemini 3.8 / 3.1 Pro, GPT-6 Astra, Grok 4.6, GLM 5.3, Kimi K3, and DeepSeek V4—through Factory's authenticated LLM Quad-Gateway.**

> [!NOTE]
> **Actively Maintained Fork (`v1.0.0`)**: Maintained continuation of [`tjboudreaux/pi-provider-factory`](https://github.com/tjboudreaux/pi-provider-factory) by [Muhammad Nabil Muyassar Rahman (@TapZe)](https://github.com/TapZe). Features complete Droid v0.215.1 contract parity, native Google Gemini Quad-Gateway routing, multi-account quota preflight failover, tool-call stream healing, and intelligent 403 diagnostics.

---

## Key Features

- **Full Model Portfolio**: Access Claude Opus 5 / Fable 5, Gemini 3.8 / 3.7 / 3.6 Flash, Gemini 3.1 Pro, GPT-6 Astra, GPT-5.6 Sol/Luna/Terra, Grok 4.6, GLM 5.3 / 5.3 Flash, Kimi K3, DeepSeek V4 Pro, and MiniMax M3 directly inside `omp`.
- **Quad-Gateway Wire Routing**: Routes each model family to its dedicated Factory gateway endpoint:
  - Anthropic Messages (`/api/llm/a`)
  - OpenAI Responses (`/api/llm/o/v1/responses`)
  - Google Generative AI (`/api/llm/g/v1/generate`)
  - Fireworks Completions (`/api/llm/o/v1/chat/completions`)
- **Droid-Compatible Browser OAuth**: Run `/login factory` to initiate instant device authorization at `https://auth.factory.ai/device`. Supports multi-organization selection, token refresh, and regional endpoint discovery.
- **Account-Isolated Sibling Failover**: Manages credentials with atomic account isolation (`token`, `X-Factory-Org-Id`, `apiEndpoint`). Enables automated sibling account retry if an account runs out of quota or encounters an authentication error.
- **Real-Time Quota Tracking & Preflight**: Query live Standard and Core usage limits and Extra Usage balances via `/usage`. Optionally enable `FACTORY_QUOTA_PREFLIGHT=1` to failover to sibling accounts before emitting model requests when a tier is exhausted.
- **Defensive Tool Normalization & Stream Healing**: Automatically repairs in-band XML tool calls (`<tool_call>`) from open-weight models via Hermes markup healing, and unwraps malformed embedded JSON tool names into structured harness calls.
- **Dynamic Model Discovery**: Ships an audited static catalog and automatically queries Factory's live model documentation at session start with real-time OpenRouter pricing synchronization.
- **Intelligent 403 Diagnostics**: Automatically enriches gateway 403 errors with redacted credential contexts, endpoint origins, organization IDs, and actionable remediation instructions.

---

## Supported Models

Curated static catalog synchronized with Droid CLI v0.215.1, augmented by dynamic discovery:

### 1. Claude and Anthropic Family
*Wire Endpoint: `POST /api/llm/a/v1/messages`*
- **Claude**: `claude-fable-5.1`, `claude-fable-5`, `claude-opus-5`, `claude-opus-5-fast`, `claude-opus-4-8`, `claude-opus-4-8-fast`, `claude-opus-4-7`, `claude-opus-4-7-fast`, `claude-opus-4-6`, `claude-opus-4-6-fast`, `claude-opus-4-5-20251101`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `atlas-07-21`, `aster-07-15` (`x-api-provider: anthropic`)
- **MiniMax**: `minimax-m3`, `minimax-m2.7`, `minimax-m2.5` (`x-api-provider: fireworks`)

### 2. Google Gemini Family
*Wire Endpoint: `POST /api/llm/g/v1/generate`*
- **Gemini**: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview` (`x-api-provider: google`)

### 3. GPT, Codex, and Grok Family
*Wire Endpoint: `POST /api/llm/o/v1/responses`*
- **GPT**: `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.5-fast`, `gpt-5.4`, `gpt-5.4-fast`, `gpt-5.4-mini`, `gpt-5.4-mini-fast`, `gpt-5.2`, `gpt-5.1`, `gpt-5` (`x-api-provider: openai`)
- **Codex**: `gpt-5.3-codex`, `gpt-5.3-codex-fast`, `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5-codex` (`x-api-provider: openai`)
- **Grok**: `grok-4.6`, `grok-4.5` (`x-api-provider: xai`)

### 4. Factory Core & Open Models
*Wire Endpoint: `POST /api/llm/o/v1/chat/completions`*
- **GLM**: `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-5.2-fast`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6` (`x-api-provider: fireworks`)
- **Kimi**: `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5` (`x-api-provider: fireworks`)
- **DeepSeek**: `deepseek-v4-pro`, `deepseek-v4-flash-0731` (`x-api-provider: fireworks`)
- **Nemotron / Inkling**: `nemotron-3-ultra`, `inkling` (`x-api-provider: fireworks`)

---

## Installation

### From GitHub (Recommended)
Install the plugin directly into Oh My Pi:

```zsh
omp install https://github.com/TapZe/omp-provider-factory-droid.git
```

### Local Development / Linking
If developing locally:

```zsh
git clone https://github.com/TapZe/omp-provider-factory-droid.git
cd omp-provider-factory-droid
bun install
omp plugin link "$PWD"
```

### Verify Installation
Check that the plugin is active:

```zsh
omp plugin list
```

### Uninstall / Remove
To cleanly remove or unlink the plugin from Oh My Pi:

```zsh
omp plugin uninstall omp-provider-factory-droid
```

---

## Authentication

### 1. Browser OAuth Device Flow (Recommended)
Inside Oh My Pi, run:

```text
/login factory
```

1. The plugin automatically generates a device code and opens your default browser to:
   ```text
   https://auth.factory.ai/device
   ```
2. Confirm the code and authenticate.
3. If your account belongs to multiple Factory organizations, the CLI prompts you to select which organization to bind to this profile.
4. Tokens and organization IDs are securely stored in OMP's native credentials storage.
5. To add another organization or account, simply run `/login factory` again. OMP manages multiple accounts and enables automatic failover.

### 2. Factory API Key (Headless / CI Environments)
If running in headless environments where browser login is unavailable:

```zsh
export FACTORY_API_KEY="fk-..."
```

*(Note: Live billing limit tracking via `/usage` requires an OAuth account; API keys bypass `/usage` by design).*

---

## Request Routing & Quad-Gateway Protocols

All requests route through Factory's LLM gateway (`https://api.factory.ai` or regional endpoints like `https://api.eu.factory.ai`).

| Family | Wire Gateway URL | Upstream Provider Header | Protocol Details |
| :--- | :--- | :--- | :--- |
| **Claude** | `POST /api/llm/a/v1/messages` | `x-api-provider: anthropic` | `anthropic-version: 2023-06-01`<br>`anthropic-beta: interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14`<br>`x-provider-routing-source: registry_default`<br>Native adaptive thinking |
| **Google Gemini** | `POST /api/llm/g/v1/generate` | `x-api-provider: google` | `x-provider-routing-source: registry_default`<br>Factory Google fetch adapter with top-level `model` injection<br>Thinking Level (`low`, `medium`, `high`) |
| **GPT / Codex / Grok** | `POST /api/llm/o/v1/responses` | `x-api-provider: openai`<br>(`xai` for Grok) | `OpenAI-Platform: org-bHuLtG1fGmYk5YaOihAAXFBw`<br>`x-provider-routing-source: registry_default`<br>OpenAI Responses stream |
| **Factory Core Models** | `POST /api/llm/o/v1/chat/completions` | `x-api-provider: fireworks` | `reasoning_history: "preserved"` (`"interleaved"` for DeepSeek)<br>`x-provider-routing-source: registry_default`<br>Hermes stream markup healing |

---

## Tool Execution & Normalization

All tool declarations, parameter schemas, and tool execution routines are provided directly by the Oh My Pi harness (`read`, `write`, `edit`, `bash`, etc.). The plugin ensures frictionless execution between OMP and Factory:

1. **System Prompt Attestation**: Factory's gateway requires Droid system instructions to validate client legitimacy and enforce active tool usage for reasoning models. The extension automatically prepends `FACTORY_DROID_SYSTEM_PROMPT` while preserving your custom instructions.
2. **Stream Markup Healing**: Open-weight models (GLM, Kimi, DeepSeek) that occasionally output tool calls as in-band XML (`<tool_call>...`) are repaired on the fly into structured tool events via Hermes healing.
3. **Embedded JSON Unwrapping**: If an open model mistakenly outputs a JSON payload inside the tool name field (e.g. `name: '{"name": "read", "arguments": ...}'`), the normalizer extracts the real tool name and arguments so OMP executes the tool seamlessly.

---

## Quota Tracking & Account Rotation

### Real-Time Billing Limits (`/usage`)
Check remaining usage quotas at any time:

```text
/usage
```

Displays:
- **Standard Quota**: 5-hour, weekly, and monthly limits (Claude, GPT, Grok, Gemini).
- **Droid Core Quota**: 5-hour, weekly, and monthly limits (GLM, Kimi, DeepSeek, MiniMax, Nemotron, Inkling).
- **Extra Usage Balance**: Remaining balance in USD, overage preferences, and billing rate notes.

### Optional Quota Preflight Gate
To automatically skip exhausted accounts and rotate to a healthy sibling account before calling the model:

```zsh
export FACTORY_QUOTA_PREFLIGHT=1
```

- Pre-checks cached billing limits with zero perceptible overhead.
- Maintains strict isolation: Core quota exhaustion will never block Standard models, and vice versa.
- Fails open on timeouts or network issues so requests are never blocked unnecessarily.

---

## Environment Variables

| Variable | Description |
| :--- | :--- |
| `FACTORY_API_KEY` | Optional Factory `fk-...` API key. Bypasses OAuth when set. |
| `FACTORY_API_BASE` | Overrides the Factory API base origin (e.g. `https://custom-proxy.internal`). |
| `FACTORY_ORG_ID` | Explicitly overrides `X-Factory-Org-Id` header (or alias `FACTORY_ORGANIZATION_ID`). |
| `FACTORY_QUOTA_PREFLIGHT` | Set `1` or `true` to enable automatic account failover on exhausted quotas. Default: disabled (`0`). |
| `FACTORY_UPSTREAM_CLIENT_TYPE` | Overrides `X-Factory-Client` header. Default: `cli`. |

---

## Intelligent Diagnostics & Troubleshooting

### `403 Forbidden` Gateway Errors
If Factory returns a 403 Forbidden error, the plugin automatically inspects and enriches the diagnostic stream:
- **Displays**: Model ID, wire gateway URL, endpoint origin, credential source, and organization ID.
- **Redacts**: All access tokens, bearer secrets, and organization IDs for safe logging.
- **Common causes**:
  1. `FACTORY_API_KEY` is set in your shell environment and overriding your OAuth session. Unset it: `unset FACTORY_API_KEY`.
  2. The account lacks an active subscription or entitlement for that specific model family.
  3. The account's selected organization changed. Re-authenticate via `/logout factory` and `/login factory`.

### Changing or Switching Accounts
To switch organizations or refresh an expired session:

```text
/logout factory
/login factory
```

---

## Credits & Attribution

This project is an actively maintained continuation of the initial [`pi-provider-factory`](https://github.com/tjboudreaux/pi-provider-factory) extension created by [Travis Boudreaux](https://github.com/tjboudreaux).

Due to upstream inactivity, this hard fork is maintained and expanded by [Muhammad Nabil Muyassar Rahman (@TapZe)](https://github.com/TapZe) with ongoing Droid parity synchronization, Google Gemini Quad-Gateway routing, quota-aware failover, dynamic discovery, and production hardening.

---

## License

[MIT License](LICENSE) — Copyright (c) 2026 Travis Boudreaux & Muhammad Nabil Muyassar Rahman (TapZe).
