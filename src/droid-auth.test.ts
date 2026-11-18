import * as crypto from "node:crypto";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";

import type { DroidCliCredentials } from "./droid-auth";

interface KeychainCall {
  file: string;
  args: readonly string[];
}

interface WriteCall {
  path: string;
  data: string;
  mode: number | undefined;
}

const keychainCalls: KeychainCall[] = [];
const readCalls: string[] = [];
const writeCalls: WriteCall[] = [];
const virtualFiles = new Map<string, string>();
let keychainStdout = "";
let keychainFailure: Error | null = null;

// Copy the real exports before the mocks replace these modules, so every other
// child_process and fs export stays available to the code under test.
const realChildProcess = { ...(await import("node:child_process")) };
const realFs = { ...(await import("node:fs")) };

const execFileSyncMock = mock((file: string, args: readonly string[]) => {
  keychainCalls.push({ file, args });
  if (keychainFailure) throw keychainFailure;
  return keychainStdout;
});

// droid-auth reads the Keychain through execFileSync and its storage through fs,
// so both modules are mocked before it loads; the dynamic import is what puts
// the mock first. fs stays in memory, so no real credential file is read or
// written, and afterAll puts the real exports back.
mock.module("node:child_process", () => ({
  ...realChildProcess,
  execFileSync: execFileSyncMock,
}));
mock.module("node:fs", () => ({
  ...realFs,
  existsSync: mock((file: string) => virtualFiles.has(file)),
  readFileSync: mock((file: string) => {
    readCalls.push(file);
    const content = virtualFiles.get(file);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${file}'`);
    }
    return content;
  }),
  writeFileSync: mock((file: string, data: string, options?: { mode?: number }) => {
    virtualFiles.set(file, data);
    writeCalls.push({ path: file, data, mode: options?.mode });
  }),
}));

const {
  FILE_STORAGE_PATH,
  KEYFILE_PATH,
  LOGIN_KEYCHAIN_PATH,
  decryptPayload,
  encryptPayload,
  loadDroidCliCredentials,
  readKeychainKey,
  saveDroidCliCredentials,
} = await import("./droid-auth");

const CREDENTIAL_STORAGE_PATHS = new Set([LOGIN_KEYCHAIN_PATH, FILE_STORAGE_PATH, KEYFILE_PATH]);

// Put the real modules back once this file ends, so the mocks never outlive the
// tests that install them for anything else sharing the process.
afterAll(() => {
  mock.module("node:child_process", () => realChildProcess);
  mock.module("node:fs", () => realFs);
});

describe("Factory Droid local CLI storage & encryption", () => {
  const testKey = crypto.randomBytes(32);
  const keychainFixture = {
    access_token: "synthetic-keychain-access",
    refresh_token: "synthetic-keychain-refresh",
    active_organization_id: "org_synthetic_keychain",
  };
  const fileFixture = {
    access_token: "synthetic-file-access",
    refresh_token: "synthetic-file-refresh",
    active_organization_id: "org_synthetic_file",
  };

  afterEach(() => {
    keychainCalls.length = 0;
    readCalls.length = 0;
    writeCalls.length = 0;
    virtualFiles.clear();
    keychainStdout = "";
    keychainFailure = null;
  });

  function storeEncrypted(path: string, payload: Record<string, unknown>, key: Buffer): void {
    const encrypted = encryptPayload(payload, key);
    if (!encrypted) throw new Error(`fixture encryption failed for ${path}`);
    virtualFiles.set(path, encrypted);
  }

  function storeKey(path: string, key: Buffer): void {
    virtualFiles.set(path, key.toString("base64"));
  }

  function simulatePlatform<T>(platform: string, run: () => T): T {
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: platform, configurable: true, writable: true });
    try {
      return run();
    } finally {
      if (descriptor) Object.defineProperty(process, "platform", descriptor);
    }
  }

  // Every path the module asks for must be one of its own credential stores;
  // the in-memory fs keeps even those reads away from the real filesystem.
  function expectOnlyCredentialStorageTouched(): void {
    for (const path of readCalls) expect(CREDENTIAL_STORAGE_PATHS.has(path)).toBe(true);
    for (const call of writeCalls) expect(CREDENTIAL_STORAGE_PATHS.has(call.path)).toBe(true);
  }

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

  test("rejects unusable credentials without touching storage", () => {
    expect(saveDroidCliCredentials(null)).toBe(false);
    expect(saveDroidCliCredentials(undefined)).toBe(false);
    // An empty object stands in for a caller that bypassed the type boundary.
    expect(saveDroidCliCredentials({} as DroidCliCredentials)).toBe(false);
    expect(saveDroidCliCredentials({ accessToken: "", refreshToken: "" })).toBe(false);
    expect(saveDroidCliCredentials({ accessToken: "access", refreshToken: "" })).toBe(false);
    expect(saveDroidCliCredentials({ accessToken: "", refreshToken: "refresh" })).toBe(false);
    expect(readCalls).toEqual([]);
    expect(writeCalls).toEqual([]);
    expect(keychainCalls).toEqual([]);
  });

  test("reads the encryption key from the Factory CLI Keychain account", () => {
    keychainStdout = `${testKey.toString("base64")}\n`;

    const key = simulatePlatform("darwin", readKeychainKey);

    expect(key?.toString("base64")).toBe(testKey.toString("base64"));
    expect(keychainCalls).toHaveLength(1);
    expect(keychainCalls[0].file).toBe("/usr/bin/security");
    expect([...keychainCalls[0].args]).toEqual([
      "find-generic-password",
      "-s",
      "Factory CLI",
      "-a",
      "auth-encryption-key",
      "-w",
    ]);
  });

  test("omits the Keychain lookup off macOS and when it fails", () => {
    expect(simulatePlatform("linux", readKeychainKey)).toBeNull();
    expect(keychainCalls).toHaveLength(0);

    keychainFailure = new Error("The specified item could not be found in the keychain.");
    try {
      expect(simulatePlatform("darwin", readKeychainKey)).toBeNull();
    } finally {
      keychainFailure = null;
    }
    expect(keychainCalls).toHaveLength(1);
  });

  test("decrypts synthetic credentials from the Keychain-backed login file", () => {
    keychainStdout = `${testKey.toString("base64")}\n`;
    storeEncrypted(LOGIN_KEYCHAIN_PATH, keychainFixture, testKey);

    const loaded = simulatePlatform("darwin", loadDroidCliCredentials);

    expect(loaded).toEqual({
      accessToken: keychainFixture.access_token,
      refreshToken: keychainFixture.refresh_token,
      activeOrganizationId: keychainFixture.active_organization_id,
    });
    expect(readCalls).toEqual([LOGIN_KEYCHAIN_PATH]);
    expectOnlyCredentialStorageTouched();
  });

  test("falls back to the file-backed key when the Keychain has no key", () => {
    keychainFailure = new Error("The specified item could not be found in the keychain.");
    storeKey(KEYFILE_PATH, testKey);
    storeEncrypted(FILE_STORAGE_PATH, fileFixture, testKey);

    const loaded = simulatePlatform("darwin", loadDroidCliCredentials);

    expect(loaded).toEqual({
      accessToken: fileFixture.access_token,
      refreshToken: fileFixture.refresh_token,
      activeOrganizationId: fileFixture.active_organization_id,
    });
    expect(readCalls).toEqual([KEYFILE_PATH, FILE_STORAGE_PATH]);
    expectOnlyCredentialStorageTouched();
  });

  test("reads the login-keychain file with the file-backed key when auth.v2.file is absent", () => {
    keychainFailure = new Error("The specified item could not be found in the keychain.");
    storeKey(KEYFILE_PATH, testKey);
    storeEncrypted(LOGIN_KEYCHAIN_PATH, keychainFixture, testKey);

    const loaded = simulatePlatform("darwin", loadDroidCliCredentials);

    expect(loaded).toEqual({
      accessToken: keychainFixture.access_token,
      refreshToken: keychainFixture.refresh_token,
      activeOrganizationId: keychainFixture.active_organization_id,
    });
    expect(readCalls).toEqual([KEYFILE_PATH, LOGIN_KEYCHAIN_PATH]);
    expectOnlyCredentialStorageTouched();
  });

  test("returns null when no local Droid CLI storage exists", () => {
    keychainFailure = new Error("The specified item could not be found in the keychain.");

    expect(simulatePlatform("darwin", loadDroidCliCredentials)).toBeNull();
    expect(readCalls).toEqual([]);
    expect(writeCalls).toEqual([]);
  });

  test("writes rotated credentials to the file-backed store", () => {
    storeKey(KEYFILE_PATH, testKey);
    virtualFiles.set(FILE_STORAGE_PATH, "stale-ciphertext");

    const saved = simulatePlatform("linux", () =>
      saveDroidCliCredentials({
        accessToken: fileFixture.access_token,
        refreshToken: fileFixture.refresh_token,
        activeOrganizationId: fileFixture.active_organization_id,
      }),
    );

    expect(saved).toBe(true);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0].path).toBe(FILE_STORAGE_PATH);
    expect(writeCalls[0].mode).toBe(0o600);
    expect(decryptPayload(writeCalls[0].data, testKey)).toEqual(fileFixture);
    expectOnlyCredentialStorageTouched();
  });
});
