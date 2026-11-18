import { describe, expect, test } from "bun:test";

import { identityFromWhoami } from "./auth-parsing";
import { upstreamProviderFor } from "./catalog";
import { factoryApiForRegion } from "./constants";
import { parseFactoryCredential } from "./credential";

// Droid 1.14.0 reads the inference region as
//   e?.inferenceRegion ?? lsH(e?.region ?? "global")
// where an explicit inferenceRegion wins and only an eu region infers in the EU.
describe("inference region follows Droid 1.14.0", () => {
  test("whoami inferenceRegion wins over region", () => {
    expect(identityFromWhoami({ orgId: "o", region: "global", inferenceRegion: "us" }).inferenceRegion).toBe("us");
    expect(identityFromWhoami({ orgId: "o", region: "eu", inferenceRegion: "eu" }).inferenceRegion).toBe("eu");
    expect(identityFromWhoami({ orgId: "o", region: "global", inferenceRegion: "in" }).inferenceRegion).toBe("in");
    expect(identityFromWhoami({ orgId: "o", region: "eu", inferenceRegion: "in" }).inferenceRegion).toBe("in");
  });

  test("without inferenceRegion an eu org infers in eu and others in global", () => {
    expect(identityFromWhoami({ orgId: "o", region: "eu" }).inferenceRegion).toBe("eu");
    expect(identityFromWhoami({ orgId: "o", region: "global" }).inferenceRegion).toBe("global");
    expect(identityFromWhoami({ orgId: "o" }).inferenceRegion).toBe("global");
  });

  test("an unknown inferenceRegion reads as absent", () => {
    expect(identityFromWhoami({ orgId: "o", region: "eu", inferenceRegion: "mars" }).inferenceRegion).toBe("eu");
  });

  test("the credential carries the region, or takes it from the EU endpoint", () => {
    const envelope = (fields: Record<string, unknown>) => parseFactoryCredential(JSON.stringify({ token: "t", ...fields }));
    expect(envelope({ inferenceRegion: "us" }).inferenceRegion).toBe("us");
    expect(envelope({ inferenceRegion: "in" }).inferenceRegion).toBe("in");
    expect(envelope({ apiEndpoint: "https://api.eu.factory.ai" }).inferenceRegion).toBe("eu");
    expect(envelope({ apiEndpoint: "https://api.factory.ai" }).inferenceRegion).toBe("global");
    expect(parseFactoryCredential("raw-token").inferenceRegion).toBe("global");
  });

  test("hosted API uses the global host except in the EU", () => {
    expect(factoryApiForRegion(undefined)).toBe("https://api.factory.ai");
    expect(factoryApiForRegion("global")).toBe("https://api.factory.ai");
    expect(factoryApiForRegion("eu")).toBe("https://api.eu.factory.ai");
    for (const region of ["in", "us", "us-east", "apac", "europe"]) {
      expect(factoryApiForRegion(region)).toBe("https://api.factory.ai");
    }
  });

  test("an explicit Factory endpoint still wins over the region label", () => {
    expect(factoryApiForRegion("https://api.eu.factory.ai")).toBe("https://api.eu.factory.ai");
    expect(factoryApiForRegion("https://api.factory.ai")).toBe("https://api.factory.ai");
    expect(() => factoryApiForRegion("evil.example")).toThrow();
    expect(() => factoryApiForRegion("https://evil.example")).toThrow();
  });

  test("GLM 5.2 and GLM 5.3 go to Mistral in the EU", () => {
    expect(upstreamProviderFor("glm-5.2", "eu")).toBe("mistral");
    expect(upstreamProviderFor("glm-5.3", "eu")).toBe("mistral");
    expect(upstreamProviderFor("glm-5.3", "us")).toBe("baseten");
    expect(upstreamProviderFor("nemotron-3-ultra", "eu")).toBeUndefined();
  });
});
