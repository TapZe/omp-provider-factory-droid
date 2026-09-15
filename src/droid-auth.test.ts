import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "bun:test";

import {
  decryptPayload,
  encryptPayload,
  loadDroidCliCredentials,
  saveDroidCliCredentials,
} from "./droid-auth";

describe("Factory Droid local CLI storage & encryption", () => {
  const testKey = crypto.randomBytes(32);

  test("encrypts and decrypts payload via AES-256-GCM roundtrip", () => {
    const payload = {
      access_token: "test-access-token-xyz",
      refresh_token: "test-refresh-token-123",
      active_organization_id: "org-test-456",
    };

    const encrypted = encryptPayload(payload, testKey);
    expect(typeof encrypted).toBe("string");
    expect(encrypted!.split(":")).toHaveLength(3);

    const decrypted = decryptPayload(encrypted!, testKey);
    expect(decrypted).toEqual(payload);
  });

  test("returns null when decrypting invalid or tampered ciphertext", () => {
    expect(decryptPayload("", testKey)).toBeNull();
    expect(decryptPayload("invalid", testKey)).toBeNull();
    expect(decryptPayload("part1:part2", testKey)).toBeNull();
    expect(decryptPayload("part1:part2:part3:part4", testKey)).toBeNull();

    // Tampered auth tag
    const payload = { access_token: "tok", refresh_token: "ref" };
    const encrypted = encryptPayload(payload, testKey)!;
    const parts = encrypted.split(":");
    const badTag = Buffer.from(parts[1], "base64");
    badTag[0] ^= 0xff;
    const tampered = `${parts[0]}:${badTag.toString("base64")}:${parts[2]}`;
    expect(decryptPayload(tampered, testKey)).toBeNull();

    // Wrong key
    const wrongKey = crypto.randomBytes(32);
    expect(decryptPayload(encrypted, wrongKey)).toBeNull();
  });

  test("validates input to saveDroidCliCredentials", () => {
    expect(saveDroidCliCredentials(null)).toBe(false);
    expect(saveDroidCliCredentials(undefined)).toBe(false);
    expect(saveDroidCliCredentials({} as any)).toBe(false);
    expect(saveDroidCliCredentials({ accessToken: "", refreshToken: "" })).toBe(false);
    expect(saveDroidCliCredentials({ accessToken: "access", refreshToken: "" })).toBe(false);
    expect(saveDroidCliCredentials({ accessToken: "", refreshToken: "refresh" })).toBe(false);
  });

  test("loadDroidCliCredentials returns null or valid credential object safely", () => {
    const loaded = loadDroidCliCredentials();
    if (loaded !== null) {
      expect(typeof loaded.accessToken).toBe("string");
      expect(typeof loaded.refreshToken).toBe("string");
    } else {
      expect(loaded).toBeNull();
    }
  });
});
