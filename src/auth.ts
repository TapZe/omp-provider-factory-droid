import { setTimeout as delay } from "node:timers/promises";

import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai/oauth/types";

import {
  emailFromAccessToken,
  expiresFromAccessToken,
  formatErrorDetails,
  identityFromWhoami,
  oauthErrorCodeFromResponse,
  parseDeviceAuthorization,
  parseTokenResponse,
  parseUniqueOrganizationIds,
  readJsonResponse,
  readJsonResponseBody,
  TOKEN_EXPIRY_SKEW_MS,
  type DeviceAuthorization,
  type ParsedTokenResponse,
} from "./auth-parsing";
import { FACTORY_API, WORKOS_CLIENT_ID, WORKOS_DEVICE_AUTHORIZE, WORKOS_TOKEN } from "./constants";
import { decodeJwtPayload, organizationIdFromAccessToken } from "./credential";
import { loadDroidCliCredentials } from "./droid-auth";

type Fetcher = NonNullable<OAuthLoginCallbacks["fetch"]>;

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const AUTH_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

function combineSignalWithTimeout(callerSignal?: AbortSignal, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
}

async function requestDeviceAuthorization(fetchImpl: Fetcher, signal?: AbortSignal): Promise<DeviceAuthorization> {
  const response = await fetchImpl(WORKOS_DEVICE_AUTHORIZE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: WORKOS_CLIENT_ID,
    }),
    signal: combineSignalWithTimeout(signal),
  });
  const parsed = await readJsonResponse(response, "device authorization");

  return parseDeviceAuthorization(parsed);
}

async function resolveOrganizationIds(accessToken: string, fetchImpl: Fetcher, signal?: AbortSignal): Promise<string[]> {
  const response = await fetchImpl(`${FACTORY_API}/api/cli/org`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: combineSignalWithTimeout(signal),
  });


  const parsed = await readJsonResponse(response, "organization membership");
  return parseUniqueOrganizationIds(parsed);
}

async function resolveWhoami(
  accessToken: string,
  fetchImpl: Fetcher,
  organizationId?: string,
  signal?: AbortSignal,
): Promise<{ accountId?: string; region?: string; apiEndpoint?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (organizationId) {
    headers["X-Factory-Org-Id"] = organizationId;
  }

  const response = await fetchImpl(`${FACTORY_API}/api/cli/whoami`, {
    method: "GET",
    headers,
    signal: combineSignalWithTimeout(signal),
  });

  const parsed = await readJsonResponse(response, "whoami");
  return identityFromWhoami(parsed);
}

async function selectOrganizationId(
  organizations: string[],
  callbacks: OAuthLoginCallbacks,
): Promise<string> {
  if (organizations.length === 0) {
    throw new Error("Factory OAuth login did not expose an organization id; LLM calls would 403");
  }

  if (organizations.length === 1) {
    return organizations[0];
  }

  if (!callbacks.onPrompt) {
    throw new Error("Factory OAuth account has multiple organizations, but prompt callback is unavailable");
  }

  const promptMessage =
    "Select Factory organization:\n" +
    organizations.map((org, idx) => `  ${idx + 1}. ${org}`).join("\n") +
    "\nEnter number or organization ID: ";

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rawAnswer = await callbacks.onPrompt({
      message: promptMessage,
      placeholder: "1",
    });
    const answer = rawAnswer?.trim();

    if (answer) {
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= organizations.length) {
        return organizations[index - 1];
      }

      if (organizations.includes(answer)) {
        return answer;
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      callbacks.onProgress?.(
        `Invalid Factory organization selection. Choose between 1 and ${organizations.length} or enter an exact organization ID.`,
      );
    }
  }

  throw new Error(`Factory OAuth organization selection failed after ${MAX_ATTEMPTS} attempts`);
}

async function pollDeviceToken(
  authorization: DeviceAuthorization,
  callbacks: OAuthLoginCallbacks,
  fetchImpl: Fetcher,
): Promise<ParsedTokenResponse> {
  const timeoutSignal = AbortSignal.timeout(authorization.expiresInSeconds * 1000);
  const signal = callbacks.signal ? AbortSignal.any([callbacks.signal, timeoutSignal]) : timeoutSignal;
  let intervalSeconds = authorization.intervalSeconds;

  while (!signal.aborted) {
    callbacks.onProgress?.("Waiting for Factory browser login...");
    await delay(intervalSeconds * 1000, undefined, { signal });

    const response = await fetchImpl(WORKOS_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: authorization.deviceCode,
        client_id: WORKOS_CLIENT_ID,
      }),
      signal: combineSignalWithTimeout(signal),
    });
    const parsed = await readJsonResponseBody(response, "device token");

    if (response.ok) {
      return parseTokenResponse(parsed, "device token");
    }

    const errorCode = oauthErrorCodeFromResponse(parsed) ?? "unknown";

    switch (errorCode) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalSeconds += 1;
        callbacks.onProgress?.(`Factory asked us to slow polling to ${intervalSeconds}s`);
        break;
      case "access_denied":
      case "expired_token":
        throw new Error("Factory OAuth authorization failed or expired");
      default:
        throw new Error(`Factory OAuth device token failed with ${errorCode}`);
    }
  }

  throw new Error(`Factory OAuth device login cancelled: ${signal.reason}`);
}

const MAX_REFRESH_ATTEMPTS = 3;
const REFRESH_BACKOFF_BASE_MS = 500;

function isTransientRefreshError(error: unknown, status?: number): boolean {
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("timeout") ||
      msg.includes("etimedout")
    );
  }
  return false;
}

async function postRefreshToken(
  refreshToken: string,
  fetchImpl: Fetcher,
  fallbackRefreshToken: string,
  organizationId?: string,
  signal?: AbortSignal,
): Promise<ParsedTokenResponse> {
  // WorkOS expects organization_id to be an internal WorkOS identifier (starting with "org_" or "org-").
  // Passing an external Factory organization ID causes WorkOS to reject with 400 organization_not_found.
  const isWorkosOrgId = organizationId ? /^org[-_][a-zA-Z0-9_-]+$/.test(organizationId) : false;
  const bodyParams = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: WORKOS_CLIENT_ID,
  });
  if (isWorkosOrgId && organizationId) {
    bodyParams.set("organization_id", organizationId);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(WORKOS_TOKEN, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: bodyParams,
        signal: combineSignalWithTimeout(signal),
      });

      if (!response.ok && isTransientRefreshError(undefined, response.status) && attempt < MAX_REFRESH_ATTEMPTS) {
        if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
        await delay(REFRESH_BACKOFF_BASE_MS * attempt, undefined, { signal });
        continue;
      }

      const parsed = await readJsonResponse(response, "refresh token");
      return parseTokenResponse(parsed, "refresh token", fallbackRefreshToken);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (isTransientRefreshError(error) && attempt < MAX_REFRESH_ATTEMPTS) {
        await delay(REFRESH_BACKOFF_BASE_MS * attempt, undefined, { signal });
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error("Factory OAuth refresh token failed after retry attempts");
}

function toCredentials(parsed: ParsedTokenResponse, prior?: OAuthCredentials): OAuthCredentials {
  const accountId = organizationIdFromAccessToken(parsed.accessToken);
  const email = parsed.email ?? emailFromAccessToken(parsed.accessToken) ?? prior?.email;
  const expires = parsed.expiresInSeconds
    ? Date.now() + parsed.expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS
    : expiresFromAccessToken(parsed.accessToken) ?? Date.now() + DEFAULT_TOKEN_LIFETIME_MS;

  return {
    refresh: parsed.refreshToken,
    access: parsed.accessToken,
    expires,
    accountId,
    email,
    apiEndpoint: parsed.apiEndpoint ?? prior?.apiEndpoint,
    projectId: prior?.projectId,
  };
}

function requireOrgScopedCredential(credentials: OAuthCredentials, requestedOrganizationId: string): string {
  const payload = decodeJwtPayload(credentials.access);
  const externalOrgId = typeof payload?.external_org_id === "string" ? payload.external_org_id : undefined;
  const workosOrgId = typeof payload?.org_id === "string" ? payload.org_id : undefined;
  const effectiveOrgId = externalOrgId ?? workosOrgId ?? organizationIdFromAccessToken(credentials.access);

  if (!effectiveOrgId) {
    throw new Error("Factory OAuth did not return an organization-scoped access token; LLM calls would 403");
  }

  const isMatch =
    requestedOrganizationId === effectiveOrgId ||
    requestedOrganizationId === workosOrgId ||
    requestedOrganizationId === externalOrgId ||
    (Boolean(externalOrgId) && (requestedOrganizationId.startsWith("org_") || requestedOrganizationId.startsWith("org-")));

  if (!isMatch) {
    throw new Error("Factory OAuth returned a token for a different organization than the selected account");
  }
  return effectiveOrgId;
}

function requireMatchingWhoamiOrganization(accountId: string | undefined, expectedOrganizationId: string): void {
  if (!accountId) {
    throw new Error("Factory whoami response did not include an organization ID");
  }
  if (accountId !== expectedOrganizationId) {
    throw new Error("Factory whoami returned a different organization than the selected account");
  }
}

async function loginWithBrowser(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const fetchImpl = callbacks.fetch ?? fetch;
  const callerSignal = callbacks.signal;

  try {
    const authorization = await requestDeviceAuthorization(fetchImpl, callerSignal);
    callbacks.onAuth({
      url: authorization.verificationUriComplete,
      instructions: `Complete Factory login in your browser. If prompted, enter code ${authorization.userCode}.`,
    });
    callbacks.onProgress?.(`Factory device login code: ${authorization.userCode}`);

    const parsed = await pollDeviceToken(authorization, callbacks, fetchImpl);
    const credentials = toCredentials(parsed);
    const initialFactoryOrgId = organizationIdFromAccessToken(credentials.access);

    if (initialFactoryOrgId) {
      const identity = await resolveWhoami(credentials.access, fetchImpl, initialFactoryOrgId, callerSignal);
      requireMatchingWhoamiOrganization(identity.accountId, initialFactoryOrgId);

      return {
        ...credentials,
        accountId: initialFactoryOrgId,
        apiEndpoint: identity.apiEndpoint ?? credentials.apiEndpoint,
        projectId: initialFactoryOrgId,
      };
    }

    const workosOrganizations = await resolveOrganizationIds(credentials.access, fetchImpl, callerSignal);
    const selectedOrganizationId = await selectOrganizationId(workosOrganizations, callbacks);

    const organizationParsed = await postRefreshToken(
      credentials.refresh,
      fetchImpl,
      credentials.refresh,
      selectedOrganizationId,
      callerSignal,
    );

    const credentialsWithOrg = {
      ...toCredentials(organizationParsed, credentials),
      projectId: selectedOrganizationId,
    };
    requireOrgScopedCredential(credentialsWithOrg, selectedOrganizationId);
    const identity = await resolveWhoami(
      credentialsWithOrg.access,
      fetchImpl,
      selectedOrganizationId,
      callerSignal,
    );
    requireMatchingWhoamiOrganization(identity.accountId, selectedOrganizationId);

    return {
      ...credentialsWithOrg,
      accountId: selectedOrganizationId,
      apiEndpoint: identity.apiEndpoint ?? credentialsWithOrg.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth device login failed: ${formatErrorDetails(error)}`);
  }
}

export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const fetchImpl = callbacks.fetch ?? fetch;
  const callerSignal = callbacks.signal;

  // 1. Check if user is already authenticated via Factory Droid CLI (`droid`)
  // When a custom test fetch is provided (e.g. in mock-driven unit tests), skip local CLI
  // discovery unless explicitly forced, preserving isolated test fixtures.
  const allowLocalCliAuth =
    process.env.FACTORY_DROID_DISABLE_CLI_AUTH !== "1" &&
    (!callbacks.fetch || process.env.FACTORY_DROID_FORCE_CLI_AUTH === "1");

  if (allowLocalCliAuth) {
    try {
      const droidCreds = loadDroidCliCredentials();
      if (droidCreds?.accessToken) {
        const tokenOrgId = droidCreds.activeOrganizationId || organizationIdFromAccessToken(droidCreds.accessToken);
        if (tokenOrgId) {
          const exp = expiresFromAccessToken(droidCreds.accessToken);
          const email = emailFromAccessToken(droidCreds.accessToken);
          const label = email ? `${email} (${tokenOrgId})` : tokenOrgId;

          let reuseLocal = process.env.FACTORY_DROID_FORCE_CLI_AUTH === "1";
          if (!reuseLocal) {
            const promptMessage =
              `Found active Factory Droid CLI login for ${label}.\n` +
              `  1. Reuse local Droid session (${label})\n` +
              `  2. Log in with a different account (browser OAuth)\n` +
              `Select an option [1-2]`;
            const answer = (
              await callbacks.onPrompt({
                message: promptMessage,
                placeholder: "1",
              })
            )?.trim();
            reuseLocal = answer === "1" || answer === "" || answer === undefined;
          }

          if (reuseLocal) {
            const isExpired = exp ? Date.now() >= exp : false;
            if (!isExpired) {
              const identity = await resolveWhoami(droidCreds.accessToken, fetchImpl, tokenOrgId, callerSignal);
              requireMatchingWhoamiOrganization(identity.accountId, tokenOrgId);
              callbacks.onProgress?.(`Reusing authenticated session from Factory Droid CLI (${label})`);
              return {
                refresh: droidCreds.refreshToken,
                access: droidCreds.accessToken,
                expires: exp ?? Date.now() + DEFAULT_TOKEN_LIFETIME_MS,
                accountId: tokenOrgId,
                projectId: tokenOrgId,
                email,
                apiEndpoint: identity.apiEndpoint,
              };
            } else if (droidCreds.refreshToken) {
              callbacks.onProgress?.("Refreshing Factory session from local Droid CLI...");
              const refreshed = await refreshToken(
                {
                  refresh: droidCreds.refreshToken,
                  access: droidCreds.accessToken,
                  expires: 0,
                  accountId: tokenOrgId,
                  projectId: tokenOrgId,
                },
                callerSignal,
                fetchImpl,
              );
              return refreshed;
            }
          }
        }
      }
    } catch {
      // Local Droid CLI credentials unavailable or prompt declined; fall through to browser device login
    }
  }

  return loginWithBrowser(callbacks);
}

const inFlightRefreshes = new Map<string, Promise<OAuthCredentials>>();

export function resetInFlightRefreshesForTests(): void {
  inFlightRefreshes.clear();
}

function waitForRefreshPromise(
  promise: Promise<OAuthCredentials>,
  signal: AbortSignal | undefined,
): Promise<OAuthCredentials> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));

  const pending = Promise.withResolvers<OAuthCredentials>();
  let settled = false;
  const cleanup = () => signal.removeEventListener("abort", onAbort);
  const finish = (creds: OAuthCredentials) => {
    if (settled) return;
    settled = true;
    cleanup();
    pending.resolve(creds);
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    pending.reject(error);
  };
  const onAbort = () => fail(signal.reason ?? new Error("Aborted"));
  signal.addEventListener("abort", onAbort, { once: true });
  void promise.then(finish, fail);
  return pending.promise;
}

async function executeRefreshToken(
  credentials: OAuthCredentials,
  signal?: AbortSignal,
  fetchImpl: Fetcher = fetch,
): Promise<OAuthCredentials> {
  try {
    let workosOrganizationId = credentials.projectId;
    let parsed = await postRefreshToken(
      credentials.refresh,
      fetchImpl,
      credentials.refresh,
      workosOrganizationId,
      signal,
    );
    let refreshed = {
      ...toCredentials(parsed, credentials),
      projectId: workosOrganizationId ?? credentials.projectId,
    };

    let tokenOrganizationId = organizationIdFromAccessToken(refreshed.access);
    const payload = decodeJwtPayload(refreshed.access);
    if (tokenOrganizationId && workosOrganizationId) {
      const isMatch =
        tokenOrganizationId === workosOrganizationId ||
        payload?.org_id === workosOrganizationId ||
        payload?.external_org_id === workosOrganizationId;
      if (!isMatch && !workosOrganizationId.startsWith("org_") && !workosOrganizationId.startsWith("org-")) {
        throw new Error("Factory OAuth refresh returned a token for a different organization than the stored account");
      }
    }
    workosOrganizationId = workosOrganizationId ?? tokenOrganizationId;

    if (!tokenOrganizationId) {
      if (!workosOrganizationId) {
        const orgs = await resolveOrganizationIds(refreshed.access, fetchImpl, signal);
        if (orgs.length === 1) {
          workosOrganizationId = orgs[0];
        } else if (orgs.length > 1) {
          throw new Error(
            "Factory OAuth refresh encountered multiple organizations without a stored projectId; run `/logout factory` and `/login factory` to select an organization",
          );
        } else {
          throw new Error("Factory OAuth refresh did not expose an organization id; run `/logout factory` and `/login factory`");
        }
      }

      parsed = await postRefreshToken(
        refreshed.refresh,
        fetchImpl,
        refreshed.refresh,
        workosOrganizationId,
        signal,
      );
      refreshed = {
        ...toCredentials(parsed, { ...credentials, ...refreshed, projectId: workosOrganizationId }),
        projectId: workosOrganizationId,
      };
      tokenOrganizationId = requireOrgScopedCredential(refreshed, workosOrganizationId);
    }

    if (!tokenOrganizationId) {
      throw new Error("Factory OAuth refresh did not produce an organization-scoped token");
    }
    const identity = await resolveWhoami(refreshed.access, fetchImpl, tokenOrganizationId, signal);
    requireMatchingWhoamiOrganization(identity.accountId, tokenOrganizationId);

    return {
      ...refreshed,
      accountId: tokenOrganizationId,
      projectId: workosOrganizationId ?? tokenOrganizationId,
      apiEndpoint: identity.apiEndpoint ?? refreshed.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth token refresh failed: ${formatErrorDetails(error)}`);
  }
}

export async function refreshToken(
  credentials: OAuthCredentials,
  signal?: AbortSignal,
  fetchImpl: Fetcher = fetch,
): Promise<OAuthCredentials> {
  const refreshKey = `${credentials.accountId ?? ""}:${credentials.refresh}`;
  const existing = inFlightRefreshes.get(refreshKey);
  if (existing) {
    return waitForRefreshPromise(existing, signal);
  }

  let refreshPromise!: Promise<OAuthCredentials>;
  refreshPromise = (async () => {
    try {
      return await executeRefreshToken(credentials, signal, fetchImpl);
    } finally {
      if (inFlightRefreshes.get(refreshKey) === refreshPromise) {
        inFlightRefreshes.delete(refreshKey);
      }
    }
  })();

  inFlightRefreshes.set(refreshKey, refreshPromise);
  return waitForRefreshPromise(refreshPromise, signal);
}

export function getApiKey(credentials: OAuthCredentials): string {
  return JSON.stringify({
    token: credentials.access,
    orgId: credentials.accountId ?? null,
    apiEndpoint: credentials.apiEndpoint ?? null,
  });
}
