# Factory Provider Robustness

The `omp-provider-factory-droid` extension handles these protections without changes to Oh My Pi.

## Multi-account routing

Oh My Pi stores Factory OAuth logins as separate credentials under the `factory` provider. For every request, the plugin receives the account selected by OMP and keeps these values together:

- OAuth access token
- Factory organization ID
- Factory regional API endpoint

The request-time credential envelope is:

```json
{
  "token": "<access token>",
  "orgId": "<Factory organization ID>",
  "apiEndpoint": "https://api.factory.ai"
}
```

Refresh tokens are never included in this envelope. The `token` field also lets supported OMP versions identify the credential that failed and route a retry to another stored Factory account.

Account behavior:

- New sessions are distributed by OMP's credential selector.
- A session stays attached to its selected account while that account remains usable.
- A persistent `401` refreshes the current account once, then tries a sibling if the refreshed credential still fails.
- An account-specific `403` can move directly to another account.
- A recognized quota failure temporarily blocks the exhausted account and retries with a sibling.
- If every account is exhausted, OMP tries each account once and returns the final error without looping indefinitely.

These retry features require OMP 17.4.1 or newer. That version is now the plugin's minimum peer dependency.

## Factory organization selection

A Factory identity can belong to more than one organization. During `/login factory`:

1. An already organization-scoped token is used directly.
2. A single available organization is selected automatically.
3. Multiple organizations are displayed as a numbered prompt.
4. The selected organization is stored with the credential for future refreshes.

Run `/login factory` again to add another organization. Different organization IDs remain separate OMP credentials. A legacy credential with multiple possible organizations and no saved selection is rejected with re-login guidance instead of silently choosing the first organization.

Before a login or refresh is accepted, the plugin requires agreement between:

- the organization selected by the user or stored credential;
- the organization claim in the access token; and
- the organization returned by Factory's `/api/cli/whoami` endpoint.

A missing, mismatched, or rejected `whoami` response fails the login or refresh rather than creating an ambiguous credential.

## Endpoint safety

OAuth-discovered endpoints are validated before any bearer token is sent. A hosted endpoint must:

- use HTTPS;
- match `api.factory.ai` or `api.<region>.factory.ai` exactly;
- have no username, password, custom port, path prefix, query, or fragment.

This rejects lookalike hosts such as `api.factory.ai.evil.example` and prevents credential metadata from redirecting an OAuth bearer to an unrelated service.

`FACTORY_API_BASE` remains the explicit escape hatch for local development and trusted custom proxies. When set, it intentionally overrides OAuth-discovered endpoints.

## Optional exhausted-account preflight

Set:

```bash
export FACTORY_QUOTA_PREFLIGHT=1
```

The plugin then checks the selected OAuth account's Factory billing limits before starting a model request. Preflight is disabled by default, so normal routing performs no additional request unless the option is enabled.

Factory quotas are evaluated independently:

| Quota pool | Model families |
| --- | --- |
| Standard | Claude, GPT, Grok, Gemini, Muse Spark |
| Droid Core | GLM, Kimi, DeepSeek, MiniMax, Nemotron, Inkling |

These are examples. For models in the shipped registry, the quota gate uses each model's `billingPool` entry. For other models, it infers the pool from the model ID.

Only an explicitly exhausted relevant pool blocks a request. For example, an exhausted Standard pool does not block Kimi or GLM, and an exhausted Core pool does not block Claude or GPT.

Preflight behavior:

- Results are cached for 30 seconds by normalized endpoint and organization ID.
- Concurrent checks for the same account share one upstream request.
- Cache keys never contain bearer tokens.
- Preflight requests time out after 2.5 seconds.
- Ordinary usage requests time out after 10 seconds.
- Warning, unknown, malformed, timed-out, and unavailable usage data fail open and allow the model request.
- Accounts with Factory Extra Usage enabled are not preflight-blocked.
- Raw `FACTORY_API_KEY` requests are not preflighted because Factory's billing endpoint is OAuth-only.

This feature skips accounts already known to be exhausted. It does not rank healthy accounts by remaining percentage; healthy-account balancing remains owned by OMP's credential selector.

## Usage reporting

The plugin registers a native Factory usage provider with OMP 17.4.1 or newer. `/usage` reports:

- Standard 5-hour, weekly, and monthly windows;
- Droid Core 5-hour, weekly, and monthly windows;
- Extra Usage balance and eligibility metadata.

The reporter and quota gate omit windows the billing reply marks `unlimited`.

Usage reports and quota preflight share the same parser and account-scoped snapshot cache, preventing the two paths from interpreting Factory's response differently.

## OAuth and discovery timeouts

OAuth device authorization, token polling, organization lookup, `whoami`, and refresh requests are cancellable and have a 30-second per-request limit. Device polling still respects the overall device-code expiration time.

OAuth response bodies are limited to 64 KiB. Errors include the HTTP status and a short allowlisted error code when available; raw upstream bodies and token values are not copied into diagnostics.

Dynamic Factory model documentation requests time out after 10 seconds. Optional OpenRouter pricing remains independently bounded at 2.5 seconds. A Factory documentation failure remains an error so OMP can retain its last-known-good dynamic catalog.

## Diagnostics

Factory gateway diagnostics include enough routing context to identify configuration problems without exposing credentials:

- model and target protocol;
- normalized Factory endpoint;
- credential source type;
- redacted organization ID;
- whether `FACTORY_API_BASE` or `FACTORY_ORG_ID` affected routing.

Bearer tokens, refresh tokens, complete organization IDs, and serialized credentials are redacted. Original HTTP status classification is preserved so OMP can still distinguish refresh, sibling rotation, quota exhaustion, and transient backoff.

## Prompt and tool compatibility

Factory requests omit the exact initial `You are omp's trusted coding assistant.\n\n` preamble from the first OMP system block. The existing Droid identity prefix remains in the request.

For generated OMP subagent blocks beginning with `⁂ Role`, the adapter changes `You are operating on a piece of work assigned to you by the main agent.` to `You are working on a piece of work assigned to you by the main agent.` only in the `⁂ Coop` section before `⁂ Completion`. Live controls isolated the original sentence as a Factory policy-rejection trigger. The rewrite preserves the delegation instruction and all other instruction bytes. Quoted text outside the recognized section and unfamiliar prompt layouts remain unchanged. Neither adaptation modifies OMP's installed templates or stored rules.

The provider uses these wire names without changing OMP's local tool names:

| OMP tool | Factory wire name |
| --- | --- |
| `read` | `inspect_file` |
| `write` | `write_file` |
| `edit` | `edit_file` |
| `bash` | `omp_bash` |
| `glob` | `omp_glob` |
| `grep` | `omp_grep` |
| `task` | `omp_task` |
| `web_search` | `omp_web_search` |

The adapter translates declarations, explicit named tool choices, assistant calls, tool-result history, and supported native replay payloads. Returned calls use their original local names. Arguments, schemas, permissions, call IDs, and unrelated metadata are not rewritten. A request fails before model generation if an original name and its alias would identify different local tools. Other providers are unaffected.

The adapter does not retry policy rejections with fewer instructions. Acceptance was diagnosed on `factory/deepseek-v4.1-flash-1017`; other account and model entitlements remain gateway-controlled.

## Droid 1.18.0 compatibility

The update compares the verified Linux x64 npm binaries for Droid 1.14.0 and 1.18.0. The registry and request-builder evidence comes from JavaScript embedded in those binaries. This comparison did not launch either binary or contact the Factory gateway.

| Area | What the comparison found |
| --- | --- |
| Model registry | One new concrete model, `gemini-4-neon`, and no removals. Neon uses Google in the global inference region only. It supports text and images, defaults to `high`, has a 1,048,576-token context window with 65,536 reserved for output, and uses a 1.2× Standard multiplier. |
| Request builders | Gemini adds `XHIGH` for Neon and Hydrogen. Neon omits sampling defaults; Hydrogen retains them. The audited hosted Anthropic Messages, OpenAI Responses, and chat-completions defaults did not require a 1.18.0 change. |
| Hosted identity and billing | The audited `/api/cli/whoami`, `/api/cli/org`, and `/api/billing/limits` paths and fields still match. The plugin updates its shared client version headers without changing credential import, endpoint selection, or quota logic. |

Registry evidence: `ev_beb63cb86e04dd2b39ca890f65444f8e2cc51f3ba165159c8b05d57e6937f6e1` (1.18.0) and `ev_43e594d39bfeb1adfb0e1f0af89d83bed2e9554b5409858fd8a5106f80babf18` (1.14.0). The model comparison pairs rows by exact model ID. [`src/droid-registry.ts`](src/droid-registry.ts) records the 1.18.0 binary digest and byte range of the registry chunk.

The extension uses the shipped defaults and its existing public-doc refresh. It does not reproduce native Droid Auto routing, customer-prem login, connectors, or per-account catalog and feature-flag decisions. The static comparison cannot establish which models the gateway will allow for a particular account.

## Verification

Automated coverage includes:

- credential-envelope account attribution;
- token, organization, and endpoint pairing;
- explicit multi-organization login;
- strict token/selection/`whoami` agreement;
- persistent `401` refresh and sibling rotation;
- account-specific `403` sibling rotation;
- Standard/Core quota isolation;
- exhausted-account sibling rotation;
- bounded all-accounts-exhausted behavior;
- shared usage fetches with independent caller cancellation;
- malicious endpoint rejection;
- OAuth cancellation and bounded response handling;
- dynamic model discovery timeout;
- Gemini 4 Neon and Hydrogen `XHIGH` request payloads and offline Neon pricing;
- exact OMP prompt adaptations, idempotence, caller immutability, and quoted-text boundaries;
- native Factory usage-provider registration.

The suite uses synthetic credentials, local fetch mocks, and disposable temporary SQLite databases. It does not use real OAuth credentials or make paid model calls.

## Environment variables

| Variable | Behavior |
| --- | --- |
| `FACTORY_QUOTA_PREFLIGHT` | Set to `1` or `true` to skip explicitly exhausted OAuth accounts before model generation. |
| `FACTORY_API_BASE` | Trusted explicit override for every Factory endpoint, including local development proxies. |
| `FACTORY_API_KEY` | Uses a raw Factory API key instead of OAuth account selection. |
| `FACTORY_ORG_ID` | Optional organization fallback for raw credentials. OAuth envelopes do not borrow this value. |
| `FACTORY_ORGANIZATION_ID` | Alias for `FACTORY_ORG_ID`. |
| `FACTORY_UPSTREAM_CLIENT_TYPE` | Overrides the Factory client header; defaults to `cli`. |

## Known limitations

- Quota preflight is reactive to an explicitly exhausted account; it is not percentage-based load balancing.
- Factory billing-limit reporting and preflight are OAuth-only.
- `FACTORY_API_BASE` is trusted configuration and intentionally bypasses the hosted-endpoint allowlist.
- Automated tests do not validate live Factory entitlement or production OAuth service availability.
