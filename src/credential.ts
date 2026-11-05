import type { DroidRegion } from "./droid-registry";
import { firstStringField, isRecord, stringField } from "./object-fields";

const ORGANIZATION_ID_CLAIMS = [
  "external_org_id",
  "org_id",
  "organization_id",
  "organizationId",
  "orgId",
] as const;

export type FactoryCredentialSource = "missing" | "invalid" | "oauth-envelope" | "raw";

export interface ParsedFactoryCredential {
  source: FactoryCredentialSource;
  access?: string;
  orgId: string | null;
  apiEndpoint: string | null;
  inferenceRegion: DroidRegion;
}

const INFERENCE_REGIONS: readonly string[] = ["global", "eu", "us"] satisfies DroidRegion[];
const EU_API_HOST = "api.eu.factory.ai";

// Droid 1.3.0 picks the region that serves model inference as
//   e?.inferenceRegion ?? cd(e?.region ?? "global", void 0)
// An unknown inferenceRegion reads as absent, and cd sends an eu org to eu
// and every other org to global.
export function inferenceRegionOf(inferenceRegion: unknown, region: string | undefined): DroidRegion {
  if (typeof inferenceRegion === "string" && INFERENCE_REGIONS.includes(inferenceRegion)) {
    return inferenceRegion as DroidRegion;
  }
  return region === "eu" ? "eu" : "global";
}

function regionOfEndpoint(apiEndpoint: string | undefined): string | undefined {
  if (!apiEndpoint) return undefined;
  try {
    return new URL(apiEndpoint).hostname.toLowerCase() === EU_API_HOST ? "eu" : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64UrlBinary(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return atob(paddedBase64);
}

function decodeBase64UrlUtf8(segment: string): string {
  const binary = decodeBase64UrlBinary(segment);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseJwtPayload(
  accessToken: string,
  decodeSegment: (segment: string) => string,
): Record<string, unknown> | null {
  const [, payloadSegment] = accessToken.split(".");
  if (!payloadSegment) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(decodeSegment(payloadSegment));
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

export function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  return parseJwtPayload(accessToken, decodeBase64UrlUtf8);
}

export function organizationIdFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  return payload ? firstStringField(payload, ORGANIZATION_ID_CLAIMS) : undefined;
}

function organizationIdFromCredentialToken(accessToken: string): string | undefined {
  const payload = parseJwtPayload(accessToken, decodeBase64UrlBinary);
  return payload ? firstStringField(payload, ORGANIZATION_ID_CLAIMS) : undefined;
}

function rawFactoryCredential(access: string): ParsedFactoryCredential {
  return {
    source: "raw",
    access,
    orgId: organizationIdFromCredentialToken(access) ?? null,
    apiEndpoint: null,
    inferenceRegion: "global",
  };
}

export function parseFactoryCredential(raw: string | undefined): ParsedFactoryCredential {
  if (!raw || raw.trim().length === 0) {
    return { source: "missing", orgId: null, apiEndpoint: null, inferenceRegion: "global" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (!isRecord(parsed)) {
    return rawFactoryCredential(raw);
  }

  const access = stringField(parsed, "token");
  if (!access) {
    return { source: "invalid", orgId: null, apiEndpoint: null, inferenceRegion: "global" };
  }

  // Credentials saved before the region was stored still name the EU endpoint.
  const apiEndpoint = stringField(parsed, "apiEndpoint");
  return {
    source: "oauth-envelope",
    access,
    orgId: stringField(parsed, "orgId") ?? organizationIdFromCredentialToken(access) ?? null,
    apiEndpoint: apiEndpoint ?? null,
    inferenceRegion: inferenceRegionOf(parsed.inferenceRegion, regionOfEndpoint(apiEndpoint)),
  };
}
