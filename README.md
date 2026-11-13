# OMP Provider Factory Droid

`omp-provider-factory-droid` is a provider extension for [Oh My Pi (`omp`)](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent). It lets `omp` use the models that Factory Droid 1.10.0 offers, such as Claude Opus 5, Gemini 3.8 Flash, GPT-6 Astra, Grok 4.7, GLM 5.3, Kimi K3, and DeepSeek V4, through Factory's LLM gateway.

> [!NOTE]
> **Actively Maintained Fork (`v1.6.0`)**: Maintained continuation of [`tjboudreaux/pi-provider-factory`](https://github.com/tjboudreaux/pi-provider-factory) by [Muhammad Nabil Muyassar Rahman (@TapZe)](https://github.com/TapZe). Droid 1.10.0 model catalog, native Google Gemini Quad-Gateway routing, bidirectional Droid CLI Keychain sync (`auth.v2.loginkeychain`), session auto-recovery, multi-account quota preflight failover, tool-call stream healing, and 403/400 diagnostics.

---

## Key Features

- **Droid 1.10.0 models.** The 91 models in the Droid 1.10.0 registry, with the same reasoning efforts, defaults, image input, limits, and multipliers.
- **Quad-Gateway Wire Routing**: Routes each model family to its dedicated Factory gateway endpoint with W3C `traceparent` telemetry injection:
  - Anthropic Messages (`/api/llm/a`)
  - OpenAI Responses (`/api/llm/o/v1/responses`)
  - Google Generative AI (`/api/llm/g/v1/generate`)
  - Fireworks & Upstream Completions (`/api/llm/o/v1/chat/completions`)
- **Droid-Compatible OAuth, Bidirectional Keychain Sync & Auto-Recovery**: Run `/login factory` to auto-import an existing Droid CLI login session (`~/.factory/`) or initiate device authorization at `https://auth.factory.ai/device`. Rotated credentials synchronize back to macOS Keychain (`auth.v2.loginkeychain`) and Linux file storage (`auth.v2.file`) with AES-256-GCM, and stale sessions recover from local Droid CLI storage.
- **Account-Isolated Sibling Failover**: Manages credentials with atomic account isolation (`token`, `X-Factory-Org-Id`, `apiEndpoint`). Enables automated sibling account retry if an account runs out of quota or encounters an authentication error.
- **Real-Time Quota Tracking & Preflight**: Query live Standard and Core usage limits and Extra Usage balances via `/usage`. Optionally enable `FACTORY_QUOTA_PREFLIGHT=1` to failover to sibling accounts before emitting model requests when a tier is exhausted.
- **Defensive Tool Normalization & Stream Healing**: Automatically repairs in-band XML tool calls (`<tool_call>`) from open-weight models via Hermes markup healing, and unwraps malformed embedded JSON tool names into structured harness calls.
- **Dynamic Model Discovery**: Ships an audited static catalog and automatically queries Factory's live model documentation at session start with real-time OpenRouter pricing synchronization.
- **Intelligent 403 Diagnostics**: Automatically enriches gateway 403 errors with redacted credential contexts, endpoint origins, organization IDs, and actionable remediation instructions.

---

## Supported models

The static catalog holds the 91 models in the Droid CLI 1.10.0 registry. Each
model sends the request fields that Droid 1.10.0 sends for that model, effort,
and upstream provider. Feature-gated models need access on the selected
Factory organization.

`gpt-6.1-sol-ultrafast` needs Factory's high-cost opt-in. Listing it does not
grant access.

The Global, EU, and US columns name the upstream that the `x-api-provider`
header asks for in each inference region. The region comes from Factory's
whoami reply at login, as in Droid. "none" means Droid does not offer the model
in that region, and the extension returns an error without sending a request.

### 1. Anthropic Messages

Endpoint `POST /api/llm/a/v1/messages`.

| Model | Global | EU | US | Input | Efforts | Default |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `claude-fable-5.2` | anthropic | none | anthropic | text, image | low, medium, high, xhigh, max | high |
| `claude-fable-5.1` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-fable-5` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-5-5` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max | medium |
| `claude-opus-5-5-fast` | anthropic | none | anthropic | text, image | low, medium, high, xhigh, max | medium |
| `claude-opus-5` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-5-fast` | anthropic | none | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-4-8` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-4-8-fast` | anthropic | none | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-4-7` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-4-7-fast` | anthropic | none | none | text, image | low, medium, high, xhigh, max, off | high |
| `claude-opus-4-6` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, max, off | high |
| `claude-opus-4-6-fast` | anthropic | none | anthropic | text, image | low, medium, high, max, off | high |
| `claude-opus-4-5-20251101` | anthropic | vertex_anthropic | vertex_anthropic | text, image | low, medium, high, off | off |
| `claude-sonnet-5-5` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-sonnet-5` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | high |
| `claude-sonnet-4-6` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, max, off | high |
| `claude-sonnet-4-5-20250929` | anthropic | vertex_anthropic | vertex_anthropic | text, image | low, medium, high, off | off |
| `claude-haiku-5-5` | anthropic | vertex_anthropic | anthropic | text, image | low, medium, high, xhigh, max, off | medium |
| `claude-haiku-4-5-20251001` | anthropic | vertex_anthropic | vertex_anthropic | text, image | low, medium, high, off | off |
| `atlas-07-21` | anthropic | none | none | text, image | low, medium, high, xhigh, max, off | high |
| `aster-07-15` | anthropic | none | none | text, image | low, medium, high, xhigh, max, off | high |
| `minimax-m2.7` | fireworks | none | none | text | high | high |
| `minimax-m2.5` | fireworks | none | none | text | low, medium, high | high |

### 2. OpenAI Responses

Endpoint `POST /api/llm/o/v1/responses`.

| Model | Global | EU | US | Input | Efforts | Default |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `gpt-6-astra` | openai | none | openai | text, image | low, medium, high, xhigh, max | medium |
| `gpt-6-sol` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-6-sol-fast` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-6.1-sol` | openai | openai | openai | text, image | low, medium, high, xhigh, max | medium |
| `gpt-6.1-sol-ultrafast` | openai | openai | openai | text, image | low, medium, high, xhigh, max | medium |
| `gpt-6.1-terra` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-6-luna` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-6-luna-fast` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-5.6-sol` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-5.6-sol-fast` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-5.6-terra` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-5.6-luna` | openai | openai | openai | text, image | low, medium, high, xhigh, max, off | medium |
| `gpt-5.5` | openai | openai | openai | text, image | low, medium, high, xhigh | medium |
| `gpt-5.5-fast` | openai | openai | openai | text, image | low, medium, high, xhigh | medium |
| `gpt-5.5-pro` | openai | openai | openai | text, image | medium, high, xhigh | medium |
| `gpt-5.4` | openai | openai | openai | text, image | low, medium, high, xhigh | medium |
| `gpt-5.4-fast` | openai | openai | openai | text, image | low, medium, high, xhigh | medium |
| `gpt-5.4-mini` | openai | openai | openai | text, image | low, medium, high, xhigh | high |
| `gpt-5.4-mini-fast` | openai | openai | openai | text, image | low, medium, high, xhigh | high |
| `gpt-5.3-codex` | openai | openai | none | text, image | low, medium, high, xhigh | medium |
| `gpt-5.3-codex-fast` | openai | openai | none | text, image | low, medium, high, xhigh | medium |
| `gpt-5.2` | openai | openai | openai | text, image | low, medium, high, xhigh, off | low |
| `gpt-5.2-codex` | openai | openai | openai | text, image | low, medium, high, xhigh | medium |
| `gpt-5.1-codex-max` | openai | openai | openai | text, image | low, medium, high, xhigh | medium |
| `grok-4.7` | xai | none | xai | text, image | low, medium, high, xhigh | high |
| `grok-4.6` | xai | none | xai | text, image | low, medium, high, xhigh | high |
| `grok-4.5` | xai | none | none | text, image | low, medium, high | high |
| `muse-spark-1.3` | google | none | none | text, image | low, medium, high, xhigh | high |

### 3. Chat completions

Endpoint `POST /api/llm/o/v1/chat/completions`.

| Model | Global | EU | US | Input | Efforts | Default |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `inkling` | fireworks | none | none | text, image | minimal, low, medium, high, xhigh, max, off | high |
| `mistral-large-4` | mistral | mistral | none | text, image | high, off | high |
| `mistral-medium-3.5` | mistral | mistral | none | text, image | high, off | high |
| `glm-5.3` | fireworks | mistral | baseten | text | low, high, max | max |
| `glm-5.3-flash` | fireworks | none | baseten | text, image | low, high, max | high |
| `glm-5.2` | baseten | mistral | baseten | text | high, max, off | high |
| `glm-5.2-fast` | baseten | none | baseten | text | high, max, off | high |
| `glm-5.1` | fireworks | none | baseten | text | high, off | high |
| `glm-5` | fireworks | none | none | text | off | off |
| `glm-4.7` | fireworks | none | none | text | off | off |
| `glm-4.6` | baseten | none | baseten | text | off | off |
| `kimi-k3.1-pro` | fireworks | none | baseten | text, image | low, high, max | max |
| `kimi-k3` | fireworks | none | baseten | text, image | low, high, max, off | high |
| `kimi-k2.7-code` | fireworks | none | baseten | text, image | high, off | high |
| `kimi-k2.6` | fireworks | none | baseten | text, image | high, off | high |
| `kimi-k2.5` | fireworks | none | baseten | text, image | high, off | high |
| `deepseek-v4.1-flash` | fireworks | none | baseten | text, image | low, high, max, off | high |
| `deepseek-v4.1-flash-1017` | fireworks | none | baseten | text, image | low, high, max, off | high |
| `deepseek-v4-flash-0731` | fireworks | none | baseten | text | low, high, max, off | high |
| `deepseek-v4-pro` | fireworks | none | baseten | text | low, high, max, off | high |
| `minimax-m3` | fireworks | none | none | text, image | high | high |
| `minimax-m3.1-flash` | fireworks | none | none | text, image | low, medium, high, xhigh, max | max |
| `nemotron-3-ultra` | baseten | none | baseten | text | high, off | high |
| `nemotron-3.5-super` | baseten | none | baseten | text, image | high, off | high |
| `qwen3.8-max` | fireworks | none | none | text | low, medium, xhigh | xhigh |
| `muse-spark-1.2` | fireworks | none | none | text, image | low, medium, high, xhigh | high |
| `muse-spark-open` | baseten | none | baseten | text, image | low, medium, high, xhigh, max | high |
| `beam-1.0` | baseten | none | baseten | text | low, medium, high, xhigh, max | high |

### 4. Google Generative AI

Endpoint `POST /api/llm/g/v1/generate`.

| Model | Global | EU | US | Input | Efforts | Default |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `gemini-4-hydrogen` | google | google | google | text, image | low, medium, high | high |
| `gemini-4-carbon` | google | none | none | text, image | low, medium, high | medium |
| `gemini-4-argon` | google | none | none | text, image | low, medium, high | medium |
| `gemini-3.8-flash` | google | google | google | text, image | low, medium, high | high |
| `gemini-3.7-flash` | google | google | google | text, image | low, medium, high | high |
| `gemini-3.6-flash` | google | google | google | text, image | low, medium, high | high |
| `gemini-3.5-flash` | google | google | google | text, image | minimal, low, medium, high | high |
| `gemini-3-flash-preview` | google | none | none | text, image | minimal, low, medium, high | high |
| `gemini-3.1-pro-preview` | google | none | none | text, image | low, medium, high | high |
| `gemini-3-pro-preview` | google | none | none | text, image | low, medium, high, off | high |
| `garnet-07-15` | google | none | none | text, image | medium, high | high |

### Models from Factory's docs

At session start the extension also reads Factory's model docs
(`https://docs.factory.ai/models.md`) and OpenRouter prices, at most every 15
minutes. A model that appears there but not in the Droid registry is listed
too. It gets low, medium, and high efforts and no Droid request fields.

### Costs

Model costs come from OpenRouter's public model list, read at session start
with the docs. A Factory id matches its OpenRouter id by name, or through a short
explicit list where OpenRouter spells it differently (Claude versions with dots,
Nemotron 3 Ultra, Beam 1.0, Mistral Large 4 and Medium 3.5). Models with no clear
OpenRouter equivalent (fast variants, Qwen3.8 Max, Nemotron 3.5 Super, Atlas,
Aster, Garnet) and sessions without network use the static costs in the catalog.

---

## Model selection and reasoning

### Selecting models

Pick a Factory model in the `/model` picker or type its id:

```text
/model factory/claude-opus-5
/model factory/gemini-3.8-flash
/model factory/gpt-6-astra
/model factory/glm-5.3-flash
```

To make a Factory model the default in `~/.omp/config.json`:

```json
{
  "defaultModel": "factory/claude-opus-5"
}
```

### Reasoning efforts

Each model offers the efforts in its Efforts column and starts at its Default.
Droid uses six levels (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`) plus
`off`, and each model lists only the ones Droid lists for it. When you ask for
an effort the model does not list, the extension sends `off` if the model has
it, or else the model's lowest effort, as Droid does.

The fields that carry the effort differ by API, and the extension sends what
Droid sends:

- Anthropic models get `thinking` and `output_config.effort`. The Claude 4.5
  models and MiniMax M2.x use a token budget, and the other models use adaptive
  thinking.
- Responses models get `reasoning.effort`, plus the cache and verbosity fields
  that Droid sends for the provider.
- Chat completion models get `reasoning_effort`. On Fireworks, DeepSeek also
  gets `reasoning_history: "interleaved"`, and Kimi, Qwen, Inkling, Muse Spark
  1.2, GLM 5.1, and GLM 5.3 get `reasoning_history: "preserved"`.
- Gemini models get `thinkingConfig.thinkingLevel`.

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

### 1. Droid CLI Session Auto-Import & Browser OAuth
Inside Oh My Pi, run:

```text
/login factory
```

1. **Native Droid CLI Auto-Import**: The extension automatically inspects your local Droid CLI environment (`~/.factory/auth.v2.loginkeychain` or `~/.factory/auth.v2.file`). If you are already logged in via `droid`, the plugin decrypts and imports your credentials directly into Oh My Pi with **no browser interaction required**.
2. **Device Code Fallback**: If no local Droid CLI session exists or if it has expired, the plugin automatically falls back to generating an interactive device authorization code:
   ```text
   https://auth.factory.ai/device
   ```
3. Confirm the code in your browser and authorize the application.
4. If your account belongs to multiple Factory organizations, the CLI prompts you to select which organization to bind to this profile.
5. **Zero Re-Login Token Refresh**: Tokens are automatically refreshed in the background before expiry via WorkOS OAuth token refresh. Parameter filtering guarantees that internal WorkOS organizational scoping does not trigger `organization_not_found` errors, ensuring persistent session validity without requiring repeated manual logins.
6. To add another organization or account, simply run `/login factory` again. OMP manages multiple accounts and enables automatic failover.

### 2. Factory API Key (Headless / CI Environments)
If running in headless environments where browser login is unavailable:

```zsh
export FACTORY_API_KEY="fk-..."
```

*(Note: Live billing limit tracking via `/usage` requires an OAuth account; API keys bypass `/usage` by design).*

---

## Request Routing & Quad-Gateway Protocols

All requests route through Factory's LLM gateway (`https://api.factory.ai` or regional endpoints like `https://api.eu.factory.ai`). Every outbound gateway request includes a valid W3C distributed trace header (`traceparent: 00-${traceId}-${spanId}-01`) alongside `X-Client-Version` matching Droid v1.10.0.

| API | Gateway URL | Upstream header | Other headers |
| :--- | :--- | :--- | :--- |
| Anthropic Messages | `POST /api/llm/a/v1/messages` | `x-api-provider` from the region table | `anthropic-version: 2023-06-01`<br>`anthropic-beta` with Droid's betas for the model, plus `fine-grained-tool-streaming-2025-05-14` when the request has tools |
| Google Generative AI | `POST /api/llm/g/v1/generate` | `x-api-provider: google` | `x-provider-routing-source: registry_default` |
| OpenAI Responses | `POST /api/llm/o/v1/responses` | `x-api-provider` from the region table | `OpenAI-Platform: org-bHuLtG1fGmYk5YaOihAAXFBw`<br>`x-provider-routing-source: registry_default` |
| Chat completions | `POST /api/llm/o/v1/chat/completions` | `x-api-provider` from the region table | `x-provider-routing-source: registry_default` |

---

## Tool Execution & Normalization

All tool declarations, parameter schemas, and tool execution routines are provided directly by the Oh My Pi harness (`read`, `write`, `edit`, `bash`, etc.). The plugin ensures frictionless execution between OMP and Factory:

1. **System Prompt Attestation**: Factory's gateway requires Droid system instructions to validate client legitimacy and enforce active tool usage for reasoning models. The extension automatically prepends `FACTORY_DROID_SYSTEM_PROMPT` while preserving your custom instructions.
2. **Stream Markup Healing**: Open-weight models (GLM, Kimi, DeepSeek) that occasionally output tool calls as in-band XML (`<tool_call>...`) are repaired on the fly into structured tool events via Hermes healing.
3. **Embedded JSON Unwrapping**: If an open model mistakenly outputs a JSON payload inside the tool name field (e.g. `name: '{"name": "read", "arguments": ...}'`), the normalizer extracts the real tool name and arguments so OMP executes the tool call directly.

---

## Quota Tracking & Account Rotation

### Real-Time Billing Limits (`/usage`)
Check remaining usage quotas at any time:

```text
/usage
```

Displays:
- **Standard Quota**: 5-hour, weekly, and monthly limits (Claude, GPT, Grok, Gemini, and Muse Spark, which Droid 1.10.0 bills from the Standard pool).
- **Droid Core Quota**: 5-hour, weekly, and monthly limits (GLM, Kimi, DeepSeek, MiniMax, Nemotron, Inkling).
  As in Droid 1.10.0, a window that the billing reply marks `unlimited` is left out of both quotas and of the preflight gate.
- **Extra Usage Balance**: Remaining balance in USD, overage preferences, and billing rate notes.

### Optional Quota Preflight Gate
To automatically skip exhausted accounts and rotate to a healthy sibling account before calling the model:

```zsh
export FACTORY_QUOTA_PREFLIGHT=1
```

- **In-Memory Cache & Shared In-Flight**: Quotas are cached for 30 seconds per endpoint/org; concurrent requests coalesce into a single in-flight billing check.
- **Strict Tier Isolation**: Core quota exhaustion will never block Standard models, and Standard exhaustion will never block Core models.
- **Extra Usage Exemption**: Accounts with Factory Extra Usage (pay-as-you-go overages) enabled are never blocked.
- **Automatic Sibling Rotation**: If an account's quota tier is exhausted, the gate emits a synthetic `usage_limit_reached` event with a reset countdown. Oh My Pi catches this and automatically retries with your next authenticated Factory sibling account without interrupting your workflow.
- **Fail-Open Resilience**: Billing limit timeouts, network hiccups, and API-key sessions fail open so model calls are never blocked unnecessarily.


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
