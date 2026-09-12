import { describe, expect, test } from "bun:test";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai/oauth/types";

import { login, refreshToken, resetInFlightRefreshesForTests } from "./auth";
import { formatErrorDetails, parseUniqueOrganizationIds, readJsonResponse } from "./auth-parsing";
import { factoryApiForRegion, validateHostedFactoryApiOrigin } from "./constants";

type OAuthFetch = NonNullable<OAuthLoginCallbacks["fetch"]>;

function unsignedJwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const EXPIRED_CREDENTIAL: OAuthCredentials = {
  refresh: "original-refresh",
  access: "original-access",
  expires: 1,
  accountId: "org_saved",
  projectId: "org_saved",
  apiEndpoint: "https://api.factory.ai",
};

async function loginWithWhoamiResponse(whoamiResponse: Response): Promise<OAuthCredentials> {
  const scopedToken = unsignedJwt({ org_id: "org_verified" });
  const fetchImpl: OAuthFetch = async (input) => {
    const url = String(input);
    if (url.includes("authorize/device")) {
      return jsonResponse({
        device_code: "device-code",
        user_code: "ABCD-1234",
        verification_uri: "https://factory.ai/verify",
        verification_uri_complete: "https://factory.ai/verify?code=ABCD-1234",
        expires_in: 300,
        interval: 0.001,
      });
    }
    if (url.includes("authenticate")) {
      return jsonResponse({ access_token: scopedToken, refresh_token: "refresh-token", expires_in: 3_600 });
    }
    if (url.endsWith("/api/cli/whoami")) return whoamiResponse;
    return new Response("Not Found", { status: 404 });
  };
  return login({ fetch: fetchImpl, onAuth() {}, async onPrompt() { return "1"; } });
}

describe("Factory hosted endpoint validation", () => {
  test("accepts canonical Factory origins and region labels", () => {
    expect(validateHostedFactoryApiOrigin("https://api.factory.ai")).toBe("https://api.factory.ai");
    expect(validateHostedFactoryApiOrigin("https://api.eu.factory.ai/")).toBe("https://api.eu.factory.ai");
    expect(factoryApiForRegion(undefined)).toBe("https://api.factory.ai");
    expect(factoryApiForRegion("global")).toBe("https://api.factory.ai");
    expect(factoryApiForRegion("eu")).toBe("https://api.eu.factory.ai");
    expect(factoryApiForRegion("us-east")).toBe("https://api.us-east.factory.ai");
  });

  test("rejects endpoints that could exfiltrate a selected bearer", () => {
    const rejected = [
      "http://api.factory.ai",
      "https://api.factory.ai.evil.example",
      "https://user:pass@api.factory.ai",
      "https://api.factory.ai:8443",
      "https://api.factory.ai/v1",
      "https://api.factory.ai?query=1",
      "https://api.factory.ai#fragment",
    ];
    for (const endpoint of rejected) expect(() => validateHostedFactoryApiOrigin(endpoint)).toThrow();
    expect(() => factoryApiForRegion("evil.example")).toThrow();
    expect(() => factoryApiForRegion("https://evil.example")).toThrow();
  });
});

describe("Factory organization selection", () => {
  test("parses every unique non-empty organization in response order", () => {
    expect(
      parseUniqueOrganizationIds({
        workosOrgIds: ["org_1", "org_2", "org_1", "", "   ", "org_3", 123, null],
      }),
    ).toEqual(["org_1", "org_2", "org_3"]);
    expect(parseUniqueOrganizationIds({})).toEqual([]);
  });

  test("prompts for multiple organizations and persists the selected organization", async () => {
    const unscopedToken = unsignedJwt({ sub: "user_123" });
    const scopedToken = unsignedJwt({ org_id: "org_selected_2" });
    const fetchImpl: OAuthFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("authorize/device")) {
        return jsonResponse({
          device_code: "device-code",
          user_code: "ABCD-1234",
          verification_uri: "https://factory.ai/verify",
          verification_uri_complete: "https://factory.ai/verify?code=ABCD-1234",
          expires_in: 300,
          interval: 0.001,
        });
      }
      if (url.includes("authenticate")) {
        const grantType = new URLSearchParams(String(init?.body)).get("grant_type");
        return grantType === "refresh_token"
          ? jsonResponse({ access_token: scopedToken, refresh_token: "scoped-refresh", expires_in: 3_600 })
          : jsonResponse({ access_token: unscopedToken, refresh_token: "initial-refresh", expires_in: 3_600 });
      }
      if (url.endsWith("/api/cli/org")) {
        return jsonResponse({ workosOrgIds: ["org_option_1", "org_selected_2"] });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: "org_selected_2", region: "eu" });
      }
      return new Response("Not Found", { status: 404 });
    };
    const prompts: string[] = [];

    const credentials = await login({
      fetch: fetchImpl,
      onAuth() {},
      async onPrompt(prompt) {
        prompts.push(prompt.message);
        return "2";
      },
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("1. org_option_1");
    expect(prompts[0]).toContain("2. org_selected_2");
    expect(credentials.accountId).toBe("org_selected_2");
    expect(credentials.projectId).toBe("org_selected_2");
    expect(credentials.apiEndpoint).toBe("https://api.eu.factory.ai");
  });

  test("requires whoami to confirm the token organization", async () => {
    await expect(loginWithWhoamiResponse(jsonResponse({ error: "unavailable" }, 503))).rejects.toThrow(
      /whoami request failed.*status=503/,
    );
    await expect(loginWithWhoamiResponse(jsonResponse({ region: "eu" }))).rejects.toThrow(
      /whoami response did not include an organization ID/,
    );
    await expect(loginWithWhoamiResponse(jsonResponse({ orgId: "org_other", region: "eu" }))).rejects.toThrow(
      /whoami returned a different organization/,
    );
  });

  test("refuses to guess during legacy refresh when multiple organizations exist", async () => {
    const unscopedToken = unsignedJwt({ sub: "user_legacy" });
    const fetchImpl: OAuthFetch = async (input) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        return jsonResponse({ access_token: unscopedToken, refresh_token: "new-refresh", expires_in: 3_600 });
      }
      if (url.endsWith("/api/cli/org")) return jsonResponse({ workosOrgIds: ["org_a", "org_b"] });
      return new Response("Not Found", { status: 404 });
    };

    await expect(
      refreshToken({ refresh: "old-refresh", access: unscopedToken, expires: 1 }, undefined, fetchImpl),
    ).rejects.toThrow(/multiple organizations.*\/login factory/);
  });
});

describe("Factory OAuth error handling", () => {
  test("bounds response bodies and exposes only allowlisted upstream error codes", async () => {
    const secret = "refresh-secret-that-must-not-leak";
    let message = "";
    try {
      await readJsonResponse(jsonResponse({ error: "invalid_grant", refresh_token: secret }, 400), "refresh token");
    } catch (error) {
      message = formatErrorDetails(error);
    }

    expect(message).toContain("status=400; code=invalid_grant");
    expect(message).not.toContain(secret);
    await expect(
      readJsonResponse(new Response("x".repeat(65_537), { status: 500 }), "oversized"),
    ).rejects.toThrow(/exceeded 65536 bytes/);
  });

  test("redacts token-shaped values from nested error text", () => {
    const details = formatErrorDetails(
      new Error("access_token=secret-access refresh-token: secret-refresh Bearer secret-bearer"),
    );
    expect(details).not.toContain("secret-access");
    expect(details).not.toContain("secret-refresh");
    expect(details).not.toContain("secret-bearer");
  });
});

describe("Factory OAuth cancellation", () => {
  test("threads caller cancellation into refresh requests", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const fetchImpl: OAuthFetch = async (_input, init) => {
      requestSignal = init?.signal;
      const pending = Promise.withResolvers<Response>();
      const signal = init?.signal;
      if (!signal) pending.reject(new Error("missing signal"));
      else if (signal.aborted) pending.reject(signal.reason);
      else signal.addEventListener("abort", () => pending.reject(signal.reason), { once: true });
      return pending.promise;
    };

    const pending = refreshToken(EXPIRED_CREDENTIAL, controller.signal, fetchImpl);
    controller.abort(new Error("caller cancelled refresh"));

    await expect(pending).rejects.toThrow(/caller cancelled refresh/);
    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe("Factory WorkOS refresh organization handling", () => {
  test("omits Factory external org ID from WorkOS body to prevent organization_not_found error", async () => {
    let capturedBody: URLSearchParams | undefined;
    const factoryOrgId = "RFmWaCAuH8jTGM21tL5k";
    const scopedToken = unsignedJwt({ external_org_id: factoryOrgId, exp: Math.floor(Date.now() / 1000) + 3600 });

    const fetchImpl: OAuthFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        capturedBody = new URLSearchParams(String(init?.body));
        return jsonResponse({
          access_token: scopedToken,
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: factoryOrgId, region: "global" });
      }
      return new Response("Not Found", { status: 404 });
    };

    const creds: OAuthCredentials = {
      refresh: "old-refresh",
      access: scopedToken,
      expires: 1,
      accountId: factoryOrgId,
      projectId: factoryOrgId,
      apiEndpoint: "https://api.factory.ai",
    };

    const refreshed = await refreshToken(creds, undefined, fetchImpl);
    expect(capturedBody).toBeDefined();
    expect(capturedBody?.get("grant_type")).toBe("refresh_token");
    expect(capturedBody?.get("refresh_token")).toBe("old-refresh");
    // Crucial: organization_id must NOT be passed when it is a Factory external org ID
    expect(capturedBody?.has("organization_id")).toBe(false);
    expect(refreshed.accountId).toBe(factoryOrgId);
  });

  test("passes WorkOS org ID when projectId starts with org_ or org-", async () => {
    let capturedBody: URLSearchParams | undefined;
    const workosOrgId = "org_01KFW5N9T2CN9QZBHSRSJHX469";
    const scopedToken = unsignedJwt({ org_id: workosOrgId, exp: Math.floor(Date.now() / 1000) + 3600 });

    const fetchImpl: OAuthFetch = async (input, init) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        capturedBody = new URLSearchParams(String(init?.body));
        return jsonResponse({
          access_token: scopedToken,
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: workosOrgId, region: "global" });
      }
      return new Response("Not Found", { status: 404 });
    };

    const creds: OAuthCredentials = {
      refresh: "old-refresh",
      access: scopedToken,
      expires: 1,
      accountId: workosOrgId,
      projectId: workosOrgId,
      apiEndpoint: "https://api.factory.ai",
    };

    const refreshed = await refreshToken(creds, undefined, fetchImpl);
    expect(capturedBody?.get("organization_id")).toBe(workosOrgId);
    expect(refreshed.accountId).toBe(workosOrgId);
  });

  test("accepts tokens containing both external_org_id and org_id when refreshed by WorkOS org ID", async () => {
    const factoryOrgId = "RFmWaCAuH8jTGM21tL5k";
    const workosOrgId = "org_01KFW5N9T2CN9QZBHSRSJHX469";
    const dualToken = unsignedJwt({
      external_org_id: factoryOrgId,
      org_id: workosOrgId,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const fetchImpl: OAuthFetch = async (input) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        return jsonResponse({
          access_token: dualToken,
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: factoryOrgId, region: "global" });
      }
      return new Response("Not Found", { status: 404 });
    };

    const creds: OAuthCredentials = {
      refresh: "old-refresh",
      access: dualToken,
      expires: 1,
      accountId: factoryOrgId,
      projectId: workosOrgId,
      apiEndpoint: "https://api.factory.ai",
    };

    const refreshed = await refreshToken(creds, undefined, fetchImpl);
    expect(refreshed.accountId).toBe(factoryOrgId);
  });
});

describe("Factory OAuth refresh reliability & concurrency", () => {
  test("coalesces concurrent refresh calls into a single WorkOS request", async () => {
    resetInFlightRefreshesForTests();
    let authCalls = 0;
    const factoryOrgId = "RFmWaCAuH8jTGM21tL5k";
    const scopedToken = unsignedJwt({ external_org_id: factoryOrgId, exp: Math.floor(Date.now() / 1000) + 3600 });

    const fetchImpl: OAuthFetch = async (input) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        authCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse({
          access_token: scopedToken,
          refresh_token: "coalesced-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: factoryOrgId, region: "global" });
      }
      return new Response("Not Found", { status: 404 });
    };

    const creds: OAuthCredentials = {
      refresh: "shared-refresh-token",
      access: scopedToken,
      expires: 1,
      accountId: factoryOrgId,
      projectId: factoryOrgId,
      apiEndpoint: "https://api.factory.ai",
    };

    const [res1, res2, res3] = await Promise.all([
      refreshToken(creds, undefined, fetchImpl),
      refreshToken(creds, undefined, fetchImpl),
      refreshToken(creds, undefined, fetchImpl),
    ]);

    expect(authCalls).toBe(1);
    expect(res1.refresh).toBe("coalesced-refresh-token");
    expect(res2.refresh).toBe("coalesced-refresh-token");
    expect(res3.refresh).toBe("coalesced-refresh-token");
  });

  test("retries transient 500 error and succeeds on subsequent attempt", async () => {
    resetInFlightRefreshesForTests();
    let attempts = 0;
    const factoryOrgId = "RFmWaCAuH8jTGM21tL5k";
    const scopedToken = unsignedJwt({ external_org_id: factoryOrgId, exp: Math.floor(Date.now() / 1000) + 3600 });

    const fetchImpl: OAuthFetch = async (input) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        attempts++;
        if (attempts === 1) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return jsonResponse({
          access_token: scopedToken,
          refresh_token: "retry-refresh-token",
          expires_in: 3600,
        });
      }
      if (url.endsWith("/api/cli/whoami")) {
        return jsonResponse({ orgId: factoryOrgId, region: "global" });
      }
      return new Response("Not Found", { status: 404 });
    };

    const creds: OAuthCredentials = {
      refresh: "retry-test-refresh",
      access: scopedToken,
      expires: 1,
      accountId: factoryOrgId,
      projectId: factoryOrgId,
      apiEndpoint: "https://api.factory.ai",
    };

    const refreshed = await refreshToken(creds, undefined, fetchImpl);
    expect(attempts).toBe(2);
    expect(refreshed.refresh).toBe("retry-refresh-token");
  });

  test("fails fast without retry on permanent 400 invalid_grant", async () => {
    resetInFlightRefreshesForTests();
    let attempts = 0;
    const factoryOrgId = "RFmWaCAuH8jTGM21tL5k";

    const fetchImpl: OAuthFetch = async (input) => {
      const url = String(input);
      if (url.includes("authenticate")) {
        attempts++;
        return jsonResponse(
          { error: "invalid_grant", error_description: "The refresh token is invalid or revoked" },
          400,
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const creds: OAuthCredentials = {
      refresh: "revoked-refresh",
      access: "expired-token",
      expires: 1,
      accountId: factoryOrgId,
      projectId: factoryOrgId,
      apiEndpoint: "https://api.factory.ai",
    };

    await expect(refreshToken(creds, undefined, fetchImpl)).rejects.toThrow(/invalid_grant/);
    expect(attempts).toBe(1);
  });
});

describe("Factory login interactive Droid CLI selection", () => {
  test("falls through to browser login when user chooses option 2", async () => {
    const origForce = process.env.FACTORY_DROID_FORCE_CLI_AUTH;
    process.env.FACTORY_DROID_FORCE_CLI_AUTH = "0"; // allow prompt
    try {
      let browserFlowStarted = false;
      const browserToken = unsignedJwt({ org_id: "org_browser_user", exp: Math.floor(Date.now() / 1000) + 3600 });
      const fetchImpl: OAuthFetch = async (input) => {
        const url = String(input);
        if (url.includes("authorize/device")) {
          browserFlowStarted = true;
          return jsonResponse({
            device_code: "device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://factory.ai/verify",
            verification_uri_complete: "https://factory.ai/verify?code=ABCD-1234",
            expires_in: 300,
            interval: 0.001,
          });
        }
        if (url.includes("authenticate")) {
          return jsonResponse({ access_token: browserToken, refresh_token: "browser-refresh", expires_in: 3600 });
        }
        if (url.endsWith("/api/cli/whoami")) {
          return jsonResponse({ orgId: "org_browser_user", region: "global" });
        }
        return new Response("Not Found", { status: 404 });
      };

      // Prompt answers "2" to indicate user wants browser login
      const creds = await login({
        fetch: fetchImpl,
        onAuth() {},
        async onPrompt(prompt) {
          if (prompt.message.includes("Found active Factory Droid CLI login")) {
            return "2";
          }
          return "1";
        },
      });

      expect(browserFlowStarted).toBe(true);
      expect(creds.accountId).toBe("org_browser_user");
    } finally {
      if (origForce !== undefined) {
        process.env.FACTORY_DROID_FORCE_CLI_AUTH = origForce;
      } else {
        delete process.env.FACTORY_DROID_FORCE_CLI_AUTH;
      }
    }
  });
});



